/**
 * issue#2 复核发现的残余隐患 —— 投递结算的竞态与兜底
 *
 * 固化的不变量（命名标记）：
 *   [语义]  必须成立的投递语义，破坏它即回归。
 *   [事实]  附带锁定的实现约定（opt-out 开关、幂等结算等）。
 *
 * 覆盖的隐患：
 *   1. 退订 / `stop()` 时**正在执行**的投递被无条件结算为 `cancelled` → 「无人成功」误判 →
 *      已成功的副作用被 `fetch()` 消费者再执行一次（issue#2 原标题描述的重复，换了个入口）。
 *   2. 广播型 provider 没接结算 barrier（第三方 provider 常见错误）→ 可重试失败静默丢失。
 *   3. 同一 `(subscriptionId, messageId)` 并发投递时内部记账互相覆盖 → 一个 barrier 永不结算，
 *      其中一条消息静默消失（`post()` 允许自定义 id，见 `interfaces.OutgoingMail.id`）。
 *   4. 卡死的订阅回调让 barrier 永不结算 → 消息既不回队也不死信，`unreadCount` 里看不见。
 *   5. 生产者型 provider（自己组装消息再丢给本地订阅者）绕过基类投递入口 → 这次投递没人记账，
 *      失败既不回队也不死信（基类提供 `_deliverToLocalSubscription`）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryProvider } from './providers'
import { MailboxProvider } from './providers/MailboxProvider'
import { MailMessage } from './interfaces'
import { MailMessageQueue } from './lib/MessageQueue'
import { DEFAULT_DELIVERY_SETTLE_TIMEOUT, type DeliveryResult } from './lib/delivery'

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let seq = 0
/**
 * 这里用的是默认构造的 provider（共享进程级 bus），所以每个用例仍要用唯一 topic。
 * 需要真正隔离的用例见 `providers/memory.isolation.test.ts`（`MemoryProvider.createIsolated()`）。
 */
const addrOf = (name: string): string => `mem://p${seq++}-${name}@bus/inbox`

const retriable = (message = 'upstream down') =>
  Object.assign(new Error(message), { isRetriable: true })

/** 抛可重试错误的同步订阅者。 */
const failing =
  () =>
  (_message: MailMessage): void => {
    throw retriable()
  }

/** 观察基类的内部记账 + 死信钩子。 */
class ProbeProvider extends MemoryProvider {
  readonly deadLettered: { message: MailMessage; failed: readonly DeliveryResult[] }[] = []

  /** 基类的 `pendingDeliveryCount`（尚未结算的投递数）。 */
  get outstanding(): number {
    return this.pendingDeliveryCount
  }

  protected _onDeliveryDeadLettered(message: MailMessage, failed: readonly DeliveryResult[]): void {
    this.deadLettered.push({ message, failed })
  }
}

/**
 * 第三方广播 provider 的常见写法：`_send` 里把消息派发出去，但**丢弃**了每次投递的结算
 * promise（没接 `_trackBroadcastSettlement`）。issue#2 的修复把回队判定搬到了 barrier 上，
 * 于是这类 provider 的可重试失败会静默消失 —— 基类必须兜住。
 */
class RawBroadcastProvider extends MailboxProvider {
  protected readonly broadcastDeliveries = true
  private readonly listeners = new Map<string, Set<(message: MailMessage) => void | Promise<DeliveryResult | void>>>()
  private readonly queue = new MailMessageQueue<MailMessage>()

  constructor() {
    super('raw')
  }

  protected async _send(message: MailMessage): Promise<void> {
    const topic = message.to.href
    const listeners = this.listeners.get(topic)
    if (!listeners || listeners.size === 0) {
      this.queue.enqueue(topic, message)
      return
    }
    // 故意不调用 `_trackBroadcastSettlement`：模拟漏接 barrier 的 provider。
    listeners.forEach((listener) => {
      void listener(message)
    })
  }

  protected _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => void | Promise<DeliveryResult | void>,
  ): any {
    const topic = address.href
    if (!this.listeners.has(topic)) {
      this.listeners.set(topic, new Set())
    }
    this.listeners.get(topic)!.add(onReceive)
    return () => {
      this.listeners.get(topic)?.delete(onReceive)
    }
  }

  protected async _unsubscribe(_subscriptionId: string, unsubscribeHandle: any): Promise<void> {
    if (typeof unsubscribeHandle === 'function') {
      unsubscribeHandle()
    }
  }

  protected async _fetch(address: URL): Promise<MailMessage | null> {
    return (this.queue.dequeue(address.href) as MailMessage | null) ?? null
  }

  protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
    if (requeue) {
      this.queue.requeue(message.to.href, message)
    }
  }
}

describe('隐患1 [语义]：退订 / 关闭不得替正在执行的投递下结论', () => {
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

  it('[语义] 退订时正在执行的回调不得被当成失败（不回队、副作用一次）', async () => {
    const address = addrOf('unsubscribe-inflight')
    let sideEffects = 0
    const sub = await mailbox.subscribe(address, async () => {
      await tick(40)
      sideEffects++
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(10)
    await sub.unsubscribe() // 回调还在跑：不能替它结算成 cancelled
    await tick(200)

    expect(sideEffects).toBe(1)
    expect((await mailbox.status(address)).unreadCount).toBe(0)
    expect(await mailbox.fetch(address)).toBeNull() //  poller 也拿不到第二条
  })

  it('[语义] stop() 时正在执行的回调成功后不得回队', async () => {
    const address = addrOf('stop-inflight')
    let sideEffects = 0
    await mailbox.subscribe(address, async () => {
      await tick(40)
      sideEffects++
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(10)
    await mailbox.stop()
    await tick(200)

    expect(sideEffects).toBe(1)
    expect((await mailbox.status(address)).unreadCount).toBe(0)
    expect(await mailbox.fetch(address)).toBeNull()
  })

  it('[语义] 退订时正在执行的回调如果最终失败，仍可被 fetch 兜底', async () => {
    const address = addrOf('unsubscribe-inflight-fail')
    const sub = await mailbox.subscribe(address, async () => {
      await tick(30)
      throw retriable()
    })

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(10)
    await sub.unsubscribe() // 回调还在跑，随后才抛错：没有任何订阅者成功 → 交给 fetch()
    await tick(200)

    expect((await mailbox.status(address)).unreadCount).toBe(1)
    expect((await mailbox.fetch(address))?.id).toBe(sent.id)
  })

  it('[语义] 退订仍会取消「等待重投」的投递：退避中的投递按取消结算并回队', async () => {
    const provider = new ProbeProvider({ maxAttempts: 5, baseDelay: 500 })
    const retryMailbox = new Mailbox()
    retryMailbox.registerProvider(provider)
    await retryMailbox.start()

    const address = addrOf('unsubscribe-during-backoff')
    const sub = await retryMailbox.subscribe(address, failing())

    const sent = await retryMailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(10)
    await sub.unsubscribe()
    await tick(100)

    expect(provider.outstanding).toBe(0) // 退避定时器已取消并结算
    expect((await retryMailbox.status(address)).unreadCount).toBe(1)
    expect((await retryMailbox.fetch(address))?.id).toBe(sent.id)
    await retryMailbox.stop()
  })
})

describe('隐患2 [语义]：广播 provider 没接结算 barrier 时不得静默丢失', () => {
  let mailbox: Mailbox
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mailbox = new Mailbox()
    mailbox.registerProvider(new RawBroadcastProvider())
    await mailbox.start()
  })

  afterEach(async () => {
    await mailbox.stop()
    vi.restoreAllMocks()
  })

  it('[语义] 可重试失败必须仍可被 fetch 取回（barrier 缺失时基类兜底）', async () => {
    const address = 'raw://bus/no-barrier'
    await mailbox.subscribe(address, failing())

    const sent = await mailbox.post({ from: 'raw://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    expect((await mailbox.fetch(address))?.id).toBe(sent.id)
    expect(warnSpy).toHaveBeenCalled() // 并且明确告诉 provider 作者：barrier 漏接了
  })

  it('[语义] barrier 缺失时的兜底回队仍只留一份', async () => {
    const address = 'raw://bus/no-barrier-dedup'
    await mailbox.subscribe(address, failing())
    await mailbox.subscribe(address, failing())

    await mailbox.post({ from: 'raw://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    const recovered = await mailbox.fetch(address)
    expect(recovered).not.toBeNull()
    expect(await mailbox.fetch(address)).toBeNull()
  })

  it('[语义] 接了 barrier 的 provider 不会触发这条兜底告警', async () => {
    const address = addrOf('barrier-wired-no-warning')
    const memMailbox = new Mailbox()
    memMailbox.registerProvider(new MemoryProvider())
    await memMailbox.start()
    await memMailbox.subscribe(address, failing())

    await memMailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick()

    expect(warnSpy).not.toHaveBeenCalled()
    await memMailbox.stop()
  })
})

describe('隐患3 [语义]：同 id 并发投递各自独立结算', () => {
  it('[语义] 内部投递记账不得互相覆盖：两条消息都要结算', async () => {
    const provider = new ProbeProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('dup-id-fatal')
    const seen: number[] = []
    await mailbox.subscribe(address, async (message) => {
      seen.push(message.body.n)
      await tick(30)
      throw new Error('malformed payload') // 全部不可重试 → 各自死信
    })

    await mailbox.post({ id: 'dup-1', from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await mailbox.post({ id: 'dup-1', from: 'mem://s@bus/u', to: address, body: { n: 2 } })
    await tick(200)

    expect(seen).toEqual([1, 2])
    expect(provider.outstanding).toBe(0)
    // 关键：两条投递各自结算，各自的 barrier 都跑完（修复前只有一条 barrier 会跑到死信钩子）
    expect(provider.deadLettered).toHaveLength(2)
    expect(provider.deadLettered.map((entry) => entry.message.body.n).sort()).toEqual([1, 2])

    await mailbox.stop()
  })

  it('[语义] 同 id 并发投递全部可重试失败时，两份都回队（去重按份不按 id）', async () => {
    const provider = new ProbeProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('dup-id-retriable')
    let calls = 0
    await mailbox.subscribe(address, async () => {
      calls++
      await tick(20)
      throw retriable()
    })

    await mailbox.post({ id: 'dup-2', from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await mailbox.post({ id: 'dup-2', from: 'mem://s@bus/u', to: address, body: { n: 2 } })
    await tick(200)

    expect(calls).toBe(2)
    expect(provider.outstanding).toBe(0)

    // 两封信、两份账：`id` 是发送方给的名字，重复不代表它们是同一份东西。
    // 早先这里期望 1（按 id 去重），等于把 {n:2} 那份静默弄丢了（F7），也与
    // 上面那条“同 id 两条投递各自死信”的期望矛盾：同一输入在 fatal / retriable 两侧不能一个算两件事、一个算一件事。
    const status = await mailbox.status(address)
    expect(status.unreadCount).toBe(2)
    const bodies: unknown[] = []
    let got = await mailbox.fetch(address)
    while (got) {
      bodies.push(got.body.n)
      got = await mailbox.fetch(address)
    }
    expect(bodies.sort()).toEqual([1, 2])

    await mailbox.stop()
  })
})

describe('隐患4 [语义]：卡死的订阅回调必须有界', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[语义] 永不 settle 的回调不得让消息永久不可见（看门狗兜底回队）', async () => {
    const provider = new ProbeProvider()
    provider.deliverySettleTimeout = 20
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('hung-callback')
    await mailbox.subscribe(address, () => new Promise<void>(() => undefined))

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(150)

    expect(provider.outstanding).toBe(0)
    expect((await mailbox.status(address)).unreadCount).toBe(1)
    expect((await mailbox.fetch(address))?.id).toBe(sent.id)
    expect(warnSpy).toHaveBeenCalled()

    await mailbox.stop()
  })

  it('[语义] 看门狗超时只结算一次：回调后来才成功不得再兜一遍', async () => {
    const provider = new ProbeProvider()
    provider.deliverySettleTimeout = 20
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('late-success-after-stall')
    let sideEffects = 0
    await mailbox.subscribe(address, async () => {
      await tick(80) // 比看门狗晚
      sideEffects++
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(200)

    expect(sideEffects).toBe(1)
    expect(provider.outstanding).toBe(0)
    expect(provider.deadLettered).toHaveLength(0)
    expect((await mailbox.status(address)).unreadCount).toBe(1) // 只有看门狗那一次回队

    await mailbox.stop()
  })

  it('[语义] 看门狗不得打断健康的重试链（每次尝试各自计时）', async () => {
    const provider = new ProbeProvider({ maxAttempts: 5, baseDelay: 5 })
    provider.deliverySettleTimeout = 40
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('watchdog-not-cutting-retry')
    let calls = 0
    await mailbox.subscribe(address, async () => {
      calls++
      await tick(20) // 单次尝试 20ms < 40ms，但整条重试链 > 40ms
      if (calls < 3) {
        throw retriable()
      }
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(300)

    expect(calls).toBe(3)
    expect(provider.outstanding).toBe(0)
    expect((await mailbox.status(address)).unreadCount).toBe(0)

    await mailbox.stop()
  })

  it('[语义] 看门狗不得打断退避等待（退避期间不计时）', async () => {
    const provider = new ProbeProvider({ maxAttempts: 3, baseDelay: 80 })
    provider.deliverySettleTimeout = 20
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('watchdog-not-cutting-backoff')
    let calls = 0
    await mailbox.subscribe(address, async () => {
      calls++
      if (calls < 2) {
        throw retriable()
      }
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(300)

    expect(calls).toBe(2) // 退避 80ms > 看门狗 20ms，但不能被掐断
    expect((await mailbox.status(address)).unreadCount).toBe(0)

    await mailbox.stop()
  })

  it('[事实] deliverySettleTimeout = 0 关闭看门狗：无人结算的消息没人兜', async () => {
    const provider = new ProbeProvider()
    provider.deliverySettleTimeout = 0
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('watchdog-off')
    await mailbox.subscribe(address, () => new Promise<void>(() => undefined))

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(100)

    expect(provider.outstanding).toBe(1)
    expect((await mailbox.status(address)).unreadCount).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()

    await mailbox.stop()
    // 关闭也不会替正在执行的回调下结论（否则事后成功的副作用会被再执行一次）。
    // 关掉看门狗 = 调用方自己保证回调会结算；否则这条消息既不在队列也不在死信里。
    expect((await mailbox.status(address)).unreadCount).toBe(0)
  })

  it('[事实] 看门狗开着时，关闭（stop）也不会永久卡住那条消息', async () => {
    const provider = new ProbeProvider()
    provider.deliverySettleTimeout = 20
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('watchdog-closes-gap')
    await mailbox.subscribe(address, () => new Promise<void>(() => undefined))

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await mailbox.stop() // 正在执行的投递不会被取消
    await tick(150)

    expect(provider.outstanding).toBe(0)
    expect((await mailbox.fetch(address))?.id).toBe(sent.id)
  })

  it('[事实] 默认看门狗存在且有界', () => {
    expect(DEFAULT_DELIVERY_SETTLE_TIMEOUT).toBeGreaterThan(0)
    expect(new MemoryProvider().deliverySettleTimeout).toBe(DEFAULT_DELIVERY_SETTLE_TIMEOUT)
  })
})

describe('隐患5 [语义]：自己派发消息的 provider 也必须走基类投递入口', () => {
  /** 模拟生产者型 provider（如 InputProvider）：组装一条消息，直接投给本地订阅者。 */
  class LocalProducerProvider extends MemoryProvider {
    produce(subscriptionId: string, message: MailMessage): Promise<DeliveryResult> {
      return this._deliverToLocalSubscription(subscriptionId, message)
    }

    get outstanding(): number {
      return this.pendingDeliveryCount
    }
  }

  it('[语义] 本地投递同样记账：失败可被 fetch 兜底，且不泄漏待结算投递', async () => {
    const provider = new LocalProducerProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = addrOf('local-producer')
    const sub = await mailbox.subscribe(address, failing())

    const reply: MailMessage = {
      id: 'reply-1',
      from: new URL('mem://s@bus/u'),
      to: new URL(address),
      body: { produced: true },
    }
    await provider.produce(sub.id, reply)
    await tick()

    expect(provider.outstanding).toBe(0) // 这次投递被记账并结算了
    expect((await mailbox.status(address)).unreadCount).toBe(1)
    expect((await mailbox.fetch(address))?.id).toBe('reply-1')

    await mailbox.stop()
  })
})
