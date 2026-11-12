import { MailboxProvider } from './MailboxProvider';
import {
  Ackable,
  MailMessage,
  MailboxAddressGrammar,
  MailboxStatus,
} from '../interfaces';
import { MailMessageQueue, MailMessageAckable, SettlingAckable, type LocatedCopy } from '../lib/MessageQueue';
import { RetryPolicy } from '../lib/retry';
import { DeliveryResult, MBX_ATTEMPT_HEADER, nextRoundCopy, readRound } from '../lib/delivery';
import { parseMailboxAddress } from '../lib/utils';
import { getCanonicalMailboxAddressIdentifier } from '../lib/scheme-address';
import { Capability } from '../lib/capability';
import { InvalidDeadLetterNestingError, InvalidDeadLetterSuffixError } from '../error';

type Listener = (message: MailMessage) => void | Promise<DeliveryResult | void>;

/**
 * 死信队列后缀的默认值：`mem:host/inbox` 被放弃的消息落在 `mem:host/inbox_dlq`。
 */
export const DEFAULT_DEAD_LETTER_SUFFIX = '_dlq';

/**
 * 死信链的深度上限默认值：**只允许一层** `<topic><suffix>`。
 *
 * 为什么必须有上限：死信 topic 的名字是后缀拼接出来的，所以「消费死信的人自己又失败」
 * 在拓扑上可以无限套（`X_dlq_dlq_dlq…`）——topic 数量与地址长度都会无界增长，
 * 而每一层都要有人消费、都是新的运维负担。对标：SQS 直接拒绝成环的 redrive 拓扑，
 * RabbitMQ 靠 `x-delivery-limit` 给隔离队列封顶。
 *
 * 封顶**不是**丢弃：到顶后记录**原地停放**（park）并打 {@link MBX_DEAD_LETTER_TERMINAL_HEADER}。
 * 要更深的链就显式传 `maxNesting`；`Number.POSITIVE_INFINITY` 是「我不要上限」的出口。
 */
export const DEFAULT_MAX_DEAD_LETTER_NESTING = 1;

/**
 * 死信记录在链里的深度（控制平面，字符串整数）：第一次归档是 1，被再归档一层是 2……
 * 与 topic 名字里的后缀层数一致（两者由同一个函数算，见 `deadLetterDepth`）。
 */
export const MBX_DEAD_LETTER_DEPTH_HEADER = 'mbx-dead-letter-depth';

/**
 * 「到顶了，原地停放」的标记（控制平面，`'true'`）。
 *
 * 为什么需要它：封顶之后记录不会再往下拼一层后缀，它仍然待在**同一条**死信队列里。
 * 没有这个标记，补偿 worker 就会把它当成一条普通死信反复取、反复放弃（空转）而完全看不出来。
 */
export const MBX_DEAD_LETTER_TERMINAL_HEADER = 'mbx-dead-letter-terminal';

/**
 * 校验后缀时用的探针地址（带 path，所以能看出后缀会不会被地址规范化改写）。
 */
const DEAD_LETTER_PROBE_ADDRESS = 'mem://probe@bus/probe';

/**
 * 把死信后缀接在 canonical topic 的 **path 末尾**，返回拼接后的地址（不做规范化）。
 *
 * 为什么不是「接在 canonical id 字符串的末尾」：空 path 的地址（`mem://bus`、`mem://bus/`）
 * 尾部拼接会把后缀落进 authority —— `mem://bus` + `_dlq` 成了 `mem://bus_dlq`，那是**另一个 host**
 * 下的队列，诊断里完全看不出它是 `mem://bus` 的死信。path 为空或就是 `/` 时，后缀前补一个 `/`。
 *
 * 这里不规范化：调用方要比对「拼接后」与「规范化后」两个形式（见 `enableDeadLetterQueue()`）。
 */
function appendDeadLetterSuffix(canonicalTopic: string, suffix: string): string {
  const address = new URL(canonicalTopic);
  // canonical id 的形状就是 `protocol//user@host/pathname`（见 getCanonicalMailboxAddressIdentifier），
  // 按同样的零件重拼即可，后缀只接在 pathname 末尾。
  const path = address.pathname === '' || address.pathname === '/' ? '/' : address.pathname;
  const userInfo = address.username ? `${address.username}@` : '';
  return `${address.protocol}//${userInfo}${address.host}${path}${suffix}`;
}

/** {@link MemoryProvider.enableDeadLetterQueue} 的选项。 */
export interface DeadLetterQueueOptions {
  /**
   * 死信 topic 的后缀（接在原始地址 path 的末尾）。默认 {@link DEFAULT_DEAD_LETTER_SUFFIX}。
   *
   * 后缀必须**已经是规范形式**，否则在 `enableDeadLetterQueue()` 就拒绝（{@link InvalidDeadLetterSuffixError}）：
   * - 空串 / 只剩空白 ⇒ 会把被放弃的消息写回**原队列**（无限重试）；
   * - 带 query / hash ⇒ 会在地址规范化时被静默丢掉；
   * - 会被 URL 改写的形式（非 ASCII、双引号 / 尖括号 / 反引号 / 花括号、NUL 与 C1 控制符、
   *   `.` / `..` 路径段）⇒ 写进去的 key 没有任何地址能命名（取不回来），或塌到别人的活队列里。
   *   要非 ASCII 就写它的 percent-encoding 拼法，例如 `_死信` 要写成 `_%E6%AD%BB%E4%BF%A1`。
   */
  suffix?: string;

  /**
   * 死信链的深度上限（一条消息最多能被归档进几层 `<suffix>`）。默认
   * {@link DEFAULT_MAX_DEAD_LETTER_NESTING}。
   *
   * 到顶之后不报错、也不丢消息：{@link MemoryProvider.deadLetterTopic} 对那条队列返回它**自己**
   * （停放目的地），归档就在原地发生并打 {@link MBX_DEAD_LETTER_TERMINAL_HEADER}。
   * 必须是 ≥ 1 的整数或 `Number.POSITIVE_INFINITY`，否则在 `enableDeadLetterQueue()` 抛
   * {@link InvalidDeadLetterNestingError}（小于 1 = 死信无处可去；NaN / 非整数 = 比较永远不成立，链永不封顶）。
   */
  maxNesting?: number;
}

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
   *
   * 同步返回是有意的，即使 `IMailboxProvider#subscribe()` 返回 Promise：这是进程内的派发总线，
   * 没有 broker 要等，「已生效」在这层就是「已登记」。把它也改成 Promise 只是把破坏性改动
   * 抄进私有实现。
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
   * 交出去也算一轮：用 `handoff` 给 `mbx-round` +1（与基类在订阅侧的 +1 同一套语义）。
   * @param topic The topic to fetch a message from.
   * @returns The message, or undefined if the queue is empty.
   */
  public fetchAndForget(topic: string): MailMessage | undefined {
    this.lastActivity.set(topic, new Date().toISOString()); // Keep last activity update
    return this.messageQueue.dequeue(topic, { handoff: nextRoundCopy }) || undefined;
  }

  /**
   * Fetches a message for manual acknowledgment, moving it to the in-flight state.
   * 顺手把这个 topic 上**已到期**的租约收回队头（扫的是每条租约自己的到期时刻，不是本次传的时长）。
   * 交给消费者时同样给 `mbx-round` +1；存进 in-flight 的是打戳副本，所以 `nack(true)` 放回
   * 队列的那一份带着轮次（否则拉取侧数不出“已经被取了几次”，provider 就无法封顶）。
   * @param topic The topic to fetch a message from.
   * @param options.leaseTimeout **这份租约**的时长（ms）；`0`/`null` = 永不过期，缺省 = 默认租约。
   *   旧名 `staleTimeout` 已改：它不是“清扫用的阈值”（那条不归调用者管），而是这次取信的租期。
   * @returns The message, or undefined if the queue is empty.
   */
  public fetchForAck(
    topic: string,
    options?: { leaseTimeout?: number | null },
  ): SettlingAckable<MailMessage> | undefined {
    this.lastActivity.set(topic, new Date().toISOString()); // Keep last activity update
    // 不把缺省值压成 0：0 现在是“这份租约永不过期”的显式退出，缺省必须走默认租约，
    // 否则未 ack 的消息会永久卡在 in-flight。
    return this.messageQueue.dequeue(topic, {
      manualAck: true,
      ackTimeout: options?.leaseTimeout,
      handoff: nextRoundCopy,
    }) || undefined;
  }

  /**
   * 结算**一份**在飞的副本（确认完成）。
   *
   * @param key 份号（系统发的 `mbx-send-id`），来自取信的 handle 或 {@link locate}。
   * @param leaseId 这一份的第几次交出去（{@link locate} 的 `leaseId`）：传了就只结算那一次租约。
   *   传发送方写在信上的消息 id **不会命中**（回 `false`）：那个名字可以重复，
   *   拿它定位就会默默结算到别人手里那一份。
   * @returns `true` = 这次处置真的落定；`false` = 消息已不在 in-flight（重复处置 / 已被重投）。
   */
  public ack(key: string, leaseId?: string): boolean {
    return this.messageQueue.ack(key, leaseId);
  }

  /**
   * 结算**一份**在飞的副本（否定处置），可选回队。
   *
   * @param key 份号（见 {@link ack}）。
   * @param requeue If true, the copy goes back to the front of **the queue it came from**
   *   （topic 取在飞记录里存的那一个，不是调用方当场报的）。
   * @returns `true` = 处置真的落定；`false` = 重复处置 / 已被重投 / 已被丢弃。
   */
  public nack(key: string, requeue: boolean, leaseId?: string): boolean {
    return this.messageQueue.nack(key, requeue, leaseId);
  }

  /**
   * 按发送方给的名字**查**账（只读）：同名的几份全部列出来，各自带着份号与现在状态。
   *
   * 搜索可以按他们的名字（`order-42` 是人认得的），**动手必须按返回的 `key`**。
   * 不改动任何状态：不扫过期、不刷新活动时间。
   */
  public locate(messageId: string): LocatedCopy[] {
    return this.messageQueue.locate(messageId);
  }

  /**
   * Puts a message back at the front of a topic's queue without going through the
   * in-flight state. Used when a subscriber callback fails with a retriable error.
   *
   * @param topic The topic the message belongs to.
   * @param message The message to requeue.
   * @returns `true` = 确实回了队；`false` = **就是这一份**已经在队列里或已在别人手里（重复回队）。
   *   注意不是“id 重复”：同 id 的另一份信一定会回队。
   */
  public requeue(topic: string, message: MailMessage): boolean {
    this.lastActivity.set(topic, new Date().toISOString());
    return this.messageQueue.requeue(topic, message);
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
   * 追加到队尾（**不是**回队）：回队（`requeue`）把消息放回队头重新参与投递，
   * 归档（死信）是把已经判死刑的消息放到另一条队列里等人工 / 补偿处理，
   * 不该插到别人前面。同时刷活动时间，使死信 topic 在 `status()` 里是 `exists: true`。
   */
  public enqueue(topic: string, message: MailMessage): void {
    this.messageQueue.enqueue(topic, message);
    this.lastActivity.set(topic, new Date().toISOString());
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
   * 显式回收这个 topic 上已到期的租约（`Mailbox#recover()` 往下走的那条路）。
   * @returns 收回了几份（幂等）。
   */
  public reclaimExpired(topic: string): number {
    return this.messageQueue.sweepExpired(topic);
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
    overdueInFlightCount: number;
    oldestOverdueMs: number;
    parkedCount: number;
    oldestParkedMs: number;
    lastActivityTime: string | null;
    subscriberCount: number;
  } {
    const {
      unreadCount,
      inFlightCount,
      overdueInFlightCount,
      oldestOverdueMs,
      parkedCount,
      oldestParkedMs,
    } = this.messageQueue.getStatus(topic);
    const listeners = this.topics.get(topic) || [];
    const lastActivityTime = this.lastActivity.get(topic);
    return {
      exists: this.knows(topic),
      unreadCount,
      inFlightCount,
      // 回收是惰性的：过期但还没被扫回的在飞份数必须单独报，否则僵死消费者的积压完全隐形。
      overdueInFlightCount,
      oldestOverdueMs,
      // 判死但先不丢的那些（死信链封顶就是这种）：不在未读里、不会被交付，只在这里数得出来。
      parkedCount,
      oldestParkedMs,
      lastActivityTime: lastActivityTime ?? null,
      subscriberCount: listeners.length,
    };
  }

  /** 停放一份判死记录（不进交付流）。见 `MailMessageQueue.park`。 */
  public park(topic: string, message: MailMessage, reason: string): void {
    this.messageQueue.park(topic, message, reason);
  }

  /** 只读：某条队列上停放着的记录。 */
  public listParked(topic: string, limit?: number): MailMessage[] {
    return this.messageQueue.listParked(topic, limit);
  }

  /** 排空停放区（永久丢弃）。返回丢掉的份数。 */
  public clearParked(topic: string, predicate?: (message: MailMessage) => boolean): number {
    return this.messageQueue.clearParked(topic, predicate);
  }
}



/**
 * `MemoryProvider` 的可选行为。
 */
export interface MemoryProviderOptions {
  /**
   * **opt-in** 的租约清扫周期（ms）。不传 / `<= 0` / 非法 = 关（默认就是关）。
   *
   * 默认关是因为回收本来挂在“有人来 manualAck 取信”上，往默认路径里塞定时器会改变无轮询
   * 场景的时序。开它的理由只有一个：那个 topic 再没人来取信（最后一个消费者崩了）——过期
   * 租约就永远挂在 in-flight 里，那种时候应当直接调 `Mailbox#recover()`，或者开这个。
   *
   * 定时器 `unref()`（不拖住进程退出），`close()` / `Mailbox#stop()` 时拆掉。
   */
  leaseSweepIntervalMs?: number;
}

export class MemoryProvider extends MailboxProvider {
  /**
   * 这个 provider 用的总线。默认是进程级共享单例（“模拟服务端”语义），
   * 需要实例级隔离时用 {@link MemoryProvider.createIsolated} / {@link MemoryProvider.forScope}，
   * 或直接把自建总线传进构造函数。
   */
  public readonly bus: MemoryEventBus;

  /**
   * 死信队列开关（默认关）。内核只发「放弃」的信号 + 给钩子，往哪写是 provider 的政策——
   * 这里就是一个可参考的接法：写回同一份总线的 `<topic><suffix>`。
   */
  private deadLetter: { suffix: string; maxNesting: number } | null = null;

  /**
   * 订阅是广播：一条消息对每个订阅者各投递一次。失败处理因此走投递级记账，
   * 整条消息回不回队由 `_send` 里的结算 barrier 决定（issue#2）。
   */
  protected readonly broadcastDeliveries = true;

  /**
   * opt-in 的租约清扫定时器（{@link MemoryProviderOptions.leaseSweepIntervalMs}）。
   * `undefined` = 没启动。字段名是契约的一部分（测试就查它有没有 unref）。
   */
  private leaseSweeper?: ReturnType<typeof setInterval>;
  private readonly leaseSweepIntervalMs?: number;

  /**
   * @param retry 可选的订阅重试策略。不传则保持默认：订阅失败只把消息退回队列，不自动重投。
   * @param bus 可选的总线。不传则用进程级共享单例（向后兼容）；
   *   传 `new MemoryEventBus()` 得到实例级隔离，传 `MemoryEventBus.getInstance('scope')` 得到命名空间级隔离。
   * @param options 可选行为（目前只有 opt-in 的租约清扫周期）。
   */
  constructor(retry?: RetryPolicy | null, bus?: MemoryEventBus, options?: MemoryProviderOptions) {
    super('mem', retry);
    this.bus = bus ?? MemoryEventBus.getInstance();
    this.leaseSweepIntervalMs = options?.leaseSweepIntervalMs;
  }

  /**
   * 本 provider 的能力声明。
   *
   * 接口层的可选钩子（`status` / `peek` / `recoverLeases` / `listAddresses` / `clear`）由基类从实现推导；
   * 这里只补**不属于通用接口**的形状：
   *
   * - `parked`：有停放区（`peekParked` / `purgeParked`）——没这个能力就没有「判死但没丢」这个状态可查；
   * - `dead-letter`：只在 `enableDeadLetterQueue()` 之后有（见那两个方法里的声明增删）。
   *   没开时 `discard` 就是纯丢弃、零痕迹——能力声明不说谎。
   */
  protected override declareCapabilities(declared: Set<string>): Set<string> {
    super.declareCapabilities(declared);
    declared.add(Capability.Parked);
    if (this.deadLetter) {
      declared.add(Capability.DeadLetter);
    }
    return declared;
  }

  /**
   * `mem:` 的地址语法（D5）——本 provider 声明，并在自己的**每个**入口执行。
   *
   * 内核不折叠地址、不判等、不禁止 query / fragment：那些规则属于某一个 scheme。
   * 这里把它写成**能问到的数据**，而不是只藏在 {@link MemoryProvider.topicOf} 的实现里。
   */
  public readonly addressGrammar: MailboxAddressGrammar = {
    scheme: 'mem',
    // mailto 形状：`alice@example.com` 是身份（host 段），不是路径；`//` 可写可不写。
    authority: 'optional',
    identity: '身份在 host 段（`alice@example.com`），path 段是信箱内的分区（`/inbox/thread-1`）',
    // 折叠会丢掉 query / fragment（见 topicOf）——所以直接拒绝，而不是静默并入另一条队列。
    query: 'rejected',
    fragment: 'rejected',
    equivalences: [
      '`mem:alice@example.com/inbox` ≡ `mem://alice@example.com/inbox`（多写的 `//` 是容错写法，不是另一个信箱）',
    ],
  };

  /**
   * `mem:` 的等价规则：把地址折叠成本总线的内部队列键。
   *
   * 这是 **scheme 的语法**（见 {@link MemoryProvider.addressGrammar}），不是内核规则：
   * `mem:a@h/i` 与 `mem://a@h/i` 落到同一个键，而带 query / fragment 的写法直接报错
   * （折叠会把它们丢掉，两条业务流静默共用一条队列——issue#4）。
   *
   * 正因为 `_send` / `_fetch` / `_peek` / `_status` / `subscribe` / 死信命名 / 停放区
   * 每个入口都过这里，「同一个地址在所有入口一致」在 `mem:` 里是**结构性成立**的，
   * 不靠调用方小心。
   */
  protected topicOf(address: URL): string {
    return getCanonicalMailboxAddressIdentifier(address);
  }

  /**
   * 只做语法检查、不取键：给那些**不是队列键**的本 scheme 地址用（目前就是 `from`）。
   *
   * 两端必须同规则——否则 `from: 'mem:x@e/u?route=direct'` 这种手滑写法会一端合法、
   * 另一端报错。**别的 scheme 的地址不归本 provider 判**：跨协议路由
   * （`from: 'input:…'` → `to: 'mem:…'`）里 from 走的是别人的语法。
   */
  private checkGrammar(address: URL): void {
    this.topicOf(address);
  }

  /** 这个地址属于本 scheme 吗（`URL#protocol` 带冒号，`this.protocol` 不带）。 */
  private isMine(address: URL): boolean {
    return address.protocol === `${this.protocol}:`;
  }

  /**
   * 启动（opt-in 的）租约清扫定时器。
   *
   * 扫的是整个总线上已知的所有 topic：回收只按**每条租约自己的到期时刻**判，所以定时扫是
   * 安全的——不会动别人未到期的租约，也不会动 `ackTimeout: 0` 的常驻租约。
   * 扫失败不能搞死定时器（否则一个 topic 的异常就把回收关掉了）。
   */
  public async init(): Promise<void> {
    const interval = this.leaseSweepIntervalMs
    if (interval === undefined || !Number.isFinite(interval) || interval <= 0) {
      return // 默认关：默认路径不持有任何定时器
    }
    if (this.leaseSweeper) {
      return // 幂等：重复 init 不叠定时器
    }
    this.leaseSweeper = setInterval(() => {
      try {
        for (const topic of this.bus.listTopics()) {
          this.bus.reclaimExpired(topic)
        }
      } catch (error) {
        console.error(`[${this.protocol}] Lease sweep failed; the timer stays armed:`, error)
      }
    }, interval)
    // 定时器不能拖住进程退出（测试、CLI 都会受影响）
    ;(this.leaseSweeper as unknown as { unref?: () => void }).unref?.()
  }

  /** `close()` / `Mailbox#stop()` 必须拆掉定时器：收尾之后不该再改队列。 */
  protected async _close(): Promise<void> {
    if (this.leaseSweeper) {
      clearInterval(this.leaseSweeper)
      this.leaseSweeper = undefined
    }
  }

  /**
   * 把该地址上**租约已到期**的信收回队列（`Mailbox#recover()` 的实现入口）。
   * 幂等，返回收回了几份。
   */
  public async recoverLeases(address: URL): Promise<number> {
    return this.bus.reclaimExpired(this.topicOf(address))
  }

  /**
   * 造一个“自带私有总线”的 provider：同进程的其它 `mem:` 地址完全看不到它的队列与订阅。
   * 宿主 + 插件、kernel + provider 各持一个 `Mailbox`，以及测试隔离，都应该用这个。
   *
   * 写成 `this`-多态：子类调 `MyProvider.createIsolated()` 必须拿到**子类**实例，否则
   * 子类覆写的钩子会静默没接上（一个“绿得很假”的陷阱）。
   */
  static createIsolated<T extends MemoryProvider>(
    this: new (retry?: RetryPolicy | null, bus?: MemoryEventBus) => T,
    retry?: RetryPolicy | null,
  ): T {
    return new this(retry, new MemoryEventBus());
  }

  /**
   * 造一个挂在命名空间总线上的 provider：同 `scope` 共享一份状态，不同 `scope` 互不可见。
   * “一个进程里跑多个互不相干的 `mem:` 世界”用它，不需要自己管总线对象。
   */
  static forScope<T extends MemoryProvider>(
    this: new (retry?: RetryPolicy | null, bus?: MemoryEventBus) => T,
    scope: string,
    retry?: RetryPolicy | null,
  ): T {
    return new this(retry, MemoryEventBus.getInstance(scope));
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
    if (this.isMine(message.from)) {
      this.checkGrammar(message.from); // from 不是队列键，但它同样是 `mem:` 的地址
    }
    const topic = this.topicOf(message.to);
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
    const topic = this.topicOf(address);
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
    const topic = this.topicOf(address);

    if (!options?.manualAck) {
      const message = this.bus.fetchAndForget(topic);
      return message || null;
    }

    const ackableMessage = this.bus.fetchForAck(topic, {
      leaseTimeout: options?.ackTimeout,
    });
    // 套一层：拉取侧的 `ack` / `nack` 不经过内核记账，一次 fetch = 一次处置；
    // `nack(false)` 在开著死信队列时要先处置、后留痕（基类钩子看不到消费者自己确实 ack）。
    // 带上 `topic`：留痕的目的地必须是这条消息**真正待着**的那条队列，而不是它 `to` 里写的地址
    // （死信记录的 `to` 故意保持业务地址，见 wrapConsumerSettlement）。
    return ackableMessage ? this.wrapConsumerSettlement(ackableMessage, topic) : null;
  }

  /**
   * 只读快照：副本，不动队列、不建 in-flight、不刷活动时间。
   *
   * 之前没有这个能力：想“看一眼”只能 `fetch({ manualAck: true })` 不 ack，消息就进了
   * in-flight（默认 30s 后重投），既干扰正常消费者的计数，也不是只读（issue#4）。
   */
  protected async _peek(address: URL, options?: { limit?: number }): Promise<MailMessage[]> {
    const topic = this.topicOf(address);
    return this.bus.peek(topic, options?.limit);
  }

  /**
   * 只读：这条地址上**停放**着的记录（判死、不再交付、但也没丢）。
   *
   * 停放记录不在 `fetch` / `peek` 的交付流里——否则排空脚本又会取到它。要看只能走这里，
   * 或者看 `status()['mem.parkedCount']`。
   */
  public peekParked(address: string | URL, limit?: number): MailMessage[] {
    const topic = this.topicOf(parseMailboxAddress(address, 'peekParked()'));
    return this.bus.listParked(topic, limit);
  }

  /**
   * 排空停放区：把判死的记录**永久丢掉**，返回丢掉的份数。
   *
   * 停放记录不进交付流（那是 F8 的坑），所以没有 ack 可用来排走它们——唯一的出口就是这里。
   * 先 `peekParked()` 看清要丢什么，再调它。
   */
  public purgeParked(
    address: string | URL,
    predicate?: (message: MailMessage) => boolean,
  ): number {
    const topic = this.topicOf(parseMailboxAddress(address, 'purgeParked()'));
    return this.bus.clearParked(topic, predicate);
  }

  /**
   * 本总线认得的地址（`mem:` 自己的形式）——消息就在本地，所以能枚举。
   * 唯一契约：这些串能原样喂回本 provider（`status` / `fetch` / `recoverLeases`）。
   */
  public async listAddresses(): Promise<string[]> {
    return this.bus.listTopics();
  }

  /**
   * 状态：具名字段只放核心操作本身就有的观测量（D7），本策略的账走命名空间扩展键。
   *
   * 为什么分开：`parkedCount` / `overdueInFlightCount` 讲的是「停放区」与「租约清扫」这两套
   * **投递策略**——换个 broker（AMQP / SQS）这两个概念未必存在，硬塞进核心类型就等于要求所有
   * provider 都长得像 `MemoryProvider`。所以核心具名字段只有
   * `state` / `exists` / `unreadCount` / `inFlightCount` / `lastActivityTime`，
   * `mem:` 自己的观测量挂在 `mem.*` 上（`v1.0.0` 就留好的扩展位）。
   *
   * **`mem:` 没有存活态可报**：进程内总线没有「可达性」这回事，它永远连得上，所以这里
   * 只出 `online` / `unknown` 两档，永远不会出 `offline` / `degraded`。这里的 `online` 说的是
   * 「这条地址我有活动记录（投过 / 订过）」，不是「broker 活着」——存活态由 provider 自己判，
   * 内核只转述。真要测 offline 那一档，得自己扩展一个会答的 provider（直接实现
   * `IMailboxProvider` 的第三方，或子类覆写 `_status`），别指望 `mem:` 报出来。
   */
  protected async _status(address: URL): Promise<MailboxStatus> {
    const topic = this.topicOf(address);
    const {
      exists,
      unreadCount,
      inFlightCount,
      overdueInFlightCount,
      oldestOverdueMs,
      parkedCount,
      oldestParkedMs,
      lastActivityTime,
      subscriberCount,
    } = this.bus.getStatus(topic);
    // `mem:` 的账带 `mem.` 前缀：两个 provider 不会往同一个键上写不同的东西。
    const extension = {
      // 已过期、还没被回收的那部分在飞（回收是惰性的，靠下一次取信或 recover() 才扫）。
      'mem.overdueInFlightCount': overdueInFlightCount,
      'mem.oldestOverdueMs': oldestOverdueMs,
      // 判死但先不丢的份数（死信链封顶那类）：不在 unreadCount 里，也不会再被交付。
      'mem.parkedCount': parkedCount,
      'mem.oldestParkedMs': oldestParkedMs,
      'mem.subscriberCount': subscriberCount,
    };

    if (!exists) {
      // 对“这个地址从不存在”回 `online` + 0，诊断页就分不出「不存在」和「空闲」（issue#4）。
      return {
        state: 'unknown',
        exists: false,
        message: `No queue, subscription or activity is known for '${topic}'.`,
        unreadCount,
        inFlightCount,
        lastActivityTime,
        ...extension,
      };
    }

    return {
      state: 'online',
      exists: true,
      unreadCount,
      // in-flight 消息已离开队列但尚未确认，单独报出来，否则 status 会把它们当作已处理完。
      inFlightCount,
      lastActivityTime,
      ...extension,
    };
  }

  /**
   * 基类的死信钩子（在 `nack` 之后被调，一条广播的全部失败投递一起进来一次）。
   *
   * 以前 MemoryProvider 不接这个钩子：requeue=false（有订阅者成功，或失败不可重试）就等于
   * 消息静默消失。现在：死信开关开着时，这里把**每一条失败的投递**归档一份到
   * `<topic><suffix>`；没开仍是丢弃（默认行为，向后兼容）。默认不开是因为：死信是运维
   * 决定，不是内核默认——开了就会向总线多写一份数据，而那个 topic 还得有人消费。
   *
   * 归档目标按**消息实际所在的那条队列**算。广播侧两者天然相等：`_send` 就是拿
   * `canonical(message.to)` 当 topic 去 publish 的，所以这里用 `to` 没错（拉取侧不一样，
   * 见 {@link wrapConsumerSettlement}）。
   */
  protected _onDeliveryDeadLettered(message: MailMessage, failed: readonly DeliveryResult[]): void {
    if (!this.deadLetter) {
      return;
    }
    const sourceTopic = this.topicOf(message.to);
    for (const failure of failed) {
      this.archiveDeadLetter(message, sourceTopic, {
        reason: failure.reason ?? 'unknown',
        attempts: failure.attempts,
        error: failure.error,
        deliveryId: failure.deliveryId,
      });
    }
  }

  // --- 死信队列（opt-in，参考接法）---

  /** 死信队列是否开着。 */
  public get deadLetterEnabled(): boolean {
    return this.deadLetter !== null;
  }

  /** 当前生效的死信链深度上限；没开启死信队列时 `null`。 */
  public get maxDeadLetterNesting(): number | null {
    return this.deadLetter ? this.deadLetter.maxNesting : null;
  }

  /**
   * 开启死信队列：被放弃的消息（不回队的那些）会在 `<topic><suffix>` 里多出一份可取回的副本。
   *
   * 覆盖两类“放弃”：
   * - 订阅侧：投递不可重试 / 部分失败里失败的那一个（经 `_onDeliveryDeadLettered`）；
   * - 拉取侧：消费者自己 `nack(false)`（它不经过内核钩子，但同样是“放弃”，不能静默消失）。
   *
   * 归档只动 headers（控制平面），不碰业务 `meta` / `body`。
   * 链深默认只允许一层（{@link DEFAULT_MAX_DEAD_LETTER_NESTING}），到顶就地停放。
   */
  public enableDeadLetterQueue(options: DeadLetterQueueOptions = {}): void {
    const suffix = options.suffix ?? DEFAULT_DEAD_LETTER_SUFFIX;
    if (typeof suffix !== 'string' || suffix.length === 0 || /\s/.test(suffix)) {
      throw new InvalidDeadLetterSuffixError(
        suffix,
        'Dead-letter suffix must be a non-empty string without whitespace: an empty suffix would write discarded ' +
        'messages back into the ORIGINAL queue (so they are retried forever).',
      );
    }
    let probeKey: string;
    let candidate: string;
    let canonical: string;
    try {
      // 用地址解析校验一遍：带 query / hash 的后缀在规范化时会被静默丢掉，死信就会落错地方。
      probeKey = this.topicOf(new URL(DEAD_LETTER_PROBE_ADDRESS));
      candidate = appendDeadLetterSuffix(probeKey, suffix);
      canonical = this.topicOf(new URL(candidate));
    } catch (error) {
      throw new InvalidDeadLetterSuffixError(
        suffix,
        `Dead-letter suffix "${suffix}" cannot be used as part of an address: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    // 光「不抛错」不够：后缀还可能被规范化**改写**（非 ASCII → percent-encoding、`.` / `..` 路径段被消掉）。
    // 读路径（fetch / peek / status / snapshot）算出的永远是改写后的形式，而写入用的却是拼接的原始串——
    // 于是死信进了总线，却没有任何地址能命名它（取不出来的死信比没有死信更糟）。
    // 宁可拒绝，也不静默改写：`.` / `..` 这类改写塌到的可能是一条**活着**的队列，与「空后缀被禁」同理。
    if (canonical !== candidate) {
      const canonicalSuffix = canonical.slice(probeKey.length);
      throw new InvalidDeadLetterSuffixError(
        suffix,
        `Dead-letter suffix "${suffix}" is not in canonical form: address canonicalization rewrites it to "${canonicalSuffix}" ` +
        `(dead-letter topic "${canonical}"). A dead-letter topic must be nameable by the same address used to read it back. ` +
        `Use the canonical spelling "${canonicalSuffix}" or a plain ASCII suffix such as "${DEFAULT_DEAD_LETTER_SUFFIX}".`,
      );
    }
    // 链深上限与后缀同理：非法值不能让链无界增长，也不能让死信无处可去。必须在赋值前校验，
    // 否则一次错配置会把已经跑着的死信政策改成“永不封顶”。
    // 只有 `undefined` 算「没传」；`null` 必须拒绝——把它当成缺省就是静默接受“无上限”。
    const maxNesting = options.maxNesting === undefined
      ? DEFAULT_MAX_DEAD_LETTER_NESTING
      : options.maxNesting;
    if (
      typeof maxNesting !== 'number'
      || (!Number.isSafeInteger(maxNesting) && maxNesting !== Number.POSITIVE_INFINITY)
      || maxNesting < 1
    ) {
      throw new InvalidDeadLetterNestingError(
        maxNesting,
        `Dead-letter nesting limit must be an integer >= 1 or Number.POSITIVE_INFINITY, got ${String(maxNesting)}: ` +
        'a limit below 1 leaves discarded messages nowhere to go, while NaN or a fractional limit never compares greater ' +
        `than itself, so the dead-letter chain would never be capped. Use ${DEFAULT_MAX_DEAD_LETTER_NESTING} for a single '${DEFAULT_DEAD_LETTER_SUFFIX}' level.`,
      );
    }
    this.deadLetter = { suffix, maxNesting };
    // 能力声明跟着配置走：开了死信才有 `dead-letter`（谁改行为谁更新声明）。
    this.supports.add(Capability.DeadLetter);
  }

  /** 关闭死信队列：之后被放弃的消息回到默认的“直接丢弃”。 */
  public disableDeadLetterQueue(): void {
    this.deadLetter = null;
    this.supports.delete(Capability.DeadLetter);
  }

  /**
   * 死信归档的目的地 —— **唯一**的拼接点。
   *
   * 写入（`archiveDeadLetter`）与对外报告（{@link deadLetterTopic}）必须走同一个函数：
   * 两处各自拼一次字符串就会漂移成「写进去的 key」与「读路径规范化后的 key」不是同一个，
   * 记录就在总线上变成一条无法命名的队列。后缀已在 `enableDeadLetterQueue()` 里校验过是规范
   * 安全的，这里再规范化一次作为兜底：写进总线的 key **永远**是规范形式。
   *
   * 封顶时返回**入参本身**（而不是拼不出新后缀就报 `null`）：到顶不等于丢弃，记录就地停放。
   * 这也让 {@link deadLetterTopic} 在封顶处报的是真正会被写入的那条队列，不是一个永远为空的地址。
   *
   * @param canonicalTopic 消息**实际所在**那条队列的 canonical id。
   * @returns 归档目的地（canonical id）；没开启死信队列时 `null`。
   */
  private deadLetterKey(canonicalTopic: string): string | null {
    if (!this.deadLetter) {
      return null;
    }
    if (this.deadLetterDepth(canonicalTopic) + 1 > this.deadLetter.maxNesting) {
      return canonicalTopic; // 封顶：就地停放（目的地就是它自己）
    }
    return this.topicOf(
      new URL(appendDeadLetterSuffix(canonicalTopic, this.deadLetter.suffix)),
    );
  }

  /**
   * 剥掉一层死信后缀，得到它在链里的上一层。
   *
   * 剥出来的父地址必须是规范形式，否则不算嵌套——与后缀校验同一条理由：写进去的 key 与
   * 读路径算出的 key 必须是同一个。
   *
   * 注意取舍：**链深是按名字界定的**——名字以 `<suffix>` 结尾的队列就是被当作第 1 层，
   * 即使它是业务自己起的名字（如 `orders_dlq`）。这是“DLQ 命名空间按命名界定”的代价：
   * 只有名字能回答“这个地址的死信会去哪”，消息头只对手上那份副本有效，且重投一次就洗掉。
   * 拿不准就换一个不容易撞业务名的后缀（`.dlq`、`/retry`）。
   */
  private deadLetterParent(topicKey: string, suffix: string): string | null {
    if (!topicKey.endsWith(suffix)) {
      return null;
    }
    const parent = topicKey.slice(0, topicKey.length - suffix.length);
    if (parent.length >= topicKey.length) {
      return null; // 保险：空后缀（已在 enableDeadLetterQueue 里禁止）会造成无限剥
    }
    try {
      return this.topicOf(new URL(parent)) === parent ? parent : null;
    } catch {
      return null;
    }
  }

  /**
   * 一条 topic 在死信链里的层数：按**名字**反复剥后缀（0 = 普通队列）。
   *
   * 为什么按名字而不是按消息头：封顶判定（写入）与 {@link deadLetterTopic}（报告）必须用同一个
   * 口径，否则会出现「判断说没封顶、报告说已封顶」的漂移；而消息头只对那一份副本有效，
   * 对“一个地址的死信会去哪”这个可诊断问题没有意义。深度头（{@link MBX_DEAD_LETTER_DEPTH_HEADER}）
   * 就是从这里的层数算出来的，两者永远一致。
   */
  private deadLetterDepth(topicKey: string): number {
    const suffix = this.deadLetter!.suffix;
    let current = topicKey;
    let level = 0;
    for (;;) {
      const parent = this.deadLetterParent(current, suffix);
      if (parent === null) {
        return level;
      }
      current = parent;
      level++;
    }
  }

  /**
   * 某个地址的被放弃消息会去哪（canonical id）；没开启时返回 `null`。
   * 拿它去 `fetch` / `peek` / `status` 就能消费死信：返回的 key 与归档写入的 key 是同一个，
   * 而且一定是规范形式（能被任何读路径重新算出来）。
   *
   * 已封顶的地址返回**它自己**：那层不会再拼新后缀（见 {@link DEFAULT_MAX_DEAD_LETTER_NESTING}），
   * 新的死信就地停放。返回一个会被拼出来、但永远不会被写入的地址，比不返回更坑：
   * 诊断页会指着一个空队列说“死信在这”。
   */
  public deadLetterTopic(address: string | URL): string | null {
    if (!this.deadLetter) {
      return null;
    }
    const parsed = parseMailboxAddress(address, 'deadLetterTopic()');
    return this.deadLetterKey(this.topicOf(parsed));
  }

  /**
   * 归档一份死信记录：副本 + 控制头，追加到目标死信 topic 队尾。
   *
   * 为什么带这些头：死信记录要能回答「为什么死的 / 试了几次 / 原来在哪」，
   * 否则 DLQ 只是另一堆看不出来历的消息。控制信息走 headers，不碰 `meta`（数据平面）。
   * 三个计数别混：`mbx-dead-letter-attempts` 是**重试链内**试了几次，
   * `mbx-dead-letter-round` 是这条消息在进行第几轮投递（只在 > 0 时写），
   * `mbx-dead-letter-depth` 是它现在所在的**死信链层数**（第一次归档 = 1，与队列名里的后缀层数一致）。
   *
   * `mbx-dead-letter-topic` 写的是**上一跳的队列**（来源 key），不是 `message.to`：
   * 归档副本的 `to` 故意保持业务地址（重放契约），所以它早已不是「它现在在哪」的凭据；
   * 链要靠这个头追溯（上一跳的头会被副本继承）。
   *
   * 到顶时（{@link DEFAULT_MAX_DEAD_LETTER_NESTING}）不再往下拼后缀：记录**停放**
   * （{@link MailMessageQueue.park}）、打 {@link MBX_DEAD_LETTER_TERMINAL_HEADER}，并大声记一条
   * CRITICAL。停放不是重新入队：它不进交付流、不在 `unreadCount` 里，只能查
   * （{@link peekParked}）或显式丢弃（{@link purgeParked}）——把判死的记录塞回队列等于违反
   * `nack(false)` 那句「不会再交给你」（F8：排空脚本永远取到同一条）。既不静默丢，也不让
   * topic 数量无界增长。
   */
  private archiveDeadLetter(
    message: MailMessage,
    sourceTopic: string,
    detail: { reason: string; attempts?: number; error?: string; deliveryId?: string; at?: string },
  ): void {
    const deadLetterTopicKey = this.deadLetterKey(sourceTopic);
    if (deadLetterTopicKey === null) {
      return;
    }
    // 封顶：目的地就是来源队列本身（见 deadLetterKey）——原地停放，不拆新 topic。
    const parked = deadLetterTopicKey === sourceTopic;
    // 深度按**目的地**那一层算（而不是“被归档了几次”）：头里的数字必须与队列名里的后缀层数
    // 一致，否则同一件事会有两个口径（封顶后原地停放的记录仍停在第 N 层）。
    const depth = this.deadLetterDepth(deadLetterTopicKey);
    // 拉取模式下传进来的可能是带 `ack` / `nack` 的 ackable 包装：归档副本不该带着旧消费者的句柄。
    const { ack: _ack, nack: _nack, ...envelope } = message as MailMessage & Partial<Ackable>;
    const round = readRound(message);
    const record: MailMessage = {
      ...envelope,
      // 控台字段拷一份：不让归档副本与在途消息共享同一个 URL / headers 对象。
      from: new URL(message.from.href),
      to: new URL(message.to.href),
      headers: {
        ...(message.headers ?? {}),
        'mbx-dead-letter': 'true',
        'mbx-dead-letter-topic': sourceTopic,
        'mbx-dead-letter-reason': detail.reason,
        'mbx-dead-letter-attempts': String(detail.attempts ?? message.headers?.[MBX_ATTEMPT_HEADER] ?? 1),
        ...(round > 0 ? { 'mbx-dead-letter-round': String(round) } : {}),
        'mbx-dead-letter-error': detail.error ?? '',
        ...(detail.deliveryId ? { 'mbx-dead-letter-delivery': detail.deliveryId } : {}),
        'mbx-dead-letter-at': detail.at ?? new Date().toISOString(),
        [MBX_DEAD_LETTER_DEPTH_HEADER]: String(depth),
        ...(parked ? { [MBX_DEAD_LETTER_TERMINAL_HEADER]: 'true' } : {}),
      },
    };
    if (parked) {
      // 封顶 ⇒ **停放**，不是原地重新入队。`nack(false)` 对外只有一句承诺：「不会再交给你」。
      // 把副本 `enqueue` 回同一条队列就是反悔：排空脚本永远取到同一条，`unreadCount` 永不下降（F8）。
      this.bus.park(sourceTopic, record, `dead-letter nesting limit (${this.deadLetter?.maxNesting})`);
      console.error(
        `[${this.protocol}] CRITICAL: Message ${record.id} reached the dead-letter nesting limit ` +
        `(${this.deadLetter?.maxNesting}) in '${sourceTopic}'. It is parked there (no longer deliverable), marked ` +
        `${MBX_DEAD_LETTER_TERMINAL_HEADER}=true, instead of opening one more dead-letter level. ` +
        `Read it with peekParked() / status()['mem.parkedCount'], or raise maxNesting if this chain is intentional.`,
      );
      return;
    }
    this.bus.enqueue(deadLetterTopicKey, record);
  }

  /**
   * 拉取模式下的 `ack` / `nack` 同样是处置。这条路径不经过内核的投递结算（消费者自己拿着
   * ackable），基类钩子看不到它，所以 provider 自己接——接的规矩与内核一致：
   *
   * 1. **一次 fetch = 一次处置**：同一个 handle 上只有第一次 `ack` / `nack` 生效。少了这一层，
   *    重试 / 兜底代码里常见的「再 nack 一次」就会多留一条死信（补偿脚本会重复补偿），
   *    `ack()` 之后再 `nack(false)` 还会给处理成功的消息写死信。
   * 2. **先处置、后留痕**：与基类的 `_giveUpDelivery` 同一顺序——消息不会
   *    同时待在队列（或 in-flight）和 DLQ 里。
   * 3. **处置没落定就不留痕**：消息已被 stale 扫描重投 / 已被 `clear()` 丢弃 / 已归另一个消费者
   *    时，迟到的 `nack(false)` 不是“放弃”，不该产生死信记录。
   * 4. 归档失败只记录、不把处置打断：处置已经发生，消息已离开队列；回滚处置会把它留成
   *    永久 in-flight 并被 stale 扫描无限重投（毒消息），比少一条死信更糟。
   *
   * 5. **归档目标用 `sourceTopic`（这次 `fetch` 真正取信的队列），不是 `ackable.to`**。
   *    两者对普通队列相等，对死信记录则不同：归档副本的 `to` 是原始业务地址（重放契约），
   *    用 `to` 算目标就会把从 `X_dlq` 取出的记录又归档回 `X_dlq`——同一条队列既进又出，
   *    毒记录永不出局（补偿 worker 无限轮询它），而 `deadLetterTopic('X_dlq')` 报出的那层
   *    永远是空的。队列层已经用的是这个口径（`MailMessageQueue.nack` 拿 `flight.topic` 回队），
   *    两侧不能漂。
   */
  private wrapConsumerSettlement(
    ackable: SettlingAckable<MailMessage>,
    sourceTopic: string,
  ): MailMessageAckable<MailMessage> {
    const provider = this;
    const originalAck = ackable.ack.bind(ackable);
    const originalNack = ackable.nack.bind(ackable);
    let settled = false; // 这个 handle 已经处置过一次：后续 ack / nack 全部 no-op

    return {
      ...ackable,
      ack: async (): Promise<boolean> => {
        if (settled) {
          return false;
        }
        settled = true;
        return originalAck();
      },
      nack: async (requeue = false): Promise<boolean> => {
        if (settled) {
          return false;
        }
        settled = true;

        const dispositioned = await originalNack(requeue);
        if (requeue || !provider.deadLetter || !dispositioned) {
          return dispositioned; // 回队不是放弃；没落定的处置也不是
        }

        try {
          provider.archiveDeadLetter(ackable, sourceTopic, {
            reason: 'consumer-nack',
            // 消费者拿到的就是内核 / 队列打戳后的那份副本：头里的趟数是真的（订阅侧试过几次
            // 就写几次），轮次则由 archiveDeadLetter 从 `mbx-round` 读。
            attempts: Number(ackable.headers?.[MBX_ATTEMPT_HEADER] ?? 1),
            error: 'the consumer nacked the message without requeue',
            at: new Date().toISOString(),
          });
        } catch (error) {
          console.error(
            `[${this.protocol}] CRITICAL: The consumer discarded message ${ackable.id}, but archiving it to the ` +
            `dead-letter queue failed. The message is gone from its queue and has no dead-letter record.`,
            error,
          );
        }
        return dispositioned;
      },
    };
  }

  /**
   * 基类发出的处置信号的落点（广播型：全部投递结算后调用一次，不在每个订阅者失败时调用）。
   *
   * 之前这里是空实现：订阅的消息不再入队后，可重试错误等于消息静默消失。
   * 现在 requeue=true（全部投递都失败）将消息退回 topic 队列头部，可被 `fetch` 取回且在
   * `unreadCount` 里可见；requeue=false（有订阅者成功，或失败不可重试）就是“放弃”：
   * 默认直接丢弃，开了 {@link enableDeadLetterQueue} 则在死信 topic 里留一份（留痕在
   * `_onDeliveryDeadLettered` 里做，不在这里）。
   *
   * 这里的 `message` 是本轮结算后的投递副本（带 `mbx-attempt` / `mbx-round`），所以回队的
   * 那一份在队列里也看得到“本轮试了几次 / 这是第几轮”。
   */
  protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
    if (!requeue) {
      return;
    }
    const topic = this.topicOf(message.to);
    this.bus.requeue(topic, message);
  }
}