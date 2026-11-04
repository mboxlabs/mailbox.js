/**
 * F8：`nack(false)` 的唯一承诺——"不会再交给我"（死信封顶处不得反悔）
 *
 * 三个处置动作的真实差别（不是"成功 / 失败"）：
 *
 *   | 动作 | 这一份 | 还会交给我吗 | provider 按协议善后 |
 *   | `ack()`       | 删 | 不 | 不 |
 *   | `nack(false)` | 删 | 不 | **做** |
 *   | `nack(true)`  | 回队 | 会 | 不 |
 *
 * MemoryProvider 的"善后"就是往死信队列存一份副本（没开 DLQ 时等于纯丢弃）。
 * 但死信链到顶时，归档目的地会退回**它自己那条队列**——旧实现在那里把副本 `enqueue` 回原地，
 * 于是"到此为止"变成"再交一次"：排空脚本永远取到同一条，`unreadCount` 永不下降。
 *
 * 固化的不变量：
 *   [语义] 死信队列上 `nack(false)` 之后，那条队列不能再被 `fetch` 出来。
 *   [语义] 一次 `nack(false)` 不得让死信队列里多出第二份未读。
 *   [语义] 停放不等于消失：`status()` 里 `parkedCount` 数得出来，副本也读得出来。
 *   [语义] 门面级 `status()` 要能看见停放数（不然运维只看得到"没未读"）。
 *   [事实] 未到封顶时归档行为不变：正常在 `x_dlq` 里留一份未读记录。
 */

import { describe, expect, it } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryEventBus, MemoryProvider, MBX_DEAD_LETTER_TERMINAL_HEADER } from './providers/memory'
import { MailMessage } from './interfaces'

let seq = 0
const addrOf = (name: string) => `mem://p${seq++}-${name}@bus/inbox`

async function setup(withDlq = true) {
  const bus = new MemoryEventBus()
  const provider = new MemoryProvider(null, bus)
  if (withDlq) {
    provider.enableDeadLetterQueue()
  }
  const mailbox = new Mailbox()
  mailbox.registerProvider(provider)
  await mailbox.start()
  return { mailbox, provider, bus }
}

/** 把一条消息从业务队列挪进死信队列（第一次归档），返回死信地址。 */
async function deadLetterOne(mailbox: Mailbox, provider: MemoryProvider, address: string) {
  await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'poison', body: '<未闭合的 JSON>' })
  const h = await mailbox.fetch(address, { manualAck: true })
  await h!.nack(false)
  return provider.deadLetterTopic(address)!
}

describe('死信封顶：停放不是重投', () => {
  it('[语义] 死信队列上 nack(false)：不能再被 fetch 出来', async () => {
    const { mailbox, provider } = await setup()
    const address = addrOf('park-no-redelivery')
    const dlq = await deadLetterOne(mailbox, provider, address)

    const first = await mailbox.fetch(dlq, { manualAck: true })
    expect(first).toBeDefined()
    await first!.nack(false) // “这条也救不回来，结束它”

    expect(await mailbox.fetch(dlq, { manualAck: true })).toBeNull()
    expect((await mailbox.status(dlq)).unreadCount).toBe(0)

    await mailbox.stop({ purge: true })
  })

  it('[语义] 停放不等于消失：status 数得出来，副本也读得出来', async () => {
    const { mailbox, provider } = await setup()
    const address = addrOf('park-visible')
    const dlq = await deadLetterOne(mailbox, provider, address)

    const first = await mailbox.fetch(dlq, { manualAck: true })
    await first!.nack(false)

    const s = await mailbox.status(dlq)
    expect(s.unreadCount).toBe(0)
    expect(s.parkedCount).toBe(1)

    const parked = provider.peekParked(dlq)
    expect(parked).toHaveLength(1)
    expect(parked[0].body).toBe('<未闭合的 JSON>')
    expect(parked[0].headers?.[MBX_DEAD_LETTER_TERMINAL_HEADER]).toBe('true')

    await mailbox.stop({ purge: true })
  })

  it('[语义] 一次 nack(false) 不得产生第二份未读死信', async () => {
    const { mailbox, provider } = await setup()
    const address = addrOf('park-no-duplicate')
    const dlq = await deadLetterOne(mailbox, provider, address)

    const before = (await mailbox.status(dlq)).unreadCount
    const first = await mailbox.fetch(dlq, { manualAck: true })
    await first!.nack(false)

    expect((await mailbox.status(dlq)).unreadCount).toBe(0)
    expect(before).toBe(1) // 归档那一份本来在未读里；处置完它必须归零

    await mailbox.stop({ purge: true })
  })

  it('[语义] 门面级 status() 要能看见停放数', async () => {
    const { mailbox, provider } = await setup()
    const address = addrOf('park-aggregate')
    const dlq = await deadLetterOne(mailbox, provider, address)

    const first = await mailbox.fetch(dlq, { manualAck: true })
    await first!.nack(false)

    const global = await mailbox.status()
    expect(global.parkedCount).toBe(1)

    await mailbox.stop({ purge: true })
  })

  it('[事实] 未到封顶时归档行为不变：死信队列里是一份未读', async () => {
    const { mailbox, provider } = await setup()
    const address = addrOf('archive-normal')
    const dlq = await deadLetterOne(mailbox, provider, address)

    const s = await mailbox.status(dlq)
    expect(s.unreadCount).toBe(1)
    expect(s.parkedCount).toBe(0)

    const peeked = await mailbox.fetch(dlq, { peek: true })
    expect(peeked[0].headers?.['mbx-dead-letter']).toBe('true')

    await mailbox.stop({ purge: true })
  })

  it('[语义] ack() 是“我自己处理完（含扔了）”：不留痕迹也不留停放', async () => {
    const { mailbox, provider } = await setup()
    const address = addrOf('ack-discard')
    const dlq = await deadLetterOne(mailbox, provider, address)

    const first = await mailbox.fetch(dlq, { manualAck: true })
    await first!.ack()

    const s = await mailbox.status(dlq)
    expect(s.unreadCount).toBe(0)
    expect(s.parkedCount).toBe(0)
    expect(provider.peekParked(dlq)).toEqual([])

    await mailbox.stop({ purge: true })
  })

  it('[语义] 停止时 purge 连停放一起清', async () => {
    const { mailbox, provider, bus } = await setup()
    const address = addrOf('park-purge')
    const dlq = await deadLetterOne(mailbox, provider, address)

    const first = await mailbox.fetch(dlq, { manualAck: true })
    await first!.nack(false)
    expect((await mailbox.status(dlq)).parkedCount).toBe(1)

    await mailbox.stop({ purge: true })
    expect(bus.listParked(dlq)).toEqual([])
  })

  it('[事实] 没开死信队列时 nack(false) 就是纯丢弃：既不重投也不留任何东西', async () => {
    const { mailbox } = await setup(false)
    const address = addrOf('no-dlq')
    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'gone', body: 1 })

    const h = await mailbox.fetch(address, { manualAck: true })
    await h!.nack(false)

    const s = await mailbox.status(address)
    expect(s.unreadCount).toBe(0)
    expect(s.inFlightCount).toBe(0)
    expect(s.parkedCount).toBe(0)
    expect(await mailbox.fetch(address, { manualAck: true })).toBeNull()

    await mailbox.stop({ purge: true })
  })

  it('[事实] push 侧同样的承诺：fatal 之后不再被交出来', async () => {
    const { mailbox, provider } = await setup()
    const address = addrOf('push-fatal')
    let seen = 0
    mailbox.subscribe(address, (m: MailMessage) => {
      seen++
      throw new Error('bad payload') // 不带 isRetriable = 不可重试（fatal）
    })
    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'fatal', body: 1 })
    await new Promise<void>((r) => setTimeout(r, 150))

    expect(seen).toBe(1) // 没被重投
    expect((await mailbox.status(address)).unreadCount).toBe(0)
    expect((await mailbox.status(provider.deadLetterTopic(address)!)).unreadCount).toBe(1)

    await mailbox.stop({ purge: true })
  })
})
