/**
 * F7 根因固化（端到端）：同 id 的两封信 + 发送方伪造系统头
 *
 * `id` 归发送方：它是「我认为这是同一封信」的说法，不是系统的状态键。
 * 系统自己的状态（排队 / 在飞 / 回队去重 / 封顶计数）必须由系统发的凭据撑着，
 * 否则两个发送方、两个地址之间就能互相把对方的消息弄丢（且零痕迹）。
 *
 * 固化的不变量：
 *   [语义] 同 id 的两封信各自投递、各自记账：可重试失败时两份都回队。
 *   [语义] 同 id 的两封信在死信侧也是两条（与上面那条必须对称）。
 *   [语义] 地址之间不串扰。
 *   [语义] 发送方塞的 `mbx-*` 系统头一律不采信（`mbx-reply-to` 是发送方自己的，保留）。
 */

import { describe, expect, it } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryProvider, MemoryEventBus } from './providers/memory'
import { MailMessage } from './interfaces'
import { MBX_ATTEMPT_HEADER, MBX_ROUND_HEADER, MBX_SEND_ID_HEADER } from './lib/delivery'

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let seq = 0
const addrOf = (name: string) => `mem://p${seq++}-${name}@bus/inbox`
const retriable = () => Object.assign(new Error('upstream down'), { isRetriable: true })

describe('同 id 的两封信：两份各一本账', () => {
  it('[语义] 可重试失败 → 两份都回到队列里（不是只留一份）', async () => {
    const provider = new MemoryProvider(null, new MemoryEventBus())
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('dup-retriable')
    const seen: number[] = []
    await mailbox.subscribe(address, (message) => {
      seen.push(message.body.n)
      throw retriable()
    })

    await mailbox.post({ id: 'dup-1', from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await mailbox.post({ id: 'dup-1', from: 'mem://s@bus/u', to: address, body: { n: 2 } })
    await tick(200)

    expect(seen.sort()).toEqual([1, 2])
    const queued = await mailbox.fetch(address, { peek: true })
    expect(queued.map((m) => m.body.n).sort()).toEqual([1, 2]) // 修复后：{n:2} 不再被当成重复丢掉

    await mailbox.stop({ purge: true })
  })

  it('[语义] 不可重试失败 → 两条死信（与可重试那条必须对称）', async () => {
    const provider = new MemoryProvider(null, new MemoryEventBus())
    provider.enableDeadLetterQueue()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('dup-fatal')
    await mailbox.subscribe(address, () => {
      throw new Error('malformed payload')
    })

    await mailbox.post({ id: 'dup-2', from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await mailbox.post({ id: 'dup-2', from: 'mem://s@bus/u', to: address, body: { n: 2 } })
    await tick(200)

    const dlq = await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true })
    expect(dlq).toHaveLength(2)

    await mailbox.stop({ purge: true })
  })

  it('[语义] 另一个地址上同 id 的在飞消息，不会吞掉这里的回队', async () => {
    const provider = new MemoryProvider(null, new MemoryEventBus())
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const held = addrOf('victim')
    const failing = addrOf('other-address')

    // 有人在 held 上取走了一份 id='shared' 的信，挂在在飞状态。
    await mailbox.post({ id: 'shared', from: 'mem://s@bus/u', to: held, body: 'working' })
    const handle = await mailbox.fetch(held, { manualAck: true, ackTimeout: 60_000 })
    expect(handle).not.toBeNull()

    // 另一个地址上，同 id 的另一封信投递失败（可重试）→ 必须回队。
    await mailbox.subscribe(failing, () => {
      throw retriable()
    })
    await mailbox.post({ id: 'shared', from: 'mem://s@bus/u', to: failing, body: 'must-come-back' })
    await tick(200)

    const queued = await mailbox.fetch(failing, { peek: true })
    expect(queued.map((m) => m.body)).toEqual(['must-come-back'])

    const heldStatus = await mailbox.status(held)
    expect(heldStatus.inFlightCount).toBe(1)

    await mailbox.stop({ purge: true })
  })

  it('[语义] 拉取侧：同 id 两份各自 nack(true)，两份都回到队列', async () => {
    const provider = new MemoryProvider(null, new MemoryEventBus())
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('pull-dup')
    await mailbox.post({ id: 'same', from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await mailbox.post({ id: 'same', from: 'mem://s@bus/u', to: address, body: { n: 2 } })

    const h1 = await mailbox.fetch(address, { manualAck: true, ackTimeout: 60_000 })
    const h2 = await mailbox.fetch(address, { manualAck: true, ackTimeout: 60_000 })
    expect([h1, h2].every(Boolean)).toBe(true)

    await h1!.nack(true)
    await h2!.nack(true)

    const status = await mailbox.status(address)
    expect(status.unreadCount).toBe(2)
    expect(status.inFlightCount).toBe(0)

    await mailbox.stop({ purge: true })
  })
})

describe('发送方伪造系统头', () => {
  it('[语义] mbx-round / mbx-attempt / mbx-send-id 由系统发，发送方塞的不采信', async () => {
    const provider = new MemoryProvider({ maxAttempts: 2, baseDelay: 1 }, new MemoryEventBus())
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('spoof-round')
    const seen: { round?: string; attempt?: string }[] = []
    await mailbox.subscribe(address, (message: MailMessage) => {
      seen.push({
        round: message.headers?.[MBX_ROUND_HEADER] as string | undefined,
        attempt: message.headers?.[MBX_ATTEMPT_HEADER] as string | undefined,
      })
      throw retriable()
    })

    await mailbox.post({
      id: 'spoof-1',
      from: 'mem://s@bus/u',
      to: address,
      body: 'sender sets its own counters',
      headers: { 'mbx-round': '9999', 'mbx-attempt': '7', 'mbx-send-id': 'forged' },
    })
    await tick(200)

    // 伪造的 round:9999 若被采信，任何按轮次封顶（SQS 式 maxReceiveCount）的 provider
    // 都会把这条当场判死 —— 发送方自己选了“立刻被丢弃”。
    // 开了重试：两次尝试属同一轮，所以 round 始终 1、attempt 从 1 数到 2。
    expect(seen).toEqual([
      { round: '1', attempt: '1' },
      { round: '1', attempt: '2' },
    ])
    const queued = await mailbox.fetch(address, { peek: true })
    expect(queued[0]?.headers?.[MBX_ROUND_HEADER]).toBe('1')
    expect(queued[0]?.headers?.['mbx-send-id']).toBeTruthy()
    expect(queued[0]?.headers?.['mbx-send-id']).not.toBe('forged')

    await mailbox.stop({ purge: true })
  })

  it('[语义] 死信痕迹头（mbx-dead-letter*）也不能由发送方贴到活消息上', async () => {
    const provider = new MemoryProvider(null, new MemoryEventBus())
    provider.enableDeadLetterQueue()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('spoof-dlq-headers')
    await mailbox.subscribe(address, (message: MailMessage) => {
      expect(message.headers?.['mbx-dead-letter']).toBeUndefined()
      expect(message.headers?.['mbx-dead-letter-terminal']).toBeUndefined()
    })

    await mailbox.post({
      id: 'spoof-2',
      from: 'mem://s@bus/u',
      to: address,
      body: 'pretends to be a dead-letter record',
      headers: { 'mbx-dead-letter': 'true', 'mbx-dead-letter-terminal': 'true' },
    })
    await tick(100)

    const queued = await mailbox.fetch(address, { peek: true })
    await mailbox.post({ id: 'spoof-3', from: 'mem://s@bus/u', to: address, body: 'queued path' })
    const dlq = await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true })
    expect(dlq).toHaveLength(0)
    void queued

    await mailbox.stop({ purge: true })
  })

  it('[事实] mbx-reply-to 是发送方自己的头，必须原样保留', async () => {
    const provider = new MemoryProvider(null, new MemoryEventBus())
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('reply-to')
    let got: MailMessage | undefined
    await mailbox.subscribe(address, (message) => {
      got = message
    })

    await mailbox.post({
      id: 'keep-reply-to',
      from: 'mem://s@bus/u',
      to: address,
      body: 'hi',
      headers: { 'mbx-reply-to': 'mem://s@bus/u/inbox', 'req-id': 'r1' },
    })
    await tick(100)

    expect(got?.headers?.['mbx-reply-to']).toBe('mem://s@bus/u/inbox')
    expect(got?.headers?.['req-id']).toBe('r1')

    await mailbox.stop({ purge: true })
  })

  it('[回归] 伪造的 mbx-send-id 不得让两份信共用一本账', async () => {
    const bus = new MemoryEventBus()
    const mailbox = new Mailbox()
    mailbox.registerProvider(new MemoryProvider(null, bus))
    await mailbox.start()

    const address = addrOf('forged-send-id')
    // 发送方给两封不同的信贴了同一个份号（= 伪造身份）
    for (const body of ['c-1', 'c-2']) {
      await mailbox.post({
        id: 'forged-1',
        from: 'mem://s@bus/u',
        to: address,
        body,
        headers: { [MBX_SEND_ID_HEADER]: 'same-copy' },
      })
    }

    // 两封各自取走、各自回队：不会只留一份
    const h1 = await mailbox.fetch(address, { manualAck: true })
    const h2 = await mailbox.fetch(address, { manualAck: true })
    expect([h1, h2].filter(Boolean)).toHaveLength(2)
    await h1!.nack(true)
    const s = await mailbox.status(address)
    expect(s.inFlightCount).toBe(1) // h2 那封还在 h2 手里
    expect(s.unreadCount).toBe(1) // h1 那封回了队

    // 两份的份号都是系统发的，不是伪造的那个
    const found = bus.locate('forged-1')
    expect(found).toHaveLength(2)
    expect(found.every((f) => f.sendId !== undefined && f.sendId !== 'same-copy')).toBe(true)

    await mailbox.stop({ purge: true })
  })
})
