// src/lib/MessageQueue.ts

import { copyForPeek, normalizePeekLimit } from './utils'

/**
 * Represents a message that can be manually acknowledged or negatively acknowledged.
 * @template T The type of the message payload.
 */
export type MailMessageAckable<T> = T & {
  /**
   * Acknowledges the message, confirming successful processing.
   */
  ack: () => Promise<void>;
  /**
   * Negatively acknowledges the message, indicating failure to process.
   * @param requeue If true, the message will be added back to the front of the queue. Defaults to false.
   */
  nack: (requeue?: boolean) => Promise<void>;
};

/**
 * 队列自己交给消费者的那个 ackable：与 {@link MailMessageAckable} 同一个形状，但 `ack` / `nack`
 * **报告这次处置有没有落定**。
 *
 * 为什么要把这个数报出来：“处置已经落定”与“处置没发生”在静默 no-op 下完全看不出来，
 * 而上层（provider 的死信接法）必须分清这两者 —— 否则一次重复 `nack(false)` 就会多留一条
 * 死信，而一条已被 stale 扫描重投的消息也会被旧 handle 迟到地判成“放弃”。
 *
 * 对外（`interfaces.ts` 里的 `Ackable`）仍是 `Promise<void>`：忽略返回值的调用方在运行时不受影响，
 * 但这个类型单独存在，因为 TS 里 `Promise<boolean>` 并不可赋给 `Promise<void>` —— 直接改公开
 * 契约会让第三方 provider 的 `_fetch` 编译不过。
 */
export type SettlingAckable<T> = T & {
  /** @returns `true` = 这次真的把消息从 in-flight 结算掉了；`false` = 它已经不归这次 `fetch` 了。 */
  ack: () => Promise<boolean>;
  /**
   * @param requeue 回队（`true`）还是放弃（`false`）。
   * @returns `true` = 处置真的落定；`false` = 重复处置 / 已被重投 / 已被丢弃。
   */
  nack: (requeue?: boolean) => Promise<boolean>;
};

/**
 * A generic, in-memory message queue that supports topic-based queuing and manual acknowledgement.
 *
 * This class provides a reliable queuing mechanism for producer-consumer patterns where consumers
 * might fail and need to retry messages. It features:
 * - Topic-based separation of queues.
 * - FIFO (First-In, First-Out) message delivery.
 * - Auto-acknowledgement mode (fire-and-forget).
 * - Manual acknowledgement mode, which places messages "in-flight" until they are explicitly
 *   acknowledged (`ack`) or negatively acknowledged (`nack`).
 * - Timeout-based requeueing for stale in-flight messages to prevent message loss.
 * - One disposition per handle: a stale (requeued) handle cannot settle the copy a newer consumer
 *   holds, and repeating `ack` / `nack` does not take effect twice.
 *
 * @template T The type of messages in the queue. Must have an `id` property of type string.
 */
/**
 * 手动 ACK 模式下未显式指定 `ackTimeout` 时使用的默认超时（毫秒）。
 *
 * in-flight 消息必须有界：否则消费者崩溃后既取不回来、也不会在状态里可见，
 * 等于静默丢失。传 0（或 null）可以显式关闭超时，消息常驻 in-flight 直到 ack/nack。
 * 该缺省值与 `ackTimeout` 的三态语义在 TS / Python / Rust 三端保持一致。
 */
export const DEFAULT_ACK_TIMEOUT = 30_000;

export class MailMessageQueue<T extends { id: string }> {
  private queues: Map<string, T[]> = new Map();
  // Stores in-flight messages with their original topic for reliable requeueing.
  // `token` 认出“哪一次 fetch 拿走的”：同一条消息被 stale 扫描重投后，旧 handle 不能再把
  // 新消费者手里的那份结算掉（按 id 处理会误伤）。
  private inFlight: Map<string, { message: T; timestamp: number; topic: string; token: number }> = new Map();

  /** in-flight 归属凭据的发号器（仅在本队列实例内比较，不需全局唯一）。 */
  private settlementToken = 0;

  /**
   * Adds a message to the end of a specific topic's queue.
   * @param topic The topic to which the message will be added.
   * @param message The message to enqueue.
   */
  public enqueue(topic: string, message: T): void {
    if (!this.queues.has(topic)) {
      this.queues.set(topic, []);
    }
    this.queues.get(topic)!.push(message);
  }

  /**
   * Dequeues a message from the front of a specific topic's queue.
   *
   * In auto-ack mode (`manualAck: false`), it removes and returns the message.
   * In manual-ack mode (`manualAck: true`), it moves the message to an "in-flight" state
   * and returns an `Ackable` message with `ack` and `nack` methods.
   * The method also triggers a check for stale messages if a timeout is provided.
   *
   * @param topic The topic from which to dequeue a message.
   * @param options Options for the dequeue operation.
   * @param options.manualAck If true, enables manual acknowledgement mode. Defaults to false.
   * @param options.ackTimeout In manual-ack mode, the time in milliseconds after which an
   *   unacknowledged message is considered stale and will be requeued on the next dequeue.
   *   Omitted (or negative) falls back to {@link DEFAULT_ACK_TIMEOUT}; `0` or `null` disables the
   *   stale check entirely (the message stays in-flight until it is ack'd or nack'd).
   * @param options.handoff 交给消费者前的**改写**（可选）：比如给投递轮次 +1（`nextRoundCopy`）。
   *   改写后的副本就是交出去的那一份，也是存进 in-flight 的那一份：所以 `nack(requeue=true)`
   *   放回队列的也是它，否则轮次永远停在第一次取信时的值。只读快照（{@link peek}）不走这里。
   * @returns An `Ackable` message in manual-ack mode, a regular message in auto-ack mode, or `null` if the queue is empty.
   */
  public dequeue(
    topic: string,
    options: { manualAck: true; ackTimeout?: number | null; handoff?: (message: T) => T }
  ): SettlingAckable<T> | null;
  public dequeue(
    topic: string,
    options?: { manualAck?: false; handoff?: (message: T) => T }
  ): T | null;
  public dequeue(
    topic: string,
    options?: { manualAck?: boolean; ackTimeout?: number | null; handoff?: (message: T) => T }
  ): T | SettlingAckable<T> | null {
    // Requeue stale messages whenever manual-ack mode is used. A missing timeout must not
    // mean "never requeue": that leaked the message forever (invisible in status, unrecoverable).
    if (options?.manualAck) {
      const timeout = options.ackTimeout;
      // 0 / null 是显式关闭 stale 扫描的出口；缺省则用 DEFAULT_ACK_TIMEOUT，不再当作“永不超时”。
      if (timeout !== null && timeout !== 0) {
        this.requeueStale(topic, timeout && timeout > 0 ? timeout : DEFAULT_ACK_TIMEOUT);
      }
    }

    const messages = this.queues.get(topic);
    if (!messages || messages.length === 0) {
      return null;
    }

    const message = messages.shift()!; // Consume a message from the queue in FIFO order.

    if (!options?.manualAck) {
      // Auto-ack: simply return the message (交出去也算一轮，同样走 handoff)。
      return options?.handoff ? options.handoff(message) : message;
    }

    // Manual-ack: move message to in-flight and wrap with ack/nack functions.
    // Store the topic along with the message in inFlight
    // in-flight 里存的是 handoff 后的副本：迟到的 `nack(requeue=true)` 才会把带计数的
    // 那一份放回队列，而不是计数停在旧值的原件。
    const handedOff = options.handoff ? options.handoff(message) : message;
    const token = ++this.settlementToken;
    this.inFlight.set(handedOff.id, { message: handedOff, timestamp: Date.now(), topic, token });

    // 句柄自己带 `token`：只有取走它的那一次 fetch 能结算它。
    return {
      ...handedOff,
      ack: async () => this.ack(message.id, token),
      nack: async (requeue = false) => this.nack(message.id, topic, requeue, token),
    };
  }

  /**
   * 【只读】看一眼队列头部最多 `limit` 条消息，**不**改动任何投递状态。
   *
   * 诊断 / 审计需要「看一眼但不消费」。在这之前最接近的做法是 `fetch(addr, { manualAck: true })`
   * 然不 ack（issue#4）：那会把消息弄进 in-flight（默认 30s 后重投），既不是只读，
   * 也会干扰正常消费者的 `unreadCount` / `inFlightCount`。
   *
   * 保证：
   * - 不出队、不建 in-flight、不动 stale 扫描、不改任何时间戳；
   * - 返回副本（见 `copyForPeek`），调用方改不到队列里的对象；
   * - 只涵盖**等待中**的消息；in-flight（已被消费者取走、尚未 ack）不在快照里 ——
   *   它属于那个消费者，只能在 `getStatus().inFlightCount` 里看到。
   *
   * @param topic 要快照的 topic。
   * @param limit 最多返回几条；省略则整个队列。必须是**非负整数**（或 `Infinity`）。
   * @returns 按 FIFO 顺序的消息副本数组；队列为空时是空数组（不是 `null`）。
   * @throws {InvalidFetchOptionsError} `limit` 非法时抛出。
   */
  public peek(topic: string, limit?: number): T[] {
    const capped = normalizePeekLimit(limit)

    const queue = this.queues.get(topic)
    if (!queue || queue.length === 0) {
      return []
    }

    const count = capped === undefined ? queue.length : Math.min(capped, queue.length)
    return queue.slice(0, count).map(copyForPeek) // slice + map：不取走、不反转、不重新排序
  }

  /**
   * 这个 topic 在队列里有没有痕迹（等待中的消息或 in-flight）。
   * 与 {@link has}（按消息 id）不同：这是按 topic 的「存不存在」，用于 status 的 `exists`。
   */
  public hasTopic(topic: string): boolean {
    const queue = this.queues.get(topic)
    if (queue && queue.length > 0) {
      return true
    }
    for (const flight of this.inFlight.values()) {
      if (flight.topic === topic) {
        return true
      }
    }
    return false
  }

  /**
   * 当前有消息（等待中或 in-flight）的 topic 列表，按字典序排序（快照与测试断言需要确定性）。
   */
  public topics(): string[] {
    const known = new Set<string>()
    for (const [topic, queue] of this.queues) {
      if (queue.length > 0) {
        known.add(topic)
      }
    }
    for (const { topic } of this.inFlight.values()) {
      known.add(topic)
    }
    return Array.from(known).sort()
  }

  /**
   * Acknowledges a message, permanently removing it from the in-flight state.
   *
   * 一次处置：同一个 handle 重复 `ack`（或 `ack` 之后再 `nack`）不会第二次生效。
   *
   * @param messageId The ID of the message to acknowledge.
   * @param token 取信时发下的归属凭据（队列自带的 ackable 自己传）。带上它时，只结算
   *   **这一次** fetch 拿走的那份；不带则保持按消息 id 的旧语义（总线级 API）。
   * @returns `true` = 真的结算了；`false` = 已经不在（重复处置 / 已被重投 / 已被丢弃）。
   */
  public ack(messageId: string, token?: number): boolean {
    const flight = this.inFlight.get(messageId);
    if (!flight || (token !== undefined && flight.token !== token)) {
      return false;
    }
    this.inFlight.delete(messageId);
    return true;
  }

  /**
   * Negatively acknowledges a message, removing it from the in-flight state.
   * If `requeue` is true, the message is added back to the front of its original queue.
   *
   * 一次处置：重复 `nack`、或在 `ack` 之后的 `nack` 都不再生效（也不会把已确认的消息
   * 退回队列）。上层要靠这个返回值区分“真的放弃了”与“这次根本没落定”，否则会重复
   * 写死信记录。
   *
   * @param messageId The ID of the message to nack.
   * @param topic The topic the message belongs to. This is used for requeueing.
   * @param requeue If true, the message is re-added to the front of the queue.
   * @param token 取信时的归属凭据；带上就只结算那一次 fetch 拿走的份（见 {@link ack}）。
   * @returns `true` = 处置真的落定；`false` = 重复处置 / 已被重投 / 已被丢弃。
   */
  public nack(messageId: string, topic: string, requeue: boolean, token?: number): boolean {
    const flight = this.inFlight.get(messageId);
    if (!flight || (token !== undefined && flight.token !== token)) {
      return false;
    }
    this.inFlight.delete(messageId);
    if (requeue) {
      // Use the topic stored in inFlight for reliability
      this.requeue(flight.topic, flight.message);
    }
    return true;
  }

  /**
   * Gets the current status of a topic's queue.
   * @param topic The topic to query.
   * @returns An object containing status information: `unreadCount` (waiting in the queue)
   *   and `inFlightCount` (handed to consumers, awaiting ack/nack). Only `unreadCount` is
   *   safe to treat as "delivered"; in-flight messages will come back if they are never ack'd.
   */
  public getStatus(topic: string): { unreadCount: number; inFlightCount: number } {
    const queue = this.queues.get(topic) || [];
    let inFlightCount = 0;
    for (const { topic: messageTopic } of this.inFlight.values()) {
      if (messageTopic === topic) {
        inFlightCount++;
      }
    }
    return {
      unreadCount: queue.length,
      inFlightCount,
    };
  }

  /**
   * Adds a message back to the front of its queue. Used for requeueing.
   *
   * 去重：同一个 `id` 已经在该 topic 队列里、或已被某个消费者取走（in-flight）时，
   * 不再插入副本。一个地址有多个订阅者时，每个失败的订阅者都会触发一次 nack(requeue)；
   * 不去重就会在队列里留下 N 份同一消息（实测：2 个订阅者失败 → `unreadCount` 为 2）。
   *
   * @param topic The topic of the queue.
   * @param message The message to requeue.
   * @returns true 如果消息确实回到队列；false 如果因为重复而跳过。
   */
  public requeue(topic: string, message: T): boolean {
    if (this.inFlight.has(message.id)) {
      return false; // 已有消费者在处理，再插一份就是重复投递
    }
    const queue = this.queues.get(topic);
    if (queue && queue.some((queued) => queued.id === message.id)) {
      return false; // 已在队列里等待，不需要第二份
    }
    if (!queue) {
      this.queues.set(topic, []);
    }
    this.queues.get(topic)!.unshift(message); // Add back to the front
    return true;
  }

  /**
   * 判断某个消息是否已在队列中等待或已被取走（in-flight）。
   */
  public has(messageId: string): boolean {
    if (this.inFlight.has(messageId)) {
      return true;
    }
    for (const queue of this.queues.values()) {
      if (queue.some((queued) => queued.id === messageId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 清空队列状态：不传 `topic` 则清空所有 topic。
   *
   * in-flight 的消息**也**会被丢弃：它同样是队列状态的一部分，只清「等待中」的那一半，
   * 下一轮（或同进程的另一个消费者 / 另一个测试用例）还是会看到残留消息。
   * 被丢弃的 in-flight 消息之后 `ack()` / `nack(requeue)` 都是 no-op —— 不会复活成幽灵消息。
   *
   * @param topic 只清这个 topic；省略则清空全部。
   * @returns 被丢弃的消息数（含 in-flight），便于诊断与断言。
   */
  public clear(topic?: string): number {
    if (topic === undefined) {
      let dropped = this.inFlight.size;
      for (const queue of this.queues.values()) {
        dropped += queue.length;
      }
      this.queues.clear();
      this.inFlight.clear();
      return dropped;
    }

    let dropped = 0;
    const queue = this.queues.get(topic);
    if (queue) {
      dropped += queue.length;
      this.queues.delete(topic); // 连空数组一起删掉，不留尾巴
    }
    for (const [messageId, flight] of Array.from(this.inFlight.entries())) {
      if (flight.topic === topic) {
        this.inFlight.delete(messageId);
        dropped++;
      }
    }
    return dropped;
  }

  /**
   * Scans for and requeues in-flight messages for a specific topic that have exceeded their timeout.
   * This is a recovery mechanism to prevent message loss if a consumer fails.
   * @param topic The topic to check for stale messages.
   * @param timeout The timeout in milliseconds.
   */
  private requeueStale(topic: string, timeout: number): void {
    const now = Date.now();
    // Use Array.from to safely iterate while potentially modifying the map
    for (const [messageId, { message, timestamp, topic: messageTopic }] of Array.from(this.inFlight.entries())) {
      // Check if the message belongs to the topic we are checking and is stale
      if (messageTopic === topic && now - timestamp > timeout) {
        this.inFlight.delete(messageId);
        this.requeue(messageTopic, message);
      }
    }
  }
}
