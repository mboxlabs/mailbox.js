import { MailboxProvider } from './MailboxProvider';
import {
  MailMessage,
  MailboxStatus,
} from '../interfaces';
import { MailMessageQueue, MailMessageAckable } from '../lib/MessageQueue';
import { RetryPolicy } from '../lib/retry';
import { DeliveryResult } from '../lib/delivery';
import { getCanonicalMailboxAddressIdentifier } from '../lib/utils';

type Listener = (message: MailMessage) => void | Promise<DeliveryResult | void>;

/**
 * 默认 scope 的名字（即“进程级共享”那一份 bus）。
 */
export const DEFAULT_MEMORY_SCOPE = '';

/**
 * 模拟消息传递的内存总线（一个“服务端”）：每个实例持有一份 topic 队列 + 订阅表。
 *
 * 实例边界（issue#3）：
 * - `new MemoryEventBus()` —— 私有总线，只属于持有它的 `MemoryProvider`。需要“每个 Mailbox
 *   一套互不相干的 `mem:` 状态”（宿主 + 插件、测试隔离）就用这个。
 * - `MemoryEventBus.getInstance(scope?)` —— 按 scope 共享的进程级单例。不带 `scope` 就是历史上
 *   那个全局单例（保持现有“模拟服务端”用法不变）。
 *
 * 注意：隔离靠“换 bus 实例”，不靠“换地址”——`mem:` 地址空间在同一个 bus 内是全局的，
 * 没有租户前缀，跨实例串台就是同一个 bus 上 topic 同名。
 */
export class MemoryEventBus {
  /** 按 scope 登记的总线；`DEFAULT_MEMORY_SCOPE` 就是历史全局单例。 */
  private static readonly registry: Map<string, MemoryEventBus> = new Map();

  private topics: Map<string, Listener[]> = new Map();
  private messageQueue = new MailMessageQueue<MailMessage>();
  private lastActivity: Map<string, string> = new Map(); // For status

  /**
   * @param scope 所属 scope。仅用于诊断（`status()` / 日志里能看出这份状态是谁的）。
   */
  constructor(public readonly scope: string = DEFAULT_MEMORY_SCOPE) {}

  /**
   * 取（或创建）某个 scope 的共享总线。不带参数 = 历史行为：进程级唯一单例。
   *
   * 注册表不会自动回收：动态生成的 scope 名（带时间戳、每次新建）会一直占着那份状态。
   * 需要“用完就丢”的场景用私有总线（{@link MemoryProvider.createIsolated}）。
   *
   * @param scope 命名空间标识；同 scope 拿到同一份队列与订阅表，不同 scope 互不可见。
   */
  public static getInstance(scope: string = DEFAULT_MEMORY_SCOPE): MemoryEventBus {
    let bus = MemoryEventBus.registry.get(scope);
    if (!bus) {
      bus = new MemoryEventBus(scope);
      MemoryEventBus.registry.set(scope, bus);
    }
    return bus;
  }

  /**
   * Subscribes a listener to a specific topic.
   * @param topic The topic (canonical address) to subscribe to.
   * @param listener The callback function to execute when a message is received.
   * @returns A function that, when called, unsubscribes the listener.
   */
  public subscribe(topic: string, listener: Listener): () => void {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, []);
    }
    this.topics.get(topic)!.push(listener);
    this.lastActivity.set(topic, new Date().toISOString());
    return () => {
      const listeners = this.topics.get(topic);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  /**
   * 发布一条消息：有订阅者时交给订阅回调，否则入队等待 fetch 取回。
   *
   * @param topic The topic to publish the message to.
   * @param message The message to publish.
   * @returns 广播时返回每次投递的结算 promise（供发送侧做结算判定，见 `_send`）；
   *   入队时返回 `null`。注意广播仍是 fire-and-forget：这里不 await，`post()` 也不会
   *   等订阅回调跑完。
   */
  public publish(topic: string, message: MailMessage): Promise<DeliveryResult | void>[] | null {
    this.lastActivity.set(topic, new Date().toISOString());
    // 交给订阅者
    const listeners = this.topics.get(topic);
    if (listeners && listeners.length > 0) {
      // 一条消息只走一条路：有订阅者就只走订阅。
      // 以前两条路都走：订阅者从不 fetch，于是队列只涨不消（`status().unreadCount` 一直增长），
      // 而重新订阅后一次 `fetch` 会把已处理过的消息再投递一遍（副作用执行两次）。
      //
      // 每次投递的 promise 要留一份给发送侧：issue#2 —— 部分失败时「整条消息回不回队」
      // 必须等全部投递结算后才能判断，不能由先失败的那个订阅者说了算。
      return listeners.map((listener) => {
        try {
          return Promise.resolve(listener(message));
        } catch (error) {
          // 监听器同步抛错：归一成 rejected，交给 barrier 的 allSettled 处理，
          // 不能让它把整个 publish（进而把 `post()`）打断。
          return Promise.reject(error);
        }
      });
    }
    // 入队，等待 fetch 取回
    this.messageQueue.enqueue(topic, message);
    return null;
  }

  /**
   * Fetches and removes a message from the queue (for auto-acknowledgment).
   * @param topic The topic to fetch a message from.
   * @returns The message, or undefined if the queue is empty.
   */
  public fetchAndForget(topic: string): MailMessage | undefined {
    this.lastActivity.set(topic, new Date().toISOString()); // Keep last activity update
    return this.messageQueue.dequeue(topic) || undefined;
  }

  /**
   * Fetches a message for manual acknowledgment, moving it to the in-flight state.
   * Also checks for and requeues any stale messages before fetching.
   * @param topic The topic to fetch a message from.
   * @param options Options for the fetch operation, including staleTimeout.
   * @returns The message, or undefined if the queue is empty.
   */
  public fetchForAck(
    topic: string,
    options?: { staleTimeout?: number | null },
  ): MailMessageAckable<MailMessage> | undefined {
    this.lastActivity.set(topic, new Date().toISOString()); // Keep last activity update
    // 不将缺省超时压成 0：那会关掉 MessageQueue 的 stale 扫描，未 ack 的消息永久卡在 in-flight。
    return this.messageQueue.dequeue(topic, { manualAck: true, ackTimeout: options?.staleTimeout }) || undefined;
  }

  /**
   * Acknowledges a message, confirming it has been processed and removing it
   * from the in-flight state.
   * @param messageId The ID of the message to acknowledge.
   */
  public ack(messageId: string): void {
    this.messageQueue.ack(messageId);
  }

  /**
   * Negatively acknowledges a message, removing it from the in-flight state
   * and optionally requeueing it.
   * @param messageId The ID of the message to nack.
   * @param topic The topic the message belongs to.
   * @param requeue If true, the message is added back to the front of the queue.
   */
  public nack(messageId: string, topic: string, requeue: boolean): void {
    this.messageQueue.nack(messageId, topic, requeue);
  }

  /**
   * Puts a message back at the front of a topic's queue without going through the
   * in-flight state. Used when a subscriber callback fails with a retriable error.
   * @param topic The topic the message belongs to.
   * @param message The message to requeue.
   */
  public requeue(topic: string, message: MailMessage): void {
    this.lastActivity.set(topic, new Date().toISOString());
    this.messageQueue.requeue(topic, message);
  }

  /**
   * 丢弃队列里的消息（含 in-flight）并抹掉对应的活动时间；不传 `topic` 则清掉全部。
   *
   * **不动订阅表**：订阅是消费者主动建立的意图，拆它的是 `unsubscribe()` / `close()`。
   * 在 `clear()` 里顺手拆订阅，会让 provider 侧的 `Subscription` 对象变成“报 active 但
   * 再也收不到消息”的僵尸。需要拆订阅就关掉持有它的 `Mailbox` / provider。
   *
   * @param topic 只清这个 topic；省略则清空整份总线状态。
   * @returns 被丢弃的消息数（含 in-flight）。
   */
  public clear(topic?: string): number {
    const dropped = this.messageQueue.clear(topic);
    if (topic === undefined) {
      this.lastActivity.clear();
    } else {
      this.lastActivity.delete(topic);
    }
    return dropped;
  }

  /**
   * 【只读】取一份队列快照（副本），不出队、不建 in-flight、不刷活动时间。
   *
   * @param topic 要看的 topic。
   * @param limit 最多看几条；省略 = 整个队列。
   */
  public peek(topic: string, limit?: number): MailMessage[] {
    // 注意：这里**不** `lastActivity.set(...)`。只读诊断不该把一个空闲地址刷成「刚刚有活动」，
    // 否则一个每隔几秒轮询一次的诊断页会让 `lastActivityTime` 永远假绿。
    return this.messageQueue.peek(topic, limit);
  }

  /**
   * 这份总线认不认这个 topic：有过订阅、有过活动记录，或现在/曾有未结算的消息。
   *
   * 这是 `status().exists` 的依据。“地址不存在”与“地址空闲但确实存在”在诊断上是两件事
   *（issue#4）：前者 `exists: false` / `state: 'unknown'`，后者 `exists: true` / `state: 'online'`。
   */
  public knows(topic: string): boolean {
    return this.topics.has(topic)
      || this.lastActivity.has(topic)
      || this.messageQueue.hasTopic(topic);
  }

  /**
   * 这份总线上所有“认得”的 topic（订阅过 / 有过活动 / 有消息），按字典序排序。
   * 供 `Mailbox#status()`（无参）做全量快照。
   */
  public listTopics(): string[] {
    const known = new Set<string>([
      ...this.topics.keys(),
      ...this.lastActivity.keys(),
      ...this.messageQueue.topics(),
    ])
    return Array.from(known).sort();
  }

  /**
   * Gets the current status of a topic.
   * @param topic The topic to get the status for.
   * @returns An object containing status information. `exists` 区分「不存在」与「空闲」，
   *          `lastActivityTime` 没活动记录时是 `null`（不是 `undefined`，否则 JSON 序列化后整个字段消失）。
   */
  public getStatus(topic: string): {
    exists: boolean;
    unreadCount: number;
    inFlightCount: number;
    lastActivityTime: string | null;
    subscriberCount: number;
  } {
    const { unreadCount, inFlightCount } = this.messageQueue.getStatus(topic);
    const listeners = this.topics.get(topic) || [];
    const lastActivityTime = this.lastActivity.get(topic);
    return {
      exists: this.knows(topic),
      unreadCount,
      inFlightCount,
      lastActivityTime: lastActivityTime ?? null,
      subscriberCount: listeners.length,
    };
  }
}



export class MemoryProvider extends MailboxProvider {
  /**
   * 这个 provider 用的总线。默认是进程级共享单例（“模拟服务端”语义），
   * 需要实例级隔离时用 {@link MemoryProvider.createIsolated} / {@link MemoryProvider.forScope}，
   * 或直接把自建总线传进构造函数。
   */
  public readonly bus: MemoryEventBus;

  /**
   * 订阅是广播：一条消息对每个订阅者各投递一次。失败处理因此走投递级记账，
   * 整条消息回不回队由 `_send` 里的结算 barrier 决定（issue#2）。
   */
  protected readonly broadcastDeliveries = true;

  /**
   * @param retry 可选的订阅重试策略。不传则保持默认：订阅失败只把消息退回队列，不自动重投。
   * @param bus 可选的总线。不传则用进程级共享单例（向后兼容）；
   *   传 `new MemoryEventBus()` 得到实例级隔离，传 `MemoryEventBus.getInstance('scope')` 得到命名空间级隔离。
   */
  constructor(retry?: RetryPolicy | null, bus?: MemoryEventBus) {
    super('mem', retry);
    this.bus = bus ?? MemoryEventBus.getInstance();
  }

  /**
   * 造一个“自带私有总线”的 provider：同进程的其它 `mem:` 地址完全看不到它的队列与订阅。
   * 宿主 + 插件、kernel + provider 各持一个 `Mailbox`，以及测试隔离，都应该用这个。
   */
  static createIsolated(retry?: RetryPolicy | null): MemoryProvider {
    return new MemoryProvider(retry, new MemoryEventBus());
  }

  /**
   * 造一个挂在命名空间总线上的 provider：同 `scope` 共享一份状态，不同 `scope` 互不可见。
   * “一个进程里跑多个互不相干的 `mem:` 世界”用它，不需要自己管总线对象。
   */
  static forScope(scope: string, retry?: RetryPolicy | null): MemoryProvider {
    return new MemoryProvider(retry, MemoryEventBus.getInstance(scope));
  }

  /**
   * 丢弃这份总线上的所有消息（含 in-flight），订阅保持不变。
   *
   * 代价要写清楚：默认构造的 provider 共用进程级单例总线，`clear()` 就是清空全进程的
   * `mem:` 队列。只想清自己的状态，就用 {@link MemoryProvider.createIsolated} / {@link MemoryProvider.forScope}。
   */
  public async clear(): Promise<void> {
    this.bus.clear();
  }

  /**
   * 发送并给广播挂上结算 barrier：等这条消息的全部投递（含重试链）落定后，才决定要不要
   * 把它退回队列（判定在基类的 `shouldRequeueAfterBroadcast`，issue#2）。
   */
  protected async _send(message: MailMessage): Promise<void> {
    const topic = getCanonicalMailboxAddressIdentifier(message.to);
    const deliveries = this.bus.publish(topic, message);
    if (!deliveries) {
      return; // 没有订阅者：消息入队，由 fetch / ack 那套语义负责
    }
    this._trackBroadcastSettlement(message, deliveries);
  }

  protected _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => Promise<DeliveryResult>,
  ): any {
    const topic = getCanonicalMailboxAddressIdentifier(address);
    // The returned unsubscribe function is the "unsubscribeHandle"
    return this.bus.subscribe(topic, onReceive);
  }

  protected async _unsubscribe(
    subscriptionId: string, // Not used by MemoryProvider, the handle is sufficient
    unsubscribeHandle: any,
  ): Promise<void> {
    if (typeof unsubscribeHandle === 'function') {
      unsubscribeHandle();
    }
  }

  protected async _fetch(
    address: URL,
    options?: { manualAck?: boolean; ackTimeout?: number | null },
  ): Promise<MailMessage | MailMessageAckable<MailMessage> | null> { // Updated return type
    const topic = getCanonicalMailboxAddressIdentifier(address);

    if (!options?.manualAck) {
      const message = this.bus.fetchAndForget(topic);
      return message || null;
    }

    const ackableMessage = this.bus.fetchForAck(topic, {
      staleTimeout: options?.ackTimeout,
    });
    return ackableMessage || null;
  }

  /**
   * 只读快照：副本，不动队列、不建 in-flight、不刷活动时间。
   *
   * 之前没有这个能力：想“看一眼”只能 `fetch({ manualAck: true })` 不 ack，消息就进了
   * in-flight（默认 30s 后重投），既干扰正常消费者的计数，也不是只读（issue#4）。
   */
  protected async _peek(address: URL, options?: { limit?: number }): Promise<MailMessage[]> {
    const topic = getCanonicalMailboxAddressIdentifier(address);
    return this.bus.peek(topic, options?.limit);
  }

  /**
   * 本总线认得的地址（canonical id）—— `mem:` 的消息就在本地，所以能枚举。
   */
  public async listAddresses(): Promise<string[]> {
    return this.bus.listTopics();
  }

  protected async _status(address: URL): Promise<MailboxStatus> {
    const topic = getCanonicalMailboxAddressIdentifier(address);
    const { exists, unreadCount, inFlightCount, lastActivityTime, subscriberCount } =
      this.bus.getStatus(topic);

    if (!exists) {
      // 对“这个地址从不存在”回 `online` + 0，诊断页就分不出「不存在」和「空闲」（issue#4）。
      return {
        state: 'unknown',
        exists: false,
        message: `No queue, subscription or activity is known for '${topic}'.`,
        unreadCount,
        inFlightCount,
        lastActivityTime,
        subscriberCount,
      };
    }

    return {
      state: 'online',
      exists: true,
      unreadCount,
      // in-flight 消息已离开队列但尚未确认，单独报出来，否则 status 会把它们当作已处理完。
      inFlightCount,
      lastActivityTime,
      subscriberCount,
    };
  }

  /**
   * 订阅模式下广播结算后的处置入口（由 `_send` 的 barrier 调用一次，不在每个订阅者失败时调用）。
   *
   * 之前这里是空实现：订阅的消息不再入队后，可重试错误等于消息静默消失。
   * 现在 requeue=true（全部投递都失败）将消息退回 topic 队列头部，可被 `fetch` 取回且在
   * `unreadCount` 里可见；requeue=false（有订阅者成功，或失败不可重试）则按死信处理直接丢弃。
   */
  protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
    if (!requeue) {
      return;
    }
    const topic = getCanonicalMailboxAddressIdentifier(message.to);
    this.bus.requeue(topic, message);
  }
}