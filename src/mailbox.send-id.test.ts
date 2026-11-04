/**
 * 号属于 provider 基类：进入系统的每一份副本必然带系统发的 `mbx-send-id`。
 *
 * 为什么要钉在 provider 基类而不是 `Mailbox#post()`：`MailboxProvider.send()` 是所有 provider
 * 的 `_send()` 唯一的入口（它本来就在那里注入 `mbx-sent-at`）。发号放在 `post()` 上，第三方
 * provider 作者就背上了“记得注入”的义务，忘了就掉回按发送方 id 猜——而那正是 F7 的根因。
 */
import { describe, expect, it } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryEventBus, MemoryProvider } from './providers/memory'
import { MBX_SEND_ID_HEADER } from './lib/delivery'

const ADDR = 'mem://ops@bus/inbox'

async function setup() {
  const bus = new MemoryEventBus()
  const provider = new MemoryProvider(null, bus)
  const mailbox = new Mailbox()
  mailbox.registerProvider(provider)
  await mailbox.start()
  return { bus, provider, mailbox }
}

async function headersOf(mailbox: Mailbox, addr = ADDR): Promise<Record<string, unknown>[]> {
  return (await mailbox.fetch(addr, { peek: true })).map((m) => m.headers ?? {})
}

describe('发号在 provider 基类：每份副本进入系统时必然带号', () => {
  it('[语义] 不经 Mailbox#post()、直接 provider.send()，副本也带系统号', async () => {
    const { provider, mailbox } = await setup()

    await provider.send({
      id: provider.generateId(),
      from: new URL('mem://sender@bus/u'),
      to: new URL(ADDR),
      body: '直接调 provider 的那封',
    })

    const headers = await headersOf(mailbox)
    expect(headers).toHaveLength(1)
    expect(headers[0][MBX_SEND_ID_HEADER]).toBeTypeOf('string')
    expect(headers[0][MBX_SEND_ID_HEADER]).not.toBe('')
    await mailbox.stop({ purge: true })
  })

  it('[语义] 伪造的 mbx-send-id 不被采信：两封伪造同号的信各有各的账', async () => {
    const { provider, mailbox } = await setup()

    // 直接走 provider（不经 post 的剥离），伪造同一个号
    for (const body of ['第一封', '第二封']) {
      await provider.send({
        id: provider.generateId(),
        from: new URL('mem://sender@bus/u'),
        to: new URL(ADDR),
        body,
        headers: { [MBX_SEND_ID_HEADER]: 'forged-the-same' },
      })
    }

    const headers = await headersOf(mailbox)
    expect(headers).toHaveLength(2) // 号相同也绝不能被当成同一份而吞掉一封
    const ids = headers.map((h) => h[MBX_SEND_ID_HEADER])
    expect(new Set(ids).size).toBe(2)

    // 两封各自取走、各自结算：各一本账
    const h1 = await mailbox.fetch(ADDR, { manualAck: true })
    const h2 = await mailbox.fetch(ADDR, { manualAck: true })
    expect([h1, h2].filter(Boolean)).toHaveLength(2)
    await h1!.nack(true)
    const status = await mailbox.status(ADDR)
    expect(status.inFlightCount).toBe(1) // h2 那封还在 h2 手里
    expect(status.unreadCount).toBe(1) // h1 那封回到了队里
    await mailbox.stop({ purge: true })
  })

  it('[语义] 号跟着这一份走完全程：fetch → nack(true) → 再 fetch，号不变', async () => {
    const { mailbox } = await setup()
    await mailbox.post({ from: 'mem://sender@bus/u', to: ADDR, body: '要回队再被取一次的那封' })

    const before = (await headersOf(mailbox))[0][MBX_SEND_ID_HEADER]
    const handle = await mailbox.fetch(ADDR, { manualAck: true })
    await handle!.nack(true)
    const after = (await headersOf(mailbox))[0][MBX_SEND_ID_HEADER]

    expect(after).toBe(before)
    await mailbox.stop({ purge: true })
  })
})

describe('结算门只认我们发的号；发送方的名字只能用来查', () => {
  it('[回归] 拿发送方的 id 去结算必须报 false，不能默默销掉谁一案', async () => {
    const { bus, mailbox } = await setup()
    const X = 'mem://alice@bus/inbox'
    const Y = 'mem://bob@bus/inbox'
    // 正常业务：同一个订单号，买家一封、卖家一封（没人收错信）
    await mailbox.post({ from: 'mem://shop@bus/ops', to: X, id: 'order-42', body: '给 Alice' })
    await mailbox.post({ from: 'mem://shop@bus/ops', to: Y, id: 'order-42', body: '给 Bob' })
    await mailbox.fetch(X, { manualAck: true })
    await mailbox.fetch(Y, { manualAck: true })

    // 旧写法（凭 id 就地结算，不带 topic）：现在谁都不该被动
    const settled = bus.ack('order-42')
    expect(settled).toBe(false)
    expect((await mailbox.status(X)).inFlightCount).toBe(1)
    expect((await mailbox.status(Y)).inFlightCount).toBe(1)
    expect((await mailbox.status(X)).unreadCount).toBe(0) // 也没往谁的队里塞回一份
    await mailbox.stop({ purge: true })
  })

  it('[语义] locate(发送方的名字) 是只读查询，然后按号动手', async () => {
    const { bus, mailbox } = await setup()
    const X = 'mem://alice@bus/inbox'
    const Y = 'mem://bob@bus/inbox'
    await mailbox.post({ from: 'mem://shop@bus/ops', to: X, id: 'order-42', body: '给 Alice' })
    await mailbox.post({ from: 'mem://shop@bus/ops', to: Y, id: 'order-42', body: '给 Bob' })
    await mailbox.fetch(X, { manualAck: true })
    const handleY = await mailbox.fetch(Y, { manualAck: true })

    const found = bus.locate('order-42')
    expect(found).toHaveLength(2)
    expect(found.every((f) => f.state === 'inFlight')).toBe(true)
    expect(found.map((f) => f.topic).sort()).toEqual([
      'mem://alice@bus/inbox',
      'mem://bob@bus/inbox',
    ].sort())
    expect(new Set(found.map((f) => f.key)).size).toBe(2)
    // 只读：查一下不改变任何状态
    expect((await mailbox.status(X)).inFlightCount).toBe(1)
    expect((await mailbox.status(Y)).inFlightCount).toBe(1)

    // 按号动手：只动 Bob 那一份
    const bob = found.find((f) => f.topic === 'mem://bob@bus/inbox')!
    expect(bus.nack(bob.key, true)).toBe(true)
    expect((await mailbox.status(Y)).unreadCount).toBe(1)
    expect((await mailbox.status(Y)).inFlightCount).toBe(0)
    expect((await mailbox.status(X)).unreadCount).toBe(0) // Alice 完全没被碰
    expect((await mailbox.status(X)).inFlightCount).toBe(1)
    // Bob 那封回来后再取一次，还是同一个号（同一份）
    const again = await mailbox.fetch(Y, { manualAck: true })
    expect(again!.headers?.[MBX_SEND_ID_HEADER]).toBe(handleY!.headers?.[MBX_SEND_ID_HEADER])
    await mailbox.stop({ purge: true })
  })
})
