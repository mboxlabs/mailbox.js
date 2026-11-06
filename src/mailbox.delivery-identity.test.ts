/**
 * F9：投递尝试这本账必须按「哪一份信」记（TDD 先红）
 *
 * `id` 归发送方（可以重复）。投递的尝试计数如果按 `(订阅者, id)` 记，两封同名信就共用一本预算：
 * 后到那封第一趟失败就被判「重试耗尽」（它应有的重试被吞），先到那封反倒多拿到一趟，
 * 消息上的 `mbx-attempt` 章越过自己声明的 `mbx-max-attempts`。
 *
 * 固化的不变量：
 *   [语义] 每份信的预算独立：没有任何一份的 `mbx-attempt` 超过 `mbx-max-attempts`。
 *   [语义] 同 id 两封信各自拿到自己应有的重试次数（互不吞）。
 *   [语义] 投递身份 = (订阅者, 一份信)：`DeliveryResult.deliveryId` 不因撞名而重复。
 *   [语义] 一份失败不得抹掉另一份的处置记录（`mbx-attempt` 不能凭空归零 / 缺数）。
 *   [语义] 没开启重试时，两封同 id 的信各投一次（共享 pending 会投成三次）。
 *   [语义] 回队的副本带自己那条链的趟数，不拿别人的数。
 *   [事实] 退订会取消待重投（钉住投递键的前缀拆分仍成立）。
 */

import { describe, expect, it } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryProvider, MemoryEventBus } from './providers/memory'
import { MailMessage } from './interfaces'
import { RetryPolicy } from './lib/retry'
import { DeliveryResult, MBX_ATTEMPT_HEADER, MBX_MAX_ATTEMPTS_HEADER } from './lib/delivery'

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let seq = 0
const addrOf = (name: string) => `mem://p${seq++}-${name}@bus/inbox`
const retriable = () => Object.assign(new Error('upstream down'), { isRetriable: true })

async function setup(retry: RetryPolicy | null) {
  const bus = new MemoryEventBus()
  const provider = new MemoryProvider(retry, bus)
  const mailbox = new Mailbox()
  mailbox.registerProvider(provider)
  await mailbox.start()
  return { mailbox, provider, bus }
}

describe('投递尝试按份记：同 id 不共账', () => {
  it('[语义] 同 id 两封信：各自试满自己的预算，章不超过自己声明的上限', async () => {
    const { mailbox } = await setup({ maxAttempts: 2, baseDelay: 1 })
    const address = addrOf('f9-budget')
    const seen: Array<{ tag: string; attempt: number; max: number }> = []

    await mailbox.subscribe(address, (m: MailMessage) => {
      seen.push({
        tag: String(m.body.tag),
        attempt: Number(m.headers?.[MBX_ATTEMPT_HEADER]),
        max: Number(m.headers?.[MBX_MAX_ATTEMPTS_HEADER]),
      })
      throw retriable()
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'same', body: { tag: 'A' } })
    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'same', body: { tag: 'B' } })
    await tick(250)

    // 每封各 2 趟：A1 B1 A2 B2（旧实现：A1 B1 A2 A3 —— B 被吞，A 越界）
    expect(seen.map((s) => `${s.tag}${s.attempt}`)).toEqual(['A1', 'B1', 'A2', 'B2'])
    expect(seen.every((s) => s.attempt <= s.max)).toBe(true)

    await mailbox.stop({ purge: true })
  })

  it('[语义] 投递身份按份：DeliveryResult.deliveryId 不因撞名而重复', async () => {
    /** 模拟生产者型 provider：自己组装消息再投给本地订阅者。 */
    class ProbeProvider extends MemoryProvider {
      deliver(subscriptionId: string, message: MailMessage): Promise<DeliveryResult> {
        return this._deliverToLocalSubscription(subscriptionId, message)
      }
    }

    const bus = new MemoryEventBus()
    const provider = new ProbeProvider({ maxAttempts: 1, baseDelay: 1 }, bus)
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('f9-delivery-id')
    // 同一个订阅者、同一个 id、两封不同的信（无 mbx-send-id：降级到对象身份，也必须分得开）
    const first = await provider.deliver('sub-f9', { id: 'same', from: new URL('mem://s@bus/u'), to: new URL(address), body: 1 })
    const second = await provider.deliver('sub-f9', { id: 'same', from: new URL('mem://s@bus/u'), to: new URL(address), body: 2 })

    expect([first.ok, second.ok]).toEqual([false, false])
    expect(new Set([first.deliveryId, second.deliveryId]).size).toBe(2)
    expect([first.attempts, second.attempts]).toEqual([1, 1])

    await mailbox.stop({ purge: true })
  })

  it('[语义] 每份信带回自己的计数（回队的副本不拿别人的数）', async () => {
    const { mailbox } = await setup({ maxAttempts: 2, baseDelay: 1 })
    const address = addrOf('f9-counters')
    await mailbox.subscribe(address, () => {
      throw retriable()
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'same', body: { tag: 'A' } })
    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'same', body: { tag: 'B' } })
    await tick(250)

    // 预算耗尽后两份都回队（现状：耗尽不是终态）。回队的那一份必须带着自己那条链的趟数。
    const queued = await mailbox.fetch(address, { peek: true, limit: 5 })
    expect(queued).toHaveLength(2)
    const attempts = Object.fromEntries(
      queued.map((m) => [String(m.body.tag), m.headers?.[MBX_ATTEMPT_HEADER]]),
    )
    expect(attempts).toEqual({ A: '2', B: '2' })

    await mailbox.stop({ purge: true })
  })

  it('[语义] 没开重试：同 id 两封信各投一次（共享 pending 会投成三次）', async () => {
    const { mailbox } = await setup(null)
    const address = addrOf('f9-noretry')
    const seen: string[] = []
    await mailbox.subscribe(address, (m: MailMessage) => {
      seen.push(String(m.body.tag))
      throw retriable()
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'same', body: { tag: 'A' } })
    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'same', body: { tag: 'B' } })
    await tick(150)

    expect(seen).toEqual(['A', 'B'])
    await mailbox.stop({ purge: true })
  })

  it('[事实] 退订会取消这个订阅者手上待重投的投递（记账键前缀拆分靠这个钉住）', async () => {
    const { mailbox } = await setup({ maxAttempts: 5, baseDelay: 60 })
    const address = addrOf('f9-cancel')
    const seen: string[] = []
    const sub = await mailbox.subscribe(address, (m: MailMessage) => {
      seen.push(String(m.body.tag))
      throw retriable()
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'same', body: { tag: 'A' } })
    await mailbox.post({ from: 'mem://s@bus/u', to: address, id: 'same', body: { tag: 'B' } })
    await tick(10)
    await sub.unsubscribe()
    await tick(250)

    expect(seen).toEqual(['A', 'B']) // 退订之后没有任何重投
    await mailbox.stop({ purge: true })
  })
})
