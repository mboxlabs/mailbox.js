/**
 * `@mboxlabs/mailbox/testing` —— **最小合法 provider**（L0 基座）。
 *
 * 它存在的理由（拆包计划 §4）：`MemoryProvider` 拆到 `@mboxlabs/mailbox-memory` 之后，核心自己的
 * 测试不能再靠一个具体 provider 跑——那样「核心的回归面」其实还是 `mem:` 的回归面。这个类只实现
 * L0（投递交接语义），核心据此保留一半回归面；第三方 provider 作者也拿它验自己有没有踩满 L0。
 *
 * 主张与边界都写在这里，而且由 `test-provider.test.ts` 钉住：
 *
 * **主张（L0）**：订阅广播投递、发送边界发号剥伪造头、无订阅者时入队、`fetch` 三种形态
 * （auto-ack / manualAck / peek）、一次取信 = 一次处置、`unhandled` 回队头、状态里只有核心
 * 具名字段、`clear()`、地址语法是可问到的数据（D5）、能力声明按实现来（D6）。
 *
 * **不主张**：租约到期与回收（没有过期这回事）、停放 / 死信（`discard` 就是零痕迹）、队列层的
 * `requeue` 重复守卫（`MessageQueue.requeue` 那条按份判断——这里回队就是直接入队头）、
 * 退避重试的上限终态、`mem:` 那类地址折叠与「拒绝 query / hash」政策、任何命名空间扩展键。
 * 要测这些就换 `@mboxlabs/mailbox-memory`（或自带 broker）。
 *
 * **吃基类的**（它们就是 L0 的内容，不是某一家的私有政策）：投递记账、副本结算表、
 * barrier、投递看门狗、退避重试的执行壳。所以这个类只写地址键、投递入口、处置落点与取信。
 *
 * 它**不 import** `MailMessageQueue`，也不 import `providers/memory`：L0 不能靠某一家的队列实现
 * 撑起来，否则拆出去的包还在核心里留了条后门。这条由测试扫源码锁住。
 */

import type {
  Ackable,
  AckableMailMessage,
  Disposition,
  MailMessage,
  MailboxAddressGrammar,
  MailboxStatus,
} from '../interfaces'
import { nextRoundCopy, type DeliveryResult } from '../lib/delivery'
import type { RetryPolicy } from '../lib/retry'
import { MailboxProvider } from '../providers/MailboxProvider'

/** 默认协议名。实例化时可以换（两个实例各管一套账，便于同进程里比对行为差异）。 */
export const DEFAULT_TEST_PROTOCOL = 'test'

export interface TestProviderOptions {
  /** 订阅级重试策略。不传 = 默认：失败只把这一份退回队列，不自动重投。 */
  retry?: RetryPolicy | null
  /** 协议名（不带冒号），默认 {@link DEFAULT_TEST_PROTOCOL}。 */
  protocol?: string
}

/** 基类包好的投递入口：返回这次投递的最终结算结果。 */
type Listener = (message: MailMessage) => Promise<DeliveryResult>

/** 一份取走的信：退回队列时要知道回哪条队列，所以连着 topic 存。 */
interface Held {
  topic: string
  message: MailMessage
}

/**
 * L0 的最小 provider：状态全在实例里，实例之间不串台（测试隔离靠实例，不靠地址前缀）。
 *
 * 实现路径按 `e03c961` 钉死的规矩：**继承 `MailboxProvider`**，清理写在 `_close()`，
 * 不覆写 `close()`。投递记账 / 重试 / barrier / 看门狗都吃基类的现成实现——这正是 L0 的内容。
 */
export class TestProvider extends MailboxProvider {
  /** 订阅是广播：一条消息对每个订阅者各投递一次，回不回队由 barrier 统一判定。 */
  protected readonly broadcastDeliveries = true

  /** 未读的份（队头在 index 0）。 */
  private readonly queues = new Map<string, MailMessage[]>()
  /** 取走但未处置的份：键是这次取信的记录号，不是消息 id，也不是对象同一性。 */
  private readonly inFlight = new Map<string, Held>()
  /** 每条地址上的投递入口（`_subscribe` 登记的就是基类包装后的投递函数）。 */
  private readonly listeners = new Map<string, Listener[]>()
  /** 活动时刻：投递 / 入队 / 取走 / 处置都刷新它（状态里的 `lastActivityTime`）。 */
  private readonly lastActivity = new Map<string, string>()

  /** 这个实例的信箱语法（见 {@link MailboxAddressGrammar}）。 */
  public readonly addressGrammar: MailboxAddressGrammar

  constructor(options: TestProviderOptions = {}) {
    const protocol = options.protocol ?? DEFAULT_TEST_PROTOCOL
    super(protocol, options.retry ?? null)
    this.addressGrammar = {
      scheme: protocol,
      // 本语法对 authority 不作要求也不拒绝：写法就是键。
      authority: 'optional',
      identity: '整条地址就是信箱键：不折叠、不判等，`test://bus/inbox` 与 `test:bus/inbox` 是两个信箱',
      // query / fragment 参与寻址（它们就在键里）——本语法没有「折叠掉 query」这条政策。
      query: 'addressing',
      fragment: 'addressing',
      equivalences: ['没有任何等价写法：写法不同就是不同信箱（`mem:` 那套折叠不是 L0 主张）'],
    }
  }

  /**
   * 本 scheme 的信箱键。
   *
   * L0 不主张折叠规则（那是 scheme 的私有政策，`mem:` 的 `mem:` ≡ `mem://` 就属于它），
   * 所以这里就是 `URL#href`。一致性由「每个入口都过这里」保证（D5 要求的是这个）。
   */
  private topicOf(address: URL): string {
    return address.href
  }

  private touch(topic: string): void {
    this.lastActivity.set(topic, new Date().toISOString())
  }

  private queueOf(topic: string): MailMessage[] {
    const queue = this.queues.get(topic)
    if (queue) {
      return queue
    }
    const created: MailMessage[] = []
    this.queues.set(topic, created)
    return created
  }

  // --- 投递（订阅侧）---

  /**
   * 有订阅者就广播（并给 barrier 登记，判定归基类），没有就入队等 `fetch`。
   *
   * 一条消息只走一条路：两边都走会让队列只涨不消，重新订阅后又会把处理过的消息再取一遍。
   */
  protected async _send(message: MailMessage): Promise<void> {
    const topic = this.topicOf(message.to)
    this.touch(topic)
    const listeners = this.listeners.get(topic)
    if (!listeners || listeners.length === 0) {
      this.queueOf(topic).push(message)
      return
    }
    const deliveries = listeners.map((listener) => {
      try {
        return Promise.resolve(listener(message))
      } catch (error) {
        // 同步抛错归一成 rejected：rejected 让基类的 `Promise.allSettled` 处理，
        // 不能让它在 `_send` 里把整条广播打断（那等于把 `post()` 打断）。
        return Promise.reject(error)
      }
    })
    this._trackBroadcastSettlement(message, deliveries)
  }

  protected _subscribe(address: URL, onReceive: Listener): () => void {
    const topic = this.topicOf(address)
    const listeners = this.listeners.get(topic) ?? []
    listeners.push(onReceive)
    this.listeners.set(topic, listeners)
    this.touch(topic)
    return () => {
      const current = this.listeners.get(topic)
      if (!current) {
        return
      }
      const at = current.indexOf(onReceive)
      if (at >= 0) {
        current.splice(at, 1)
      }
      if (current.length === 0) {
        this.listeners.delete(topic)
      }
    }
  }

  protected async _unsubscribe(_subscriptionId: string, unsubscribeHandle: unknown): Promise<void> {
    if (typeof unsubscribeHandle === 'function') {
      ;(unsubscribeHandle as () => void)()
    }
  }

  /**
   * 广播侧处置信号的落点：`unhandled` = 这一份回到队头等 `fetch` 兜底（不得静默丢失）；
   * `handled` / `discard` = 这一份不再回来。
   *
   * 这里收到的 `message` 是本轮结算后的投递副本（带 `mbx-attempt` / `mbx-round`），
   * 所以退回队列的那一份在队里也看得见「这轮试了几次 / 这是第几轮」。
   */
  protected async _settle(message: MailMessage, where: Disposition): Promise<boolean> {
    if (where !== 'unhandled') {
      // 广播的副本从来没进过队列：`handled` / `discard` 都没有东西要搬。
      return false
    }
    const topic = this.topicOf(message.to)
    this.queueOf(topic).unshift(message)
    this.touch(topic)
    return true
  }

  // --- 取信（拉取侧）---

  /**
   * `manualAck` 的句柄由本类自己发：一次取信记一条，处置一次就注销。
   * 句柄的词汇校验与「只生效一次」由内核在 `fetch()` 外面套（`bindConsumerHandle`），
   * 这里的注销是为了让「迟到的旧句柄」即使绕过内核也不动到别人的那一份。
   */
  protected async _fetch(
    address: URL,
    options?: { manualAck?: boolean; ackTimeout?: number | null },
  ): Promise<MailMessage | AckableMailMessage | null> {
    const topic = this.topicOf(address)
    const queue = this.queueOf(topic)
    const copy = queue.shift()
    if (!copy) {
      return null
    }
    if (!options?.manualAck) {
      this.touch(topic)
      return nextRoundCopy(copy)
    }
    // 交出去就算一轮：回队的那一份必须带着轮次，否则消费者数不出「已经被取了几次」。
    const handed = nextRoundCopy(copy)
    const recordId = this.generateId()
    this.inFlight.set(recordId, { topic, message: handed })
    this.touch(topic)
    return Object.assign({}, handed, {
      ack: (where?: Disposition) => this.settleFetched(recordId, where ?? 'handled'),
      // deprecated alias：省略 = `discard`（与 `Ackable.nack` 的公开语义一致）。
      nack: (requeue?: boolean) => this.settleFetched(recordId, requeue === true ? 'unhandled' : 'discard'),
    } satisfies Pick<Ackable, 'ack' | 'nack'>) as AckableMailMessage
  }

  /**
   * 处置一份取走的信。返回 `false` = 这次处置没生效（已经处置过，或这一份不归这个句柄了）。
   *
   * 只认 `unhandled`（回队头）；别的值（含 provider 自定义处置值——本类一个都没声明，内核会先
   * 拦下）都算「这一份到此为止」。
   */
  private async settleFetched(recordId: string, where: Disposition): Promise<boolean> {
    const held = this.inFlight.get(recordId)
    if (!held) {
      return false
    }
    this.inFlight.delete(recordId)
    if (where === 'unhandled') {
      this.queueOf(held.topic).unshift(held.message)
    }
    this.touch(held.topic)
    return true
  }

  /** 只读快照：副本，不出队、不建在飞、不刷活动时刻。 */
  protected async _peek(address: URL, options?: { limit?: number }): Promise<MailMessage[]> {
    const queue = this.queues.get(this.topicOf(address)) ?? []
    const limit = options?.limit ?? queue.length
    return queue.slice(0, limit).map((copy) => ({
      ...copy,
      headers: copy.headers ? { ...copy.headers } : copy.headers,
    }))
  }

  // --- 状态与清理 ---

  /**
   * 只有核心具名字段（D7）：`mem.parkedCount` 这类命名空间扩展键属于投递策略，本类没有那些
   * 策略，也就不写那些键。
   *
   * 没有活动记录、也没有任何一份信 → `exists: false` + `state: 'unknown'`，不是 `online` + 0。
   */
  protected async _status(address: URL): Promise<MailboxStatus> {
    const topic = this.topicOf(address)
    const unreadCount = this.queues.get(topic)?.length ?? 0
    let inFlightCount = 0
    for (const held of this.inFlight.values()) {
      if (held.topic === topic) {
        inFlightCount += 1
      }
    }
    const lastActivityTime = this.lastActivity.get(topic)
    const exists =
      unreadCount > 0 ||
      inFlightCount > 0 ||
      this.listeners.has(topic) ||
      lastActivityTime !== undefined

    if (!exists) {
      return {
        state: 'unknown',
        exists: false,
        message: `No queue, subscription or activity is known for '${topic}'.`,
        unreadCount,
        inFlightCount,
        lastActivityTime,
      }
    }
    return { state: 'online', exists: true, unreadCount, inFlightCount, lastActivityTime }
  }

  /** 本实例认得的地址；唯一契约是这些串能原样喂回本 provider。 */
  public async listAddresses(): Promise<string[]> {
    const topics = new Set<string>([
      ...this.queues.keys(),
      ...this.listeners.keys(),
      ...this.lastActivity.keys(),
      ...Array.from(this.inFlight.values(), (held) => held.topic),
    ])
    return Array.from(topics).sort()
  }

  /** 丢掉本实例持有的积压（订阅关系保留）。 */
  public async clear(): Promise<void> {
    this.queues.clear()
    this.inFlight.clear()
  }

  /**
   * 拆连接不等于删数据（`mailbox.ts:97` 的分工：`stop()` 只拆订阅，带 `purge` 才叫 `clear()`）。
   * 真 broker 重连后积压还在，所以这里只拆监听器登记，不动队列与在飞。
   * 要一场测试不带上一场的残留：`clear()`，或者直接换一个实例。
   */
  protected async _close(): Promise<void> {
    this.listeners.clear()
  }
}

/**
 * 造一个 {@link TestProvider}。导出工厂是为了让调用方不依赖构造器签名——构造参数在 2.x 里
 * 还会加（比如以后要开的观测开关），而「给我一个能踩满 L0 的 provider」这个主张不该跟着变。
 */
export function createTestProvider(options: TestProviderOptions = {}): TestProvider {
  return new TestProvider(options)
}
