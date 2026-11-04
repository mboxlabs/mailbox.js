// src/lib/MessageQueue.ts

import { copyForPeek, normalizePeekLimit } from './utils'
import { readSendId, MBX_SEND_ID_HEADER } from './delivery'

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
 * 等于静默丢失。传 0（或 null）是显式退出：那份租约永不过期，只能由它自己的句柄 ack/nack。
 * 该缺省值与 `ackTimeout` 的三态语义在 TS / Python / Rust 三端保持一致。
 */
export const DEFAULT_ACK_TIMEOUT = 30_000;

/**
 * 一条租约（in-flight 记录）：一次 manualAck 取信 = 一份信借出去一段时间。
 *
 * `expiresAt` 是**这条租约自己的**到期时刻（取走那一刻算好），`Infinity` = 永不过期。
 */
/** 一条停放记录：判死但先不丢的那一份，加上「什么时候停的、为什么」。 */
export type ParkedEntry<T> = {
  message: T;
  parkedAt: number;
  reason: string;
};

/** 一条租约（manualAck 取信）：见 {@link MailMessageQueue} 的 `inFlight`。 */
export type InFlightEntry<T> = {
  message: T;
  timestamp: number;
  topic: string;
  /** 这一份的第几次交出去（`<份号>#<次序>`）：同一份被收回重投后就是新的一个。 */
  leaseId: string;
  expiresAt: number;
};

/**
 * `locate(messageId)` 的一条候选：按发送方给的名字**查**到的那一份。
 *
 * 查可以按他们的名字（`order-42` 是人认得的），**动手必须按这里的 `key`**（我们发的份号）。
 * 同名多份时调用方自己选，不靠队列猜。
 */
export type LocatedCopy = {
  /** 份号（结算门的键）：`send:<系统发的 mbx-send-id>`，无号副本退化成 `obj:<对象份号>`。 */
  key: string;
  /** 发送方写在这封信上的名字（只读用途）。 */
  messageId: string;
  /** 系统发的份号；无号副本为 undefined。 */
  sendId?: string;
  /** 这一份现在挂在哪本账上。 */
  topic: string;
  /** 在排队还是在飞。 */
  state: 'queued' | 'inFlight';
  /** 在飞时：这一次交出去的编号（`<份号>#<次序>`）；拿它结算才能避开迟到的旧句柄。 */
  leaseId?: string;
  /** 在飞时：什么时候交出去的（ms epoch）；排队时为 undefined。 */
  since?: number;
};

/** 一个 topic 的队列状态（{@link MailMessageQueue.getStatus}）。 */
export type TopicQueueStatus = {
  /** 还在队列里的份数——唯一能当“还没投出去”的数字。 */
  unreadCount: number;
  /** 已交给消费者、尚未 ack/nack 的份数。 */
  inFlightCount: number;
  /**
   * 在飞但**租约已到期**、还没被收回的份数。
   *
   * 回收是惰性的（无后台定时器，只有下一次 manualAck 取信才扫），所以一个僵死的消费者能把
   * 过期租约永远挂在这里——这个数就是为了让它不再隐形。
   */
  overdueInFlightCount: number;
  /** 最老那条过期租约已经过期多久（ms）；没有过期租约时为 0。 */
  oldestOverdueMs: number;
  /**
   * **停放**的份数：已经判死（不再交给任何人）、但还没被真正丢弃的记录。
   *
   * 它们不在 `unreadCount` 里，也永远不会被 `dequeue` 交出来——只看得到、拿得出来。
   * 没有这个数，运维就只能看到「没未读」，看不出「有一条判死的停在这儿」。
   */
  parkedCount: number;
  /** 最老那条停放记录停了多久（ms）；没有停放时为 0。 */
  oldestParkedMs: number;
};

/** 每个 topic 最多留多少条停放记录；超了淘汰最老的并**出声**（不静默丢）。 */
export const MAX_PARKED_PER_TOPIC = 100;

export class MailMessageQueue<T extends { id: string }> {
  private queues: Map<string, T[]> = new Map();
  // Stores in-flight messages with their original topic for reliable requeueing.
  //
  // **键是「哪一份信」（{@link MailMessageQueue.copyKeyOf}），不是消息 id。**
  // id 是发送方给的名字，可以重复；拿它当键，同 id 的两份信就会互相顶替：
  // 后取走的那份把先取走的挤掉（先那份从此不在任何状态里）、回队被当成重复吞掉。
  /**
   * 一条租约：一次 manualAck 取信 = 一份信借出去一段时间。
   *
   * `expiresAt` 是**这条租约自己的到期时刻**（取走那一刻就算好了，`Infinity` = 永不过期）。
   * 不能拿“清扫时调用者传的 timeout”当到期判据：那个数只描述调用者自己想要多长的租，
   * 与别人手里那条租约无关——否则一个消费者的一次取信就能提前接管（或推迟接管）别人的租约。
   */
  private inFlight: Map<string, InFlightEntry<T>> = new Map();

  /**
   * 消息 id → 在飞键列表（按取走顺序）。
   *
   * **只为只读的 `locate()` / `has()` 服务**：按发送方的名字查账。结算门不走这里——
   * 那个名字可以重复，拿它定位就会默默命中别人的那一份（F7）。
   */
  private inFlightById: Map<string, string[]> = new Map();

  /**
   * in-flight 归属凭据？不。这里**没有**发号器：结算只认份号（`copyKeyOf`），
   * 而份号在副本进入系统时由 `MailboxProvider.send()` 发一次，队列不自己造号。
   */

  /**
   * 对象身份 → 份号。只在副本**不带** `mbx-send-id` 时用作兜底（有人不经 provider 直接往队列里
   * 塞东西：非规范用法，后果由用的人承担）。兜底不造新号，而是按对象身份认份：
   * 同一对象永远是同一份，所以去重守卫仍然成立（降级方向是“可能多投”，不是“丢信”）。
   */
  private readonly instanceTags = new WeakMap<object, number>();

  private instanceSeq = 0;

  /**
   * 在飞记录：`copyKey`（哪一份信）+ `leaseId`（这一份的第几次交出去）。
   *
   * 两个身份不能合成一个：
   * - 只认份号 ⇒ 同一份信被过期收回后会被再交一次，旧消费者的迟到句柄拿着同一个份号
   *   就能销掉新消费者的租约（回归测试：`stale 重投后的旧 handle 不能动新消费者的 in-flight`）。
   * - 只认句柄 ⇒ 两份同 id 的信互相顶替（F7）。
   *
   * `leaseSeq` 只是发这个后缀的全局发号器（不回收、不比较大小），不是归属凭据：归属靠份号，
   * 句柄只能来自取信那一次。
   */
  private leaseSeq = 0;

  /** 无号副本只告警一次（说清降级，但不刷屏）。 */
  private warnedMissingSendId = false;

  /**
   * 停放区：`topic → 判死但先不丢的记录`。
   *
   * 为什么要有第三个状态：交付流只有「未读 / 在飞」两态，而「到此为止」的东西（死信链封顶
   * 就是典型）如果继续留在未读里，排空脚本就会永远取到同一条——`nack(false)` 那句
   * 「不会再交给你」就成了谎话。停放 = 不出队、不交付、但可查、可清。
   */
  private readonly parked: Map<string, ParkedEntry<T>[]> = new Map();

  /**
   * Adds a message to the end of a specific topic's queue.
   *
   * 这里**不**按 id 去重：每次 `post()` 交进来的都是一份新的信，同 id 只是发送方说
   * 「我认为这是同一封」。要不要把重复的丢掉是发送边界的事（需要发送方显式声明、
   * 并且当场告知），不是队列自己默默判定的事。
   *
   * @param topic The topic to which the message will be added.
   * @param message The message to enqueue.
   */
  public enqueue(topic: string, message: T): void {
    // 不带份号的副本：非规范用法（走 `Mailbox` / provider 的副本必然已发过号）。
    // 不抛、也不在这里造号：抛会把调用方的越界变成运行时崩溃；造号会破坏“同一个对象就是
    // 同一份”这个去重守卫依赖的不变量（每次 enqueue 一个新号 = 同一份信变成两本账）。
    // 只说一次，让降级可见。
    if (readSendId(message) === undefined && !this.warnedMissingSendId) {
      this.warnedMissingSendId = true;
      console.warn(
        `[MailMessageQueue] a copy entered the queue without a system-owned \`${MBX_SEND_ID_HEADER}\`; ` +
          'per-copy accounting degrades to object identity (same object = same copy; a rebuilt copy counts as a new one). ' +
          'Mint the id once at your entry boundary (`MailboxProvider.generateId()`) if you bypass Mailbox#post().',
      );
    }
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
   * Every manual-ack dequeue also sweeps this topic's *expired* leases back into the queue
   * (there is no background timer; see {@link getStatus}'s `overdueInFlightCount`).
   *
   * @param topic The topic from which to dequeue a message.
   * @param options Options for the dequeue operation.
   * @param options.manualAck If true, enables manual acknowledgement mode. Defaults to false.
   * @param options.ackTimeout In manual-ack mode, how long **this** lease stays valid, in ms.
   *   It is fixed at handoff time and recorded on the lease: another consumer's `ackTimeout`
   *   can neither shorten it (an unexpired lease is never swept back) nor stretch it (an expired
   *   lease is swept back no matter how long the next caller asks for). Omitted (or negative /
   *   non-finite) falls back to {@link DEFAULT_ACK_TIMEOUT}; `0` or `null` means *this lease never
   *   expires* — it stays in-flight until its own handle acks or nacks it.
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
    // 租约回收是惰性的：只有 manualAck 取信时顺手扫（无后台定时器）。扫的是**每条租约自己的
    // 到期时刻**（`InFlightEntry.expiresAt`）。缺省的租约不能当成“永不回队”：那会把信永久
    // 泄漏在在飞里（状态里取不到、也不会自愈）——所以缺省走 DEFAULT_ACK_TIMEOUT。
    if (options?.manualAck) {
      this.sweepExpired(topic);
    }

    const messages = this.queues.get(topic);
    if (!messages || messages.length === 0) {
      return null;
    }

    const message = messages.shift()!; // Consume a message from the queue in FIFO order.

    if (!options?.manualAck) {
      // Auto-ack: simply return the message (交出去也算一轮，同样走 handoff)。
      if (!options?.handoff) {
        return message;
      }
      const handedPlain = options.handoff(message);
      this.inheritTag(handedPlain, message);
      return handedPlain;
    }

    // Manual-ack: move message to in-flight and wrap with ack/nack functions.
    // Store the topic along with the message in inFlight
    // in-flight 里存的是 handoff 后的副本：迟到的 `nack(requeue=true)` 才会把带计数的
    // 那一份放回队列，而不是计数停在旧值的原件。
    const handedOff = options.handoff ? options.handoff(message) : message;
    this.inheritTag(handedOff, message);
    const key = this.copyKeyOf(handedOff); // 这一份是谁（不是发送方的名字）
    const leaseId = `${key}#${++this.leaseSeq}`; // 这一份的第几次交出去
    const now = Date.now();
    const lease = MailMessageQueue.leaseDurationMs(options.ackTimeout);
    this.addFlight(key, handedOff.id, {
      message: handedOff,
      timestamp: now,
      topic,
      leaseId,
      expiresAt: Number.isFinite(lease) ? now + lease : Number.POSITIVE_INFINITY,
    });

    // 句柄捕获“这一份 + 这一次交出去”：只有取走它的那一次 fetch 能结算它；
    // 这一份被收回重投后，旧句柄的 `leaseId` 对不上，就不能动新消费者的租约。
    return {
      ...handedOff,
      ack: async () => this.ack(key, leaseId),
      nack: async (requeue = false) => this.nack(key, requeue, leaseId),
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
   * 这份消息在队列里的「份号」（按对象身份）。
   */
  private tagOf(message: object): number {
    let tag = this.instanceTags.get(message);
    if (tag === undefined) {
      tag = ++this.instanceSeq;
      this.instanceTags.set(message, tag);
    }
    return tag;
  }

  /**
   * 记账的键：这份信是谁。
   *
   * 优先用发送边界发的 `mbx-send-id`（见 `delivery.ts`）：投递副本是被一路 `{...message}`
   * 拷出来的，只有 headers 能穿过每一次拷贝活下来，对象身份活不下来。
   * 没这个头（队列单独使用、消息不带控制平面）时才退回按对象身份认。
   */
  private copyKeyOf(message: T): string {
    const sendId = readSendId(message);
    return sendId === undefined ? `obj:${this.tagOf(message)}` : `send:${sendId}`;
  }

  /** handoff 改写出来的副本继承原件的份号（只有走对象身份那条路时才用得上）。 */
  private inheritTag(copy: T, from: T): void {
    if (readSendId(copy) === undefined) {
      this.instanceTags.set(copy, this.tagOf(from));
    }
  }

  private addFlight(key: string, messageId: string, flight: InFlightEntry<T>): void {
    this.inFlight.set(key, flight);
    const keys = this.inFlightById.get(messageId);
    if (keys) {
      keys.push(key);
    } else {
      this.inFlightById.set(messageId, [key]);
    }
  }

  private dropFlight(key: string): void {
    const flight = this.inFlight.get(key);
    this.inFlight.delete(key);
    if (!flight) {
      return;
    }
    const keys = this.inFlightById.get(flight.message.id);
    if (!keys) {
      return;
    }
    const at = keys.indexOf(key);
    if (at >= 0) {
      keys.splice(at, 1);
    }
    if (keys.length === 0) {
      this.inFlightById.delete(flight.message.id);
    }
  }

  /**
   * 按发送方给的名字**查**账（只读）：这个名字可以重复，所以返回的是候选清单。
   *
   * 搜索按他们的名字，动手按我们发的 `key`：查到后拿 `key` 去 `ack` / `nack`。
   * 不改动任何状态（不扫、不刷新活动时间、不动顺序）。
   */
  public locate(messageId: string): LocatedCopy[] {
    const found: LocatedCopy[] = [];
    for (const key of this.inFlightById.get(messageId) ?? []) {
      const flight = this.inFlight.get(key);
      if (!flight) {
        continue;
      }
      found.push({
        key,
        messageId,
        sendId: readSendId(flight.message),
        topic: flight.topic,
        state: 'inFlight',
        since: flight.timestamp,
        leaseId: flight.leaseId,
      });
    }
    for (const [topic, queue] of this.queues) {
      for (const queued of queue) {
        if (queued.id === messageId) {
          const key = this.copyKeyOf(queued);
          if (!found.some((f) => f.key === key)) {
            found.push({ key, messageId, sendId: readSendId(queued), topic, state: 'queued' });
          }
        }
      }
    }
    return found;
  }

  /**
   * Acknowledges a **copy**, permanently removing it from the in-flight state.
   *
   * 一次处置：同一个 handle 重复 `ack`（或 `ack` 之后再 `nack`）不会第二次生效。
   *
   * @param key **份号**（这一份是谁）：由取信的 handle 自己传，或从 {@link locate} 里拿。
   *   传发送方写的消息 id **不会命中**（回 `false`）——那个名字可以重复，拿它定位就会
   *   默默结算到别人手里那一份（F7）。
   * @param leaseId 这一份的第几次交出去（handle 自己传，或 `locate()` 结果里的 `leaseId`）。
   *   传了就只结算那一次租约：这一份被收回重投后，旧句柄对不上号，只能回 `false`。
   *   不传 = 结算这一份当前的租约（运维 / broker 式 provider 的口径）。
   * @returns `true` = 真的结算了；`false` = 已经不在（重复处置 / 已被重投 / 已被丢弃）。
   */
  public ack(key: string, leaseId?: string): boolean {
    const flight = this.inFlight.get(key);
    if (!flight) {
      return false;
    }
    // 迟到的旧句柄：这一份已经被收回重投，现在那份租约不归它。
    if (leaseId !== undefined && flight.leaseId !== leaseId) {
      return false;
    }
    this.dropFlight(key);
    return true;
  }

  /**
   * Negatively acknowledges a **copy**, removing it from the in-flight state.
   * If `requeue` is true, the copy goes back to the front of **the queue it came from**
   * （topic 取自己在飞记录里存的，不是调用方当场报的那个）。
   *
   * 一次处置：重复 `nack`、或在 `ack` 之后的 `nack` 都不再生效（也不会把已确认的消息
   * 退回队列）。上层要靠这个返回值区分“真的放弃了”与“这次根本没落定”，否则会重复
   * 写死信记录。
   *
   * @param key 份号（见 {@link ack}）。
   * @param requeue If true, the copy is re-added to the front of its own queue.
   * @param leaseId 第几次交出去（见 {@link ack}）：迟到的旧句柄不能把别人手里的租约退回队列。
   * @returns `true` = 处置真的落定；`false` = 重复处置 / 已被重投 / 已被丢弃。
   */
  public nack(key: string, requeue: boolean, leaseId?: string): boolean {
    const flight = this.inFlight.get(key);
    if (!flight) {
      return false;
    }
    if (leaseId !== undefined && flight.leaseId !== leaseId) {
      return false; // 迟到的旧句柄：不能把别人手里的租约退回队列
    }
    this.dropFlight(key);
    if (requeue) {
      this.requeue(flight.topic, flight.message);
    }
    return true;
  }

  /**
   * Gets the current status of a topic's queue.
   * @param topic The topic to query.
   * @returns `unreadCount`（还在队列里）、`inFlightCount`（已交给消费者、还没 ack/nack）、
   *   `overdueInFlightCount`（在飞但**租约已到期**、还没被收回的份数）与
   *   `oldestOverdueMs`（最那条已经过期多久）。
   *
   * 只有 `unreadCount` 能当「还没投出去」；in-flight 的会在租约到期后回来，但**回收是惰性的**
   * （只有下一次 manualAck 取信才扫）。所以一个僵死的消费者可以把过期租约永远挂在在飞里 ——
   * `overdueInFlightCount` 就是为了让这种积压不再隐形（运维 / 健康检查该盯它）。
   * 本方法是只读的：不会顺手回收、不刷新时间戳（与 {@link peek} 同理）。
   */
  public getStatus(topic: string): TopicQueueStatus {
    const queue = this.queues.get(topic) || [];
    const now = Date.now();
    let inFlightCount = 0;
    let overdueInFlightCount = 0;
    let oldestOverdueMs = 0;
    for (const { topic: messageTopic, expiresAt } of this.inFlight.values()) {
      if (messageTopic !== topic) {
        continue;
      }
      inFlightCount++;
      if (expiresAt <= now) {
        overdueInFlightCount++;
        oldestOverdueMs = Math.max(oldestOverdueMs, now - expiresAt);
      }
    }
    const parkedList = this.parked.get(topic) ?? [];
    return {
      unreadCount: queue.length,
      inFlightCount,
      overdueInFlightCount,
      oldestOverdueMs,
      parkedCount: parkedList.length,
      oldestParkedMs:
        parkedList.length === 0 ? 0 : Math.max(...parkedList.map((entry) => now - entry.parkedAt)),
    };
  }

  /**
   * 停放一份**判死**的记录：不进队列、不会被 `dequeue` 交出来，只在 `getStatus` 里数得出来、
   * 在 {@link listParked} 里读得出来。
   *
   * 上限 {@link MAX_PARKED_PER_TOPIC}：超了就淘汰最老的，并 `console.warn` 一条——
   * 停放区自己也不能变成静默丢弃的洞。
   */
  public park(topic: string, message: T, reason: string): void {
    const list = this.parked.get(topic) ?? []
    list.push({ message, parkedAt: Date.now(), reason })
    if (list.length > MAX_PARKED_PER_TOPIC) {
      const dropped = list.splice(0, list.length - MAX_PARKED_PER_TOPIC)
      console.warn(
        `[MailMessageQueue] parked records for '${topic}' exceeded ${MAX_PARKED_PER_TOPIC}; ` +
          `dropped the ${dropped.length} oldest (a parking area that silently drops is just another lost letter). ` +
          `Oldest dropped id: ${dropped[0]?.message?.id}.`,
      )
    }
    this.parked.set(topic, list)
  }

  /**
   * 排空停放区：把判死的记录真正丢掉。返回丢掉的份数。
   *
   * 这是停放唯一的出口（它们不进交付流，所以没有 ack 可用）。省略谓词 = 整条队列的停放记录
   * 全清；给谓词 = 只清挑中的那几条。丢弃是**永久**的，所以调用方要么已经读过
   * （{@link listParked}），要么就是在明确接受丢数据。
   */
  public clearParked(topic: string, predicate?: (message: T) => boolean): number {
    const list = this.parked.get(topic)
    if (!list) {
      return 0
    }
    if (predicate === undefined) {
      this.parked.delete(topic)
      return list.length
    }
    const keep = list.filter((entry) => !predicate(entry.message))
    const dropped = list.length - keep.length
    if (keep.length === 0) {
      this.parked.delete(topic)
    } else {
      this.parked.set(topic, keep)
    }
    return dropped
  }

  /** 只读：停放的那些记录（最新的在末尾）。读它不改任何状态。 */
  public listParked(topic: string, limit?: number): T[] {
    const list = this.parked.get(topic) ?? []
    return (limit === undefined ? list : list.slice(-limit)).map((entry) => entry.message)
  }

  /**
   * Adds a message back to the front of its queue. Used for requeueing.
   *
   * 去重是按**哪一份**判的，不是按 id：同一份信已经在该 topic 队列里、或已经被某个消费者取走
   * （in-flight）时，不再插入副本。一个地址有多个订阅者时，每个失败的订阅者都会触发一次
   * nack(requeue)；不去重就会在队列里留下 N 份同一封信（实测：2 个订阅者失败 → `unreadCount` 为 2）。
   *
   * 但**同 id 的另一份信完全不干扰这里**：那是另一封信，它有自己的账。按 id 抑制会把它的回队
   * 当成重复而吞掉 —— 消息既不在队列、也不在死信，零痕迹（F7）。
   *
   * @param topic The topic of the queue.
   * @param message The message to requeue.
   * @returns true 如果消息确实回到队列；false 如果因为**这一份已在队列 / 已在飞**而跳过。
   */
  public requeue(topic: string, message: T): boolean {
    const key = this.copyKeyOf(message);
    if (this.inFlight.has(key)) {
      return false; // 就是这一份正在被处理，再插一份就是重复投递
    }
    const queue = this.queues.get(topic);
    if (queue && queue.some((queued) => this.copyKeyOf(queued) === key)) {
      return false; // 就是这一份已在队列里等待，不需要第二份
    }
    if (!queue) {
      this.queues.set(topic, []);
    }
    this.queues.get(topic)!.unshift(message); // Add back to the front
    return true;
  }

  /**
   * 判断某个消息是否已在队列中等待或已被取走（in-flight）。按 id 问：同 id 有几份都算存在。
   */
  public has(messageId: string): boolean {
    if ((this.inFlightById.get(messageId)?.length ?? 0) > 0) {
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
      for (const list of this.parked.values()) {
        dropped += list.length;
      }
      this.queues.clear();
      this.inFlight.clear();
      this.inFlightById.clear();
      this.parked.clear();
      return dropped;
    }

    let dropped = 0;
    const queue = this.queues.get(topic);
    if (queue) {
      dropped += queue.length;
      this.queues.delete(topic); // 连空数组一起删掉，不留尾巴
    }
    const parkedList = this.parked.get(topic)
    if (parkedList) {
      dropped += parkedList.length
      this.parked.delete(topic)
    }
    for (const [key, flight] of Array.from(this.inFlight.entries())) {
      if (flight.topic === topic) {
        this.dropFlight(key);
        dropped++;
      }
    }
    return dropped;
  }

  /**
   * 这份租约的时长（ms）：`0` / `null` = 永不过期（发送方/消费者显式退出）；
   * 缺省、负数、非法值 = {@link DEFAULT_ACK_TIMEOUT}（缺省不等于“永不回队”）。
   */
  private static leaseDurationMs(ackTimeout?: number | null): number {
    if (ackTimeout === 0 || ackTimeout === null) {
      return Number.POSITIVE_INFINITY;
    }
    if (ackTimeout === undefined || !Number.isFinite(ackTimeout) || ackTimeout < 0) {
      return DEFAULT_ACK_TIMEOUT;
    }
    return ackTimeout;
  }

  /**
   * 把该 topic 上**租约已到期**的在飞收回队列。这是回收机制，用来在消费者崩掉时不丢消息。
   *
   * 到期与否只看每条租约自己的 `expiresAt`（取走那一刻定下的）。调用方的 timeout 不参与：
   * 它既不提前接管未到期的租约，也不拖后已过期的租约。
   *
   * 两个调用入口：① manualAck 取信时顺手扫（惰性）；② **显式**调用（`Mailbox.recover()` 或
   * provider 的 opt-in 定时器）——后者就是为了“再没人来取信”那种topic（最后一个消费者崩了）。
   *
   * @param topic 要扫的 topic。
   * @returns 实际收回了几份（幂等：再扫一次就是 0）。
   */
  public sweepExpired(topic: string): number {
    const now = Date.now();
    let reclaimed = 0;
    // Use Array.from to safely iterate while potentially modifying the map
    for (const [key, { message, expiresAt, topic: messageTopic }] of Array.from(this.inFlight.entries())) {
      // Check if the message belongs to the topic we are checking and is stale
      if (messageTopic === topic && expiresAt <= now) {
        this.dropFlight(key);
        this.requeue(messageTopic, message);
        reclaimed++;
      }
    }
    return reclaimed;
  }
}
