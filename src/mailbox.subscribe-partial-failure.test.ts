/**
 * issue#2 —— `subscribe` 广播部分失败的投递语义（回归防线）
 *
 * 落地的语义：
 *   1. 每次投递（`deliveryId = subscriptionId + messageId`）单独结算，结算发生在整条重试链
 *      落定之后；
 *   2. 广播的发送侧有结算 barrier：全部投递落定后才判定要不要回队；
 *   3. **只有「没有任何投递成功」且「至少一次投递可重试」才把整条消息退回队列**
 *      （`shouldRequeueAfterBroadcast`）—— 保住 issue#1 的 `fetch()` 兜底；
 *   4. 部分失败不回队，失败的投递走 `_onDeliveryDeadLettered`，不会把已成功者处理过的
 *      消息再投一次（跨投递模式重复）；
 *   5. `post()` 仍然只等派发，不等投递结算。
 *
 * 命名标记：
 *   [语义]  上面那几条不变量，破坏它们就是回归。
 *   [事实]  附带锁定的行为（`post()` 不阻塞、去重守卫等），不是本 issue 的核心承诺。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryProvider } from './providers'
import { MailMessage } from './interfaces'
import type { DeliveryResult } from './lib/delivery'

const tick = (ms = 50) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

let seq = 0
/**
 * 这里用的是默认构造的 provider（共享进程级 bus），所以每个用例仍要用唯一 topic。
 * 需要真正隔离的用例见 `providers/memory.isolation.test.ts`（`MemoryProvider.createIsolated()`）。
 */
const addrOf = (name: string): string => `mem://p${seq++}-${name}@bus/inbox`

/** 抛可重试错误的订阅者。 */
const failing =
  () =>
  (_message: MailMessage): void => {
    throw Object.assign(new Error('upstream down'), { isRetriable: true })
  }

/** 记录 `_onDeliveryDeadLettered` 的 provider，用来观察不回队的那些失败投递。 */
class DeadLetterProvider extends MemoryProvider {
  readonly deadLettered: { message: MailMessage; failed: readonly DeliveryResult[] }[] = []

  protected _onDeliveryDeadLettered(message: MailMessage, failed: readonly DeliveryResult[]): void {
    this.deadLettered.push({ message, failed })
  }
}

describe('issue#2 [语义]：部分失败不回队，也不重复投递给已成功者', () => {
  let mailbox: Mailbox

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mailbox = new Mailbox()
    mailbox.registerProvider(new MemoryProvider())
    await mailbox.start()
  })

  afterEach(async () => {
    await mailbox.stop()
    vi.restoreAllMocks()
  })

  it('[语义] A 成功 + B 可重试失败 → 整条消息不回队', async () => {
    const address = addrOf('partial-no-requeue')
    const a = vi.fn()
    mailbox.subscribe(address, a)
    mailbox.subscribe(address, failing())

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    expect(a).toHaveBeenCalledTimes(1)
    expect((await mailbox.status(address)).unreadCount).toBe(0)
    expect(await mailbox.fetch(address)).toBeNull()
  })

  it('[语义] 混合 subscribe + 轮询：同一条消息的副作用只执行一次', async () => {
    const address = addrOf('single-side-effect')
    let sideEffects = 0
    const work = () => {
      sideEffects++
    }

    mailbox.subscribe(address, () => work()) // 成功的订阅者
    mailbox.subscribe(address, failing())

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    const polled = await mailbox.fetch(address) // 轮询消费者执行同一段逻辑
    if (polled) {
      work()
    }

    expect(sideEffects).toBe(1)
  })

  it('[语义] 纯订阅模式不留无人认领的滞留消息', async () => {
    const address = addrOf('no-orphan')
    mailbox.subscribe(address, () => undefined)
    mailbox.subscribe(address, failing())

    for (let i = 1; i <= 3; i++) {
      await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: i } })
    }
    await tick()

    expect((await mailbox.status(address)).unreadCount).toBe(0)
  })

  it('[语义] 全部退订再重新订阅：已处理过的消息不会广播给新订阅者', async () => {
    const address = addrOf('resubscribe')
    const s1 = mailbox.subscribe(address, failing())
    const s2 = mailbox.subscribe(address, () => undefined) // 成功

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick()
    await s1.unsubscribe()
    await s2.unsubscribe()

    const late = vi.fn()
    mailbox.subscribe(address, late)
    await tick()

    expect(late).toHaveBeenCalledTimes(0)
    // 有订阅者成功过，消息已处理完毕，不再留在队列里等兜底
    expect((await mailbox.status(address)).unreadCount).toBe(0)
  })

  it('[语义] 重试耗尽也不把已成功者处理过的消息退回队列', async () => {
    const retryMailbox = new Mailbox()
    retryMailbox.registerProvider(new MemoryProvider({ maxAttempts: 3, baseDelay: 1 }))
    await retryMailbox.start()

    const address = addrOf('exhaust-partial')
    const a = vi.fn()
    const b = vi.fn(failing())
    retryMailbox.subscribe(address, a)
    retryMailbox.subscribe(address, b)

    await retryMailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(200)

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(3) // 只有失败者被重投
    expect((await retryMailbox.status(address)).unreadCount).toBe(0)
    await retryMailbox.stop()
  })

  it('[语义] 待重投期间退订失败订阅者，不影响已成功者的消息不回队', async () => {
    const retryMailbox = new Mailbox()
    retryMailbox.registerProvider(new MemoryProvider({ maxAttempts: 3, baseDelay: 500 }))
    await retryMailbox.start()

    const address = addrOf('cancel-partial')
    const a = vi.fn()
    retryMailbox.subscribe(address, a)
    const failingSub = retryMailbox.subscribe(address, failing())

    await retryMailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(10)
    await failingSub.unsubscribe() // 取消待重投：投递结算为 cancelled
    await tick(100)

    expect(a).toHaveBeenCalledTimes(1)
    expect((await retryMailbox.status(address)).unreadCount).toBe(0)
    await retryMailbox.stop()
  })

  it('[语义] 不回队的失败投递可以在 _onDeliveryDeadLettered 里看到', async () => {
    const provider = new DeadLetterProvider()
    const dlMailbox = new Mailbox()
    dlMailbox.registerProvider(provider)
    await dlMailbox.start()

    const address = addrOf('dead-letter-partial')
    const okSub = dlMailbox.subscribe(address, () => undefined)
    const badSub = dlMailbox.subscribe(address, failing())

    const sent = await dlMailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    expect(provider.deadLettered).toHaveLength(1)
    const [{ message, failed }] = provider.deadLettered
    expect(message.id).toBe(sent.id)
    // 只有失败的那一次投递被记账，而且带投递身份
    expect(failed).toHaveLength(1)
    expect(failed[0].subscriptionId).toBe(badSub.id)
    expect(failed[0].reason).toBe('retriable')
    expect(failed[0].deliveryId).toContain(badSub.id)
    expect(okSub.status).toBe('active')

    await dlMailbox.stop()
  })

  it('[语义] 跨 Mailbox 实例的广播：别人家的订阅者成功也算成功', async () => {
    const address = addrOf('cross-instance-partial')
    const host = new Mailbox() // 成功订阅者住在这里
    host.registerProvider(new MemoryProvider())
    await host.start()

    const poster = new Mailbox() // 失败订阅者 + 发送方在这里
    poster.registerProvider(new MemoryProvider())
    await poster.start()

    const a = vi.fn()
    host.subscribe(address, a)
    poster.subscribe(address, failing())

    await poster.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    expect(a).toHaveBeenCalledTimes(1)
    expect((await host.status(address)).unreadCount).toBe(0)
    expect((await poster.status(address)).unreadCount).toBe(0)

    await poster.stop()
    await host.stop()
  })
})

describe('issue#2 [语义]：全部投递失败时仍然回队（issue#1 的兜底不能破）', () => {
  let mailbox: Mailbox

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mailbox = new Mailbox()
    mailbox.registerProvider(new MemoryProvider())
    await mailbox.start()
  })

  afterEach(async () => {
    await mailbox.stop()
    vi.restoreAllMocks()
  })

  it('[语义] N 个订阅者全部失败 → 队列只留一份，可被 fetch 取回', async () => {
    const address = addrOf('all-fail-dedup')
    mailbox.subscribe(address, failing())
    mailbox.subscribe(address, failing())
    mailbox.subscribe(address, failing())

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    expect((await mailbox.status(address)).unreadCount).toBe(1) // never queued twice
    expect((await mailbox.fetch(address))?.id).toBe(sent.id)
    expect(await mailbox.fetch(address)).toBeNull()
  })

  it('[语义] 可重试 + 不可重试混合且无人成功 → 仍回队（可重试那份值得再试）', async () => {
    const address = addrOf('mixed-fatal-retriable')
    mailbox.subscribe(address, () => {
      throw new Error('malformed payload')
    })
    mailbox.subscribe(address, failing())

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    expect((await mailbox.fetch(address))?.id).toBe(sent.id)
  })

  it('[语义] 全部不可重试 → 死信，不回队', async () => {
    const address = addrOf('all-fatal')
    mailbox.subscribe(address, () => {
      throw new Error('malformed payload')
    })
    mailbox.subscribe(address, () => {
      throw new Error('also malformed')
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    expect((await mailbox.status(address)).unreadCount).toBe(0)
    expect(await mailbox.fetch(address)).toBeNull()
  })

  it('[语义] 重试耗尽且无人成功 → 回队交给 fetch', async () => {
    const retryMailbox = new Mailbox()
    retryMailbox.registerProvider(new MemoryProvider({ maxAttempts: 3, baseDelay: 1 }))
    await retryMailbox.start()

    const address = addrOf('exhaust-all-fail')
    const b = vi.fn(failing())
    retryMailbox.subscribe(address, b)

    const sent = await retryMailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(200)

    expect(b).toHaveBeenCalledTimes(3)
    expect((await retryMailbox.status(address)).unreadCount).toBe(1)
    expect((await retryMailbox.fetch(address))?.id).toBe(sent.id)
    await retryMailbox.stop()
  })

  it('[语义] 唯一的失败订阅者在待重投期间退订 → 回队，不静默丢失', async () => {
    const retryMailbox = new Mailbox()
    retryMailbox.registerProvider(new MemoryProvider({ maxAttempts: 5, baseDelay: 500 }))
    await retryMailbox.start()

    const address = addrOf('cancel-only-subscriber')
    const sub = retryMailbox.subscribe(address, failing())

    const sent = await retryMailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(10)
    await sub.unsubscribe()
    await tick(100)

    expect((await retryMailbox.status(address)).unreadCount).toBe(1)
    expect((await retryMailbox.fetch(address))?.id).toBe(sent.id)
    await retryMailbox.stop()
  })
})

describe('issue#2 [事实]：结算 barrier 的时序', () => {
  let mailbox: Mailbox

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mailbox = new Mailbox()
    mailbox.registerProvider(new MemoryProvider())
    await mailbox.start()
  })

  afterEach(async () => {
    await mailbox.stop()
    vi.restoreAllMocks()
  })

  it('[事实] 慢速成功订阅者还没结算时，判定还没发生（不会提前回队）', async () => {
    const address = addrOf('barrier-waits-slow-success')
    const order: string[] = []
    mailbox.subscribe(address, async () => {
      await new Promise((r) => setTimeout(r, 50)) // 成功，但需要一次 I/O
      order.push('A-success')
    })
    mailbox.subscribe(address, () => {
      order.push('B-fail')
      throw Object.assign(new Error('down'), { isRetriable: true })
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(10)

    // 旧行为：B 先失败就先回队，此刻 unreadCount 已经是 1，而 A 的成功与否还没发生。
    expect(order).toEqual(['B-fail'])
    expect((await mailbox.status(address)).unreadCount).toBe(0)

    await tick(100)
    expect(order).toEqual(['B-fail', 'A-success'])
    expect((await mailbox.status(address)).unreadCount).toBe(0)
  })

  it('[事实] post() 只等派发，不等投递结算', async () => {
    const address = addrOf('post-not-awaiting-delivery')
    let settled = false
    mailbox.subscribe(address, async () => {
      await new Promise((r) => setTimeout(r, 30))
      settled = true
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    expect(settled).toBe(false) // 广播已派发，但未结算

    await tick(100)
    expect(settled).toBe(true)
  })

  it('[事实] 重试链整条落定后才结算：退避期间的消息对 barrier 可见为未完成', async () => {
    const provider = new DeadLetterProvider()
    const retryMailbox = new Mailbox()
    retryMailbox.registerProvider(provider)
    await retryMailbox.start()

    const address = addrOf('settle-after-retry-chain')
    const calls: number[] = []
    retryMailbox.subscribe(address, (m) => {
      calls.push(Date.now())
      if (calls.length < 3) {
        throw Object.assign(new Error('flaky'), { isRetriable: true })
      }
      void m
    })

    await retryMailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(20)
    expect(calls).toHaveLength(1) // 退避中：还没结算，也就没有死信记录
    expect(provider.deadLettered).toHaveLength(0)

    await retryMailbox.stop()
  })
})

describe('issue#2 [事实]：opt-in 重试与手动 ack 交叉', () => {
  let mailbox: Mailbox

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mailbox = new Mailbox()
    await mailbox.start()
  })

  afterEach(async () => {
    await mailbox.stop()
    vi.restoreAllMocks()
  })

  it('[事实] poller 持有 in-flight 期间，部分失败的广播不会再往队列塞一份', async () => {
    mailbox.registerProvider(new MemoryProvider())
    await mailbox.start()

    const address = addrOf('inflight-cross')
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 'queued' } })
    const held = await mailbox.fetch(address, { manualAck: true })
    expect((await mailbox.status(address)).inFlightCount).toBe(1)

    const a = vi.fn()
    mailbox.subscribe(address, a)
    mailbox.subscribe(address, failing())
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 'broadcast' } })
    await tick()

    const status = await mailbox.status(address)
    expect(status.inFlightCount).toBe(1)
    expect(status.unreadCount).toBe(0) // A 已处理过：不再回队

    await held!.ack()
    expect(await mailbox.fetch(address)).toBeNull()
    expect(a).toHaveBeenCalledTimes(1)
  })
})
