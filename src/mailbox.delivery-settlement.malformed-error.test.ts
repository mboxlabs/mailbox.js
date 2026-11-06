/**
 * 隐患6 —— 订阅者抛出的值「形状恶劣」时，结算不得被打断
 *
 * `describeDeliveryError` 是结算路径上的代码（`_settleDelivery` / `toDeliveryResults`）。
 * 它以前用 `JSON.stringify` 兜非 Error 对象，遇到循环引用 / BigInt / 抛错的 `toJSON`
 * 自己就抛 TypeError。而 `_settleDelivery` 的顺序是「先摘 pending → 构造 result → settle()」，
 * 于是抛在这里 = **结算被半途取消**：
 *   - `settle()` 不发 → barrier 的 `allSettled` 永挂 → `nack(requeue)` 不发、barrier 条目泄漏；
 *   - `_fallbackForMissingBarrier` / 死信钩子 / 重试与看门狗的 timer 全部落空；
 *   - 抛在 `setTimeout`（重试第二轮、看门狗）里就是 uncaughtException —— 进程直接挂。
 * 正好击穿 issue#1 立的「失败不得静默丢失」保证。
 *
 * 命名标记：
 *   [语义]  必须成立的投递语义，破坏它即回归。
 *   [事实]  附带锁定的实现约定。
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryProvider } from './providers'
import { MailboxProvider } from './providers/MailboxProvider'
import { MailMessage } from './interfaces'
import { MailMessageQueue } from './lib/MessageQueue'
import { MBX_ATTEMPT_HEADER, type DeliveryResult } from './lib/delivery'

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 循环引用 + 没有 `message` 的普通对象：`JSON.stringify` 的炸点。
 * `retriable` 版本用来走重试链，`fatal` 版本用来走死信链。
 */
const malformedError = (retriable = false): any => {
  const error: any = { code: 'E_DOWN' };
  if (retriable) {
    error.isRetriable = true;
  }
  error.self = error;
  return error;
}

/** 观察基类的内部记账 + 死信钩子。 */
class ProbeProvider extends MemoryProvider {
  readonly deadLettered: { message: MailMessage; failed: readonly DeliveryResult[] }[] = []

  get outstanding(): number {
    return this.pendingDeliveryCount
  }

  /** barrier 登记数（private map）：结算被打断时它会永久残留。 */
  get barrierCount(): number {
    return (this as any).broadcastBarriers.size as number
  }

  protected _onDeliveryDeadLettered(message: MailMessage, failed: readonly DeliveryResult[]): void {
    this.deadLettered.push({ message, failed })
  }
}

/** 漏接 barrier 的第三方广播 provider（同 `mailbox.delivery-settlement.test.ts` 隐患2）。 */
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

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason)
}

beforeAll(() => {
  process.on('unhandledRejection', onUnhandled)
})
afterAll(() => {
  process.off('unhandledRejection', onUnhandled)
})

describe('隐患6 [语义]：畸形错误不得打断投递结算', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    unhandled.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[语义] 异步 reject 循环引用对象：可重试 → 回队给 fetch 兜底，且不泄漏记账', async () => {
    const provider = ProbeProvider.createIsolated()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = 'mem://malformed-retriable@bus/inbox'
    await mailbox.subscribe(address, async () => {
      throw malformedError(true)
    })

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(120)

    expect((await mailbox.status(address)).unreadCount).toBe(1)
    expect((await mailbox.fetch(address))?.id).toBe(sent.id)
    expect(provider.outstanding).toBe(0)
    expect(provider.barrierCount).toBe(0)
    expect(unhandled.map((e) => (e as Error)?.name ?? String(e))).toEqual([])

    await mailbox.stop()
  })

  it('[语义] 异步 reject 循环引用对象：不可重试 → 死信记录里有可读摘要', async () => {
    const provider = ProbeProvider.createIsolated()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = 'mem://malformed-fatal@bus/inbox'
    await mailbox.subscribe(address, async () => {
      throw malformedError()
    })

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(120)

    expect(provider.deadLettered).toHaveLength(1)
    const [summary] = provider.deadLettered[0].failed.map((result) => result.error)
    expect(summary, '死信记录必须带可读摘要').toBeTruthy()
    expect(summary).toContain('E_DOWN')
    expect((await mailbox.status(address)).unreadCount).toBe(0)
    expect(provider.outstanding).toBe(0)
    expect(provider.barrierCount).toBe(0)
    expect(unhandled.map((e) => (e as Error)?.name ?? String(e))).toEqual([])

    await mailbox.stop()
  })

  it('[语义] 重试链里第二轮同步抛：不得在退避 timer 里炸出 uncaughtException', async () => {
    const provider = ProbeProvider.createIsolated({ maxAttempts: 2, baseDelay: 5, maxDelay: 5 })
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = 'mem://malformed-retry@bus/inbox'
    let attempts = 0
    await mailbox.subscribe(address, () => {
      attempts += 1
      throw malformedError(true) // 同步抛：第二轮的 _handleDeliveryError 跑在 setTimeout 里
    })

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(200)

    expect(attempts).toBe(2)
    expect(provider.outstanding).toBe(0)
    expect(provider.barrierCount).toBe(0)
    expect((await mailbox.status(address)).unreadCount).toBe(1)
    expect((await mailbox.fetch(address))?.id).toBe(sent.id)
    expect(unhandled.map((e) => (e as Error)?.name ?? String(e))).toEqual([])

    await mailbox.stop()
  })

  it('[语义] 看门狗结算一条带畸形 lastError 的投递：不得在看门狗 timer 里炸', async () => {
    const provider = ProbeProvider.createIsolated({ maxAttempts: 3, baseDelay: 5, maxDelay: 5 })
    provider.deliverySettleTimeout = 20
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = 'mem://malformed-watchdog@bus/inbox'
    let attempts = 0
    await mailbox.subscribe(address, async () => {
      attempts += 1
      if (attempts === 1) {
        throw malformedError(true) // 记下畸形的 pending.lastError
      }
      return new Promise<void>(() => undefined) // 卡死 → 看门狗按 cancelled 结算
    })

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(200)

    expect(provider.outstanding).toBe(0)
    expect(provider.barrierCount).toBe(0)
    expect((await mailbox.status(address)).unreadCount).toBe(1)
    expect((await mailbox.fetch(address))?.id).toBe(sent.id)
    expect(unhandled.map((e) => (e as Error)?.name ?? String(e))).toEqual([])

    await mailbox.stop()
  })

  it('[语义] 没接 barrier 的 provider：畸形错误下缺 barrier 兜底仍要回队', async () => {
    const provider = new RawBroadcastProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = 'raw://bus/malformed-no-barrier'
    await mailbox.subscribe(address, () => {
      throw malformedError(true)
    })

    // `post()` 不该被订阅者的畸形错误带倒
    const sent = await mailbox.post({ from: 'raw://s@bus/u', to: address, body: { n: 1 } })
    await tick(120)

    const fetched = await mailbox.fetch(address)
    expect(fetched?.id, '缺 barrier 的兜底必须把消息退回队列').toBe(sent.id)
    expect(unhandled.map((e) => (e as Error)?.name ?? String(e))).toEqual([])

    await mailbox.stop()
  })

  it('[事实] 同步抛畸形错误：广播判定照常执行，回队的是带计数的投递副本', async () => {
    const provider = ProbeProvider.createIsolated()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const address = 'mem://malformed-third-party@bus/inbox'
    await mailbox.subscribe(address, () => {
      throw malformedError(true)
    })

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } })
    await tick(120)

    const fetched = await mailbox.fetch(address)
    expect(fetched?.id).toBe(sent.id)
    // 回队的那一份必须是结算后的副本：带 `mbx-attempt`，否则兜底消费者没东西可数。
    expect(fetched?.headers?.[MBX_ATTEMPT_HEADER]).toBe('1')
    expect(provider.deadLettered).toHaveLength(0) // 回队了，就不是死信
    expect(provider.barrierCount).toBe(0)

    await mailbox.stop()
  })
})
