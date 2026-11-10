import { nanoid } from '@isdk/hash';
import {
  IMailboxProvider,
  MailMessage,
  Subscription,
  AckableMailMessage,
  MailboxStatus,
  FetchOptions,
  ManualAckFetchOptions,
  PeekFetchOptions,
  PlainFetchOptions,
  Disposition,
} from '../interfaces';
import { normalizePeekLimit } from '../lib/utils';
import { Capability, type CapabilityDeclaration } from '../lib/capability';
import { assertDisposition } from '../lib/disposition';
import { UnsupportedCapabilityError, InvalidFetchOptionsError } from '../error';
import {
  RetryPolicy,
  AttemptLedger,
  isRetriableError,
  nextRetryDelay,
  resolveRetryPolicy,
} from '../lib/retry';
import {
  DeliveryResult,
  DEFAULT_DELIVERY_SETTLE_TIMEOUT,
  copyIdentity,
  deliveryKey,
  describeDeliveryError,
  readRound,
  MBX_SEND_ID_HEADER,
  stripSenderForgedSystemHeaders,
  shouldRequeueAfterBroadcast,
  subscriptionIdOfDelivery,
  toDeliveryResults,
  withAttemptHeaders,
} from '../lib/delivery';

/**
 * Represents a subscription record managed internally by the MailboxProvider.
 * It holds the necessary data to manage the subscription's lifecycle.
 */
interface ManagedSubscription {
  id: string;
  address: URL;
  // 用户传入的原始回调。失败处理与重试由基类驱动（见 `_runDelivery`），
  // 所以这里不再保存「包装后的回调」。
  onReceive: (message: MailMessage) => void | Promise<void>;
  // Holds the underlying handle returned by the concrete provider's _subscribe method,
  // which is needed for unsubscribing.
  unsubscribeHandle?: any;
  /**
   * 登记发生在 `close()` 进行中（登记那一刻 `closeInFlight > 0`）。
   *
   * 为什么在**登记那一刻**而不是 settle 那一刻读关闭状态：`close()` 先快照再拆，快照里没有这条；
   * 而它的 `finally` 可能先于 settle 把计数落回 0——那时 settle 看见的是「表里有我、也没在关闭」，
   * 于是把一个没人拆的 handle 挂到一条正被收尾的登记上（issue#11）。“在关闭中途出生”是一个
   * 不会随调度漂的历史事实，不需要谁复位，也不依赖 settle 与 `close()` 谁先到。
   *
   * 它不是「在 await 之前查一下 provider 还开着吗」那种检查过去（规范明确排除的是“入口查完就
   * 放行”）：**作废的决定仍在 settle 那一刻做**，只是这个事实要在出生时就留下来。
   */
  bornWhileClosing?: boolean;
  /**
   * `_subscribe` 还没落定时的那颗 promise（handle 在路上）。
   *
   * 存在的唯一理由：**await 窗口里的拆除**。provider 还没答话就来了一次 `unsubscribe()` /
   * `close()`，此刻既不能拿 `undefined` 去调 `_unsubscribe`（provider 只认自己的句柄，
   * 不知道「还没建立」），也不能当作已经拆完——所以留个标记，由 `subscribe()` 那侧在
   * handle 落地时补拆（见 {@link MailboxProvider._settleSubscription}）。
   */
  handlePromise?: Promise<any>;
}

type PendingRetryTimer = ReturnType<typeof setTimeout>;

/**
 * 一次尚未结算的投递（某个订阅者对某条消息的处理，可能正卡在重试退避里）。
 * 只有结算之后，广播的发送侧才知道这次投递是成功还是失败（issue#2）。
 */
interface PendingDelivery {
  /**
   * 本次投递的消息，始终是一份带 `mbx-attempt` / `mbx-round`（开了重试还有 `mbx-max-attempts`）
   * 的**副本**，不是发送侧那个共享对象——否则 A 的重投次数会串给 B。
   * 每次尝试换一份新副本；同一次尝试里，回调 / `_ack` / `_nack` 拿的是同一个对象。
   * 结算后的 `nack` / 死信钩子都用这份（广播 barrier 也一样），所以 provider 在 `_nack(false)`
   * 里落 DLQ 时能看到真实次数，而 `_nack(true)` 退回队列的那一份也带着次数与轮次。
   */
  message: MailMessage;
  /** 投递身份（`subscriptionId + messageId`）。`key` 只是内部 map 键，可能带并发序号后缀。 */
  deliveryId: string;
  subscriptionId: string;
  settle: (result: DeliveryResult) => void;
  /** 本次投递的结算 promise。广播的 barrier 等的就是它。 */
  promise: Promise<DeliveryResult>;
  /** 重试退避定时器（只有「等待重投」的投递才有）。 */
  timer?: PendingRetryTimer;
  /** 单次尝试的结算看门狗（防卡死的回调，见 `deliverySettleTimeout`）。 */
  watchdog?: PendingRetryTimer;
  /** 已经跑过几次尝试（含首次）。死信记录里的「试了几次」就是它。 */
  attemptsMade: number;
  /**
   * 本轮投递轮次（{@link MBX_ROUND_HEADER}）：开始一条投递时 = 消息上已有轮次 + 1，
   * 同一条重试链里不变。它是消息级的跨轮计数，回队时随副本交回队列，provider 拿它能封顶。
   */
  round: number;
  /** 最后一次尝试抛出的错误（结算成失败时写进 `DeliveryResult.error`）。 */
  lastError?: unknown;
}

/** 已结算副本表的长度上界：没接 barrier 的 provider 不会来取，不能让这张表无限长。 */
const MAX_SETTLED_COPIES = 500;

/** 投递结算原因。`ok` 表示回调成功。 */
type DeliveryOutcome = 'ok' | 'retriable' | 'fatal' | 'cancelled';

/**
 * Provider 的基类——**实现新 provider 请从这里继承**（规范见 `wiki/delivery-semantics.md` §1）。
 *
 * 基类拥有那些第三方最容易做错、又最难自己做对的记账：发送边界发 `mbx-send-id` 与系统头、投递级
 * 结算与重试、广播的 barrier、处置与尝试记账、能力探测，以及**关闭时拆掉全部订阅**。子类要填的是
 * `_xxx()` 那一层钩子：`_send()` / `_subscribe()` / `_fetch()` / `_peek()` / `_ack()` / `_nack()` /
 * `_init()` / `_close()` / `_status()`。
 *
 * 直接实现 {@link IMailboxProvider} 不是受支持的写法：接口只是内核调你的结构面，上面那些记账一分都
 * 不在里面，而内核不会检查（`registerProvider()` 只读 `protocol`），也不会代劳。写错的形状实测过：
 * 关闭时漏拆订阅 ⇒ 监听器留在 broker 上、句柄照报 `active`、`stop()` → `start()` 后一份信两次副作用。
 */
export abstract class MailboxProvider implements IMailboxProvider, CapabilityDeclaration {
  public readonly protocol: string;
  protected readonly subscriptions: Map<string, ManagedSubscription> = new Map();
  /**
   * 现在有几个 `close()` 正在跑（0 = 当前没在关闭）。只在 `subscribe()` 登记那一刻读它，
   * 结果存进登记自身（{@link ManagedSubscription.bornWhileClosing}）。
   *
   * 订阅表只回答「这条登记还在不在」，回答不了「关闭已经走过去了」：`close()` 先快照再拆、
   * 末尾还 `clear()` 一次，于是「快照之后才插进来的那条」在 settle 时看着表里有自己，就把
   * handle 挂到一条马上要被抹掉的登记上——登记被抹、监听器没人拆，而句柄报 `closed`
   * ⇒ 再没有任何东西能摘它（issue#11）。
   *
   * 两个设计点都不是顺手：
   * - **复位由 `close()` 自己在 `finally` 里做，不挂在 `init()` 上**：`MemoryProvider.init()`
   *   与下游 provider（如 tool-rpc 的 `FileProvider`）都重写 `init()` 而不调 `super.init()`，
   *   把复位挂在 `init()` 上就把 `stop()` → `start()` 变成单向门，症状是「新订阅自己拆掉自己，
   *   不报错」——比它修的那个泄漏更难发现。
   * - **计数而不是布尔**：并发的两次 `close()`，先返的那个不该把后一个的「还在关闭」抹掉。
   *
   * 它只盖**关闭进行中**那一格，不判「已经关闭之后能不能再订」：那一格规范不判（三端当前
   * 不一致），未收口前不得当成契约。
   */
  private closeInFlight = 0;

  /**
   * 订阅失败后的重试策略。`null` 表示不重试（默认）：可重试失败只把消息退回队列，
   * 由 `fetch()` 兜底。重试是 opt-in 的，因为 AMQP / SQS 这类传输自带重投与死信，
   * 库再重投就是双重投递。
   */
  protected retry: Required<RetryPolicy> | null = null;

  /**
   * 这个 provider 的 `subscribe` 是不是广播（一条消息投递给 N 个订阅者）。
   *
   * 广播型（`true`，如 MemoryProvider）：单次投递失败**不再**自动 `nack(requeue)` 整条消息 ——
   * 已成功订阅者的副作用不该再执行一次。回不回队由发送侧的结算 barrier 按
   * `shouldRequeueAfterBroadcast()` 统一判定（全部投递都失败才回队）。
   *
   * 队列 / 传输型（`false`，默认）：每次投递对应 broker 里的一份 ack，保持原有
   * per-delivery `nack` 行为，交给传输层重投或死信。
   */
  protected readonly broadcastDeliveries: boolean = false;

  /** 按「订阅者 + 消息」记账尝试次数；订阅是广播，不能混在一起算。 */
  private readonly attempts = new AttemptLedger();
  /** 按投递身份（`subscriptionId + messageId`）记账尚未结算的投递。 */
  private readonly pendingDeliveries: Map<string, PendingDelivery> = new Map();
  /**
   * 本轮**已结算**投递的副本（按消息 id 保留趟数最大的那一份），给广播 barrier 处置时用。
   * 传输 / 队列型 provider 直接用 `pending.message`，用不到这张表。
   *
   * 两个已知限度（都只会让 barrier 退回不带计数的 `_send` 副本，不会错判处置）：
   * 取走即删 ⇒ 同 id 并发广播时，后落定的那个 barrier 拿不到副本；长度上限
   * {@link MAX_SETTLED_COPIES} 按插入序淘汰。
   */
  private readonly settledCopies: Map<string, { message: MailMessage; attempts: number }> = new Map();

  /** 无 `mbx-send-id` 的副本（非标准路径）退到对象身份时用：同一个对象 = 同一份。 */
  private readonly copyTags: WeakMap<object, number> = new WeakMap();
  private nextCopyTag = 0;

  /**
   * 单次投递尝试的结算超时（毫秒）。`0` / 负数关闭（调用方自己负责长任务）。
   * 见 {@link DEFAULT_DELIVERY_SETTLE_TIMEOUT}。
   */
  public deliverySettleTimeout: number = DEFAULT_DELIVERY_SETTLE_TIMEOUT;

  /**
   * 已登记结算 barrier 的消息 → 登记层数（同 id 并发广播时不能互相抹掉）。
   * 广播型 provider 若没登记 barrier，基类会兜底回队，不让可重试失败静默消失。
   */
  private readonly broadcastBarriers: Map<string, number> = new Map();
  /** 已经告过警的「漏接 barrier」消息 id，避免一条消息警 N 次。 */
  private readonly barrierlessWarned: Set<string> = new Set();
  /**
   * 「provider 没实现 `_nack`」只告一次：没这个钩子，内核发出的回队 / 放弃决定会静默落空，
   * 但每条消息都警一遍就是刷屏。
   */
  private nacklessWarned = false;

  constructor(protocol: string, retry?: RetryPolicy | null) {
    if (!protocol) {
      throw new Error('Provider protocol cannot be empty.');
    }
    this.protocol = protocol;
    this.retry = resolveRetryPolicy(retry);
    // 能力声明在建 provider 时就定型（按类上的钩子推导一次），之后就是普通可变数据：
    // **运行期挂上方法不算声明**——谁注入谁更新声明，否则声明会跟着实现漂移，
    // 而漂移不报错，只会让内核去做 provider 其实不想做的事。
    this.declaredCapabilities = this.declareCapabilities(new Set<string>());
  }

  // --- 能力声明 ---

  private declaredCapabilities: Set<string>;

  /**
   * 这个 provider 现在会做什么（**运行期可变的数据**，见 D6）。
   *
   * 初始值由已实现的可选钩子推导（`_status` → `status`、`_peek` → `peek`…），子类可以在
   * {@link declareCapabilities} 里加自己协议独有的能力，也可以随时直接改这个集合：
   *
   * ```ts
   * provider.supports.add('disposition:answered');   // 我认这个处置值，而且我知道怎么处理
   * provider.supports.delete('peek');               // 这个实例现在不让人只读了
   * ```
   *
   * 规矩：**未声明 = 没有这个操作**；谁给 provider 注入能力（包装、AoP、配置开关），谁就负
   * 责更新声明。声明与实现漂移不会报错，所以诊断面、重试门限、conformance 都以声明为准。
   */
  public get supports(): Set<string> {
    return this.declaredCapabilities;
  }

  /**
   * 能不能做 `operation`。子类可按地址而异（`can('peek', addr)`）。
   *
   * 基类内部的判断（只读取信、状态查询）与 `Mailbox` 门面都走这里，不再探方法存在性。
   */
  public can(operation: string, address?: URL): boolean {
    return this.supports.has(operation);
  }

  /**
   * 子类扩能力的入口（想按地址而异就重写 {@link can}）。
   *
   * 基类的推导只覆盖接口层的可选钩子；自家协议特有的东西（停放区、死信队列、自定义处置值……）
   * 在这里声明。它们必须真的被实现支撑：只声明不实现，内核会把错报成「这个 provider 答错了」，
   * 而不是「它不支持」。
   */
  protected declareCapabilities(declared: Set<string>): Set<string> {
    // `recoverLeases` / `listAddresses` 是接口上的可选方法：基类不实现，子类才带。
    const optional = this as Partial<Pick<IMailboxProvider, 'recoverLeases' | 'listAddresses' | 'clear'>>;
    if (typeof this._status === 'function') declared.add(Capability.Status);
    if (typeof this._peek === 'function') declared.add(Capability.Peek);
    if (typeof optional.recoverLeases === 'function') declared.add(Capability.RecoverLeases);
    if (typeof optional.listAddresses === 'function') declared.add(Capability.ListAddresses);
    // 基类的 `clear()` 是**空实现**（传输型 provider 的消息在 broker 里，没什么可清）：
    // 只有真的覆写了它的 provider 才声明这个能力，否则「能 purge」是假的。
    if (optional.clear !== MailboxProvider.prototype.clear) {
      declared.add(Capability.Clear);
    }
    if (typeof this._settle === 'function') declared.add(Capability.Settle);
    return declared;
  }

  /**
   * 开启 / 关闭订阅重试。传 `null` 回到默认行为（失败只回队、不自动重投）。
   */
  public setRetryPolicy(policy: RetryPolicy | null | undefined): void {
    this.retry = resolveRetryPolicy(policy);
  }

  // --- Public API (implements IMailboxProvider) ---

  /**
   * 初始化 Provider。子类可重写此方法以建立真实的连接。
   */
  public async init(): Promise<void> {
    // 默认不执行任何操作。
  }

  /**
   * 关闭 Provider。
   * 此方法会自动取消该 Provider 下所有活跃的订阅，然后调用子类的 `_close` 进行具体清理。
   *
   * **给子类的收尾钩子是 `_close()`，不是这个 `close()`**：入口归基类，因为那段真拆除（拆每条订阅、
   * 取消等重投的投递、清台账、置关闭状态）必须跑完。`_close()` 就在下面两行，重写错了对象是这条契约上
   * 最容易犯的错，而后果是**拆不掉**：监听器留在 broker 上、句柄照报 `active`、`stop()` → `start()` 后
   * 一份信两次副作用。确实要赶在拆订阅**之前**做事，就重写 `close()` 并 `await super.close()`——
   * 不回到基类，上面这段一行都不跑；**只调 `this._close()` 也不算**，那段真拆除住在基类的 `close()` 里，
   * 它跑完才换 `_close()`（规范：`wiki/delivery-semantics.md` §1）。
   *
   * 注意：`close()` **不**清消息队列——“关掉通道”不等于“销毁在途数据”。要一并清掉积压消息
   * 用 `Mailbox#stop({ purge: true })` 或 {@link MailboxProvider.clear}。
   */
  public async close(): Promise<void> {
    // 置位必须在拆表**之前**：`subscribe()` 在登记那一刻读它，置位晚了那条就会被记成
    // 「出生时没在关闭」，而 close() 的快照里也没它——两边都看不见，就没人拆（issue#11）。
    this.closeInFlight++;
    try {
      // 1. 自动清理所有活跃订阅
      const subscriptions = Array.from(this.subscriptions.values());
      if (subscriptions.length > 0) {
        await Promise.all(
          subscriptions.map(async (sub) => {
            try {
              await this._teardownSubscription(sub);
            } catch (e) {
              console.error(`[${this.protocol}] Error unsubscribing ${sub.id} during close:`, e);
            }
          })
        );
        // 兜底：拆的过程中插进来的登记在这里被抹掉。**它不是修复**——它抹登记、不拆监听器，
        // 监听器得由 `subscribe()` 的 settle 那一脉自己拆（见 `closeInFlight`）。
        this.subscriptions.clear();
      }

      // 关闭时取消所有「等待重投」的投递：进程都在收尾，不再把消息重新喂回回调。
      // 取消不等于消息可以消失 —— 见 `_cancelPendingDeliveries`。
      // 正在执行的回调不替它下结论（它可能马上就要成功）：由它自己结算，卡死的由看门狗兜。
      for (const key of Array.from(this.pendingDeliveries.keys())) {
        this._cancelPendingDeliveries(subscriptionIdOfDelivery(key));
      }
      this.attempts.clear();
      this.settledCopies.clear();

      // 2. 调用具体的清理逻辑
      await this._close?.();
    } finally {
      // 复位由 close() 自己做，不挂在 init() 上：见 closeInFlight 的注释。
      this.closeInFlight--;
    }
  }

  /**
   * 丢弃本 provider 持有的积压消息（含 in-flight），不动订阅。
   *
   * 默认**空实现**：“清空传输”对 AMQP / SQS / IMAP 这类真实 broker 是破坏性操作，
   * 基类不能替子类下结论。需要 purge 语义的 provider（如 `MemoryProvider`）自己覆写。
   */
  public async clear(): Promise<void> {
    // 默认无可清理内容：传输型 provider 的消息存在 broker 里，不在本地。
  }

  /**
   * Sends a mail message.
   * This method handles common logic (like adding a timestamp and injecting x-req-sent-at for replies)
   * and then calls the concrete `_send` method for protocol-specific delivery.
   */
  public async send(message: MailMessage) {
    // **发送边界就在这里**：`_send()` 只能从 `send()` 进，所以系统头在这里统一发统一剥，
    // provider 作者没有“记得注入”的义务，也没有关掉它的办法。
    // - 剥：发送方（或任何调 `send()` 的人）自带的 `mbx-send-id` / `mbx-round` / `mbx-attempt` /
    //   `mbx-dead-letter*` 一概不采信——采信伪造的份号就等于让两份信共用一本账（F7）。
    // - 发：`mbx-send-id` 是「这一份信」的编号，全生命周期只在这里发一次（队列 / 在飞表 / 回队
    //   去重都按它记账）。队列不自己造号：号的寿命必须是“这份信在系统里的一生”。
    // 回队与重投不经过 `send()`，所以同一份不会被重新发号。
    const messageToSend: MailMessage = {
      ...message,
      headers: {
        ...stripSenderForgedSystemHeaders(message.headers),
        [MBX_SEND_ID_HEADER]: this.generateId(),
        'mbx-sent-at': new Date().toISOString(), // Always inject mbx-sent-at for outgoing messages
      },
    };

    await this._send(messageToSend);
    return messageToSend;
  }

  /**
   * Subscribes to an address.
   * This method manages the creation of the subscription object, centralizing the
   * implicit ACK and the error / retry handling of every delivery.
   *
   * 注册给具体 provider 的监听器返回一个在**投递最终结算**（含整条重试链）时才 resolve 的
   * `Promise<DeliveryResult>`。广播型 provider 的发送侧靠它做结算判定（issue#2）。
   *
   * **返回 Promise 就是 await 点**（对齐 Python `Mailbox.subscribe` / Rust `Mailbox::subscribe`）：
   * 「这条订阅已生效」是**每订阅**粒度的事实，只有 provider 自己答得上（进程内总线是登记完成
   * 那一刻；接了真实对端的，照它自己协议的规矩答——有些协议根本不给确认），所以它挂在每个订阅
   * 上，塞进 provider 级的 `init()` 就丢了。
   * `await` 完成之前调用方拿不到 `Subscription`——不先递对象再背后填 handle，那是把未生效的
   * 订阅当成已生效。
   *
   * 两个刻意保留的错误时机（这个方法**故意不写成 `async`**，`_subscribe` 同步调用）：
   * - 「同步就能发现的错」（地址语法、scheme 未注册、钩子直接 `throw`）**照旧同步 throw**，
   *   不漂成 rejection —— 否则同一个地址在 `post()` 是 throw、在 `subscribe()` 是 reject，
   *   违反 I-4「不能只在一个入口合法」；
   * - 只有 `_subscribe` 真的 reject（异步拒绝）才是 rejection，与 `send()` 对称。
   *
   * 钩子不要求 async：v1 写的**同步** `_subscribe` 不改也能跑——基类 `await` 它，
   * 非 Promise 的返回值一样等得起。
   */
  public subscribe(
    address: URL,
    onReceive: (message: MailMessage) => void | Promise<void>
  ): Promise<Subscription> {
    const subId = this.generateId();

    const managedSub: ManagedSubscription = {
      id: subId,
      address,
      onReceive,
      // 这一场关闭看不见这条（它的快照在之前），所以拆它的责任归 settle 那一脉。
      bornWhileClosing: this.closeInFlight > 0,
    };
    // **先登记，再等 handle**。顺序反过来（Python `MailboxProvider.subscribe` 现在就是那个顺序）
    // 会把 await 窗口里的 `unsubscribe()` / `close()` 变成空操作：记录还不存在 → 没人负责拆 →
    // handle 落地后那个监听器永久留在总线上（默认总线是进程级单例，跳 `Mailbox` 可见）。
    this.subscriptions.set(subId, managedSub);

    let pendingHandle: Promise<any>;
    try {
      // Call the concrete provider's implementation to start listening.
      // 同步调用：钩子同步抛错时，错误要能同步出家门（见上面那段）。
      pendingHandle = Promise.resolve(this._subscribe(address, (message) =>
        this._startDelivery(subId, message)
      ));
    } catch (error) {
      this.subscriptions.delete(subId); // 不留半截登记
      throw error;
    }
    managedSub.handlePromise = pendingHandle;
    // 由这里（而不是调用方）去 await：调用方没 await 时 rejection 不会变成
    // unhandledRejection，而在途 handle 落地后仍然需要被拆。
    return this._settleSubscription(subId, managedSub, pendingHandle);
  }

  /**
   * 等 provider 把 handle 交回来，然后处理两种“在 await 窗口里已经变了的世界”：
   *
   * 1. **拆除先发生**（`unsubscribe()` / `stop()` 在 handle 落地前跑过）：迟到的 handle
   *    必须补拆，否则就是一个没人认领的订阅永久留在 broker / 总线上。这条路径**不 reject**：
   *    退订不是错误，调用方拿到的是一个 `status: 'closed'` 的 Subscription。
   * 2. **provider 正在关闭**（`close()` 已在跑，这条是快照之后插进来的）：同样作废。
   *    表里此刻有它，但 `close()` 的快照里没有它——拆它的人已经走过去了，末尾那次 `clear()`
   *    只会抹登记、不拆监听器（issue#11）。判据在 {@link MailboxProvider.closeInFlight}。
   * 3. **broker 拒绝订阅**：删登记后把 rejection 交给调用方；若拆除已经发生则静默收尾
   *    （没人在等这个结果，也不能让它变成 unhandledRejection）。
   *
   * 两种作废都走 {@link MailboxProvider._retireLateHandle}：抹登记与拆 handle 必须同一条路做完。
   *
   * 拆完仍然有界：`close()` 不等这颗 promise（见 {@link MailboxProvider._teardownSubscription}），
   * 所以一个永不落地的 `_subscribe` 卡不住关闭，代价是那条订阅归 broker 自己负。
   */
  private async _settleSubscription(
    subId: string,
    managedSub: ManagedSubscription,
    pendingHandle: Promise<any>
  ): Promise<Subscription> {
    let handle: any;
    try {
      handle = await pendingHandle;
    } catch (error) {
      managedSub.handlePromise = undefined;
      const tornDown = !this.subscriptions.has(subId);
      this.subscriptions.delete(subId);
      if (tornDown) {
        // 没人在等这个结果了：静默收尾，不造 unhandledRejection。
        console.warn(
          `[${this.protocol}] Subscription ${subId} was torn down while the provider was still `
          + `establishing it, and the broker then rejected it. Nothing left to clean up.`,
        );
        return this._createSubscriptionObject(subId, managedSub.address);
      }
      throw error;
    }

    // settle 之后重新问一遍世界：上面那个 await 里什么都可能发生。「世界已经变了」有两种：
    // 登记已经被拆掉，或者这条是在一场关闭的中途出生的（close() 的快照里没有它，
    // 拆它的人已经走过去了——issue#11）。
    const registered = this.subscriptions.get(subId);
    const tornDown = registered === undefined || managedSub.bornWhileClosing === true;
    if (registered) {
      registered.unsubscribeHandle = handle;
      registered.handlePromise = undefined;
    }
    if (tornDown) {
      await this._retireLateHandle(subId, handle);
    }
    return this._createSubscriptionObject(subId, managedSub.address);
  }

  /**
   * 拆一条「窗口里已经被摘掉、或落在一场正在进行的关闭里」的迟到 handle。
   *
   * 抹登记与拆监听器必须同一条路做完：`close()` 末尾那次 `clear()` 只抹登记，于是两者分开的
   * 下场就是一个报 `closed` 的句柄加一个永久留在 broker / 总线上的监听器。
   *
   * 报错只能日志：已经没有调用方在听（拆它的人早就返了）。
   */
  private async _retireLateHandle(subId: string, handle: any): Promise<void> {
    this.subscriptions.delete(subId);
    try {
      await this._unsubscribe(subId, handle);
    } catch (error) {
      console.error(
        `[${this.protocol}] Error unsubscribing ${subId} after it was torn down mid-subscribe:`,
        error,
      );
    }
  }

  /**
   * 拆一条订阅：删登记 + 取消等待重投的投递 + 交给 provider 拆 handle。
   *
   * **handle 还在路上时不碰 provider**：`_unsubscribe(id, undefined)` 会被 broker 当成
   * 一个非法句柄（它只认自己的句柄，不知道「还没建立」），所以补拆交给
   * {@link MailboxProvider._settleSubscription}。这也是 `close()` 有界的原因。
   */
  private async _teardownSubscription(sub: ManagedSubscription): Promise<void> {
    if (!this.subscriptions.has(sub.id)) {
      return; // 已经被别的路径拆过了（unsubscribe / 另一次 close）
    }
    this.subscriptions.delete(sub.id);
    // 退订不替正在执行的回调下结论（它可能马上就要成功），只取消「还在等重投」的那些。
    this._cancelPendingDeliveries(sub.id);
    if (sub.handlePromise) {
      return;
    }
    await this._unsubscribe(sub.id, sub.unsubscribeHandle);
  }

  /**
   * Fetches a message.
   * Delegates directly to the concrete provider's implementation.
   *
   * `peek` 在基类里分流（不交给 `_fetch`）：只读快照走 {@link MailboxProvider._peek}，
   * 不实现这个能力的 provider 直接报错 —— 把 `peek` 当普通 fetch 跑就是把消息取走，
   * 而调用方以为自己在看一眼（issue#3）。
   */
  public async fetch(address: URL, options: PeekFetchOptions): Promise<MailMessage[]>;
  public async fetch(address: URL, options: ManualAckFetchOptions): Promise<AckableMailMessage | null>;
  public async fetch(address: URL, options?: PlainFetchOptions): Promise<MailMessage | null>;
  public async fetch(
    address: URL,
    options?: FetchOptions
  ): Promise<MailMessage | AckableMailMessage | MailMessage[] | null> {
    if (options?.peek) {
      return this._peekOrThrow(address, options);
    }
    const message = await this._fetch(address, options);
    return message;
  }

  /**
   * 只读快照入口：选项校验 + 能力检查，然后交给子类的 `_peek`。
   */
  private async _peekOrThrow(address: URL, options: FetchOptions): Promise<MailMessage[]> {
    if (options.manualAck) {
      throw new InvalidFetchOptionsError(
        '`fetch({ peek: true, manualAck: true })` is contradictory: a peeked message is never handed to a consumer, ' +
        'so there is nothing to acknowledge. Drop one of the two options.',
      );
    }
    if (!this.can(Capability.Peek, address)) {
      throw new UnsupportedCapabilityError(
        this.protocol,
        'read-only peek (implement `_peek(address, { limit })` on the provider, or fetch without `peek`)',
      );
    }
    if (typeof this._peek !== 'function') {
      // 声明了能力却没实现：比“没声明”更糟——内核会去调一个不存在的方法。
      // 照旧报能力错误（而不是 TypeError），并把原因说清。
      throw new UnsupportedCapabilityError(
        this.protocol,
        'read-only peek (declared in `supports`, but `_peek(address, { limit })` is not implemented)',
      );
    }
    return this._peek(address, { limit: normalizePeekLimit(options.limit) });
  }

  /**
   * Queries the status of an address.
   * If the concrete provider implements `_status`, it will be called;
   * otherwise, a default "unknown" status is returned.
   */
  public async status(address: URL): Promise<MailboxStatus> {
    if (this._status) {
      return this._status(address);
    }
    return {
      state: 'unknown',
      message: `The '${this.protocol}' provider does not support status queries.`,
    };
  }

  public generateId(): string {
    return nanoid();
  }

  /**
   * 向 provider 发出处置：这一次交付按 `where` 收尾（内核词汇：`handled` / `unhandled` /
   * `discard`，见 `CORE_DISPOSITIONS`）。
   *
   * 首选钩子是 {@link _settle}。没接它的子类（包括按 `v1.0.0` 写的第三方 provider）转发到
   * 已发布的 {@link _ack} / {@link _nack}：`handled` → `_ack(message)`；
   * `unhandled` → `_nack(message, true)`；`discard` → `_nack(message, false)`。
   * 少这层转发，旧子类会收不到处置；留着它，新旧两种写法也能共存。
   *
   * 自定义处置值先过能力声明：没声明过就抛 `UnsupportedCapabilityError`，而不是递给一个
   * 不认得这个值的钩子（那会把「不知道拿它怎么办」变成「当成 ack 处理」）。
   */
  protected async settleDelivery(message: MailMessage, where: Disposition): Promise<boolean | void> {
    assertDisposition(where, this, message.to);

    if (typeof this._settle === 'function') {
      return this._settle(message, where);
    }
    if (where === 'handled') {
      await this._ack?.(message);
      return;
    }
    if (!this._nack) {
      this._warnMissingNack();
      return;
    }
    return this._nack(message, where === 'unhandled');
  }

  /**
   * @deprecated 用 {@link settleDelivery}(message, 'handled')。本方法保留是因为 `v1.0.0` 就有它：
   *   整个 2.x 里它都是 `settleDelivery(message, 'handled')` 的完整 alias，到拆包的 `3.0.0` 再删。
   */
  protected async ack(message: MailMessage) {
    await this.settleDelivery(message, 'handled');
  }

  /**
   * 向 provider 发出处置决定：`requeue = true` 回队（`unhandled`），`requeue = false` **放弃**
   * （`discard`：丢弃或落死信，由 provider 定）。
   *
   * `_nack` 是可选钩子（内存型 provider 本来就没有 broker 可 nack），但「内核已经判定要回队 /
   * 要放弃，provider 却没接」是另一回事：消息会停在 broker 把它放的位置上——真实 broker
   * 里就是 visibility timeout 后无限重投。所以这里告警一次，把落空的决定挑明。
   *
   * @deprecated 用 {@link settleDelivery}(message, 'unhandled' | 'discard')。布尔参数在
   *   `v1.0.0` 就发布了，直接去掉会让老代码里的 `nack(false)` 静默变成回队（从丢弃变无限
   *   重投），所以它在 2.x 里必须是完整 alias，到拆包的 `3.0.0` 再删。
   */
  protected async nack(message: MailMessage, requeue: boolean) {
    await this.settleDelivery(message, requeue ? 'unhandled' : 'discard');
  }

  // --- Protected Abstract Methods (to be implemented by subclasses) ---

  /**
   * [Subclass Responsibility] Performs the actual sending logic.
   */
  protected abstract _send(message: MailMessage): Promise<void>;

  /**
   * [Subclass Responsibility] Performs the actual subscription logic.
   * @param onReceive 基类包装后的投递入口：返回本次投递的最终结算结果。
   * @returns A handle that can be used later to unsubscribe (e.g., a listener function, a subscription ID).
   */
  protected abstract _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => void | Promise<DeliveryResult | void>
  ): any;

  /**
   * [Subclass Responsibility] Performs the actual un-subscription logic.
   */
  protected abstract _unsubscribe(subscriptionId: string, unsubscribeHandle: any): Promise<void>;

  /**
   * [Subclass Responsibility] Performs the actual message fetching logic.
   * 基类不会把 `peek: true` 送进这里（只读快照走 `_peek`），实现无需考虑只读分支。
   */
  protected abstract _fetch(
    address: URL,
    options?: FetchOptions
  ): Promise<MailMessage | AckableMailMessage | null>;

  /**
   * [Subclass Responsibility - Optional] 只读快照：返回队列头部消息的**副本**，
   * 不出队、不建 in-flight、不改活动时间。不实现的 provider 在 `fetch({ peek: true })` 时
   * 会收到 {@link UnsupportedCapabilityError}，而不是被静默降级成普通 fetch。
   *
   * @param limit 已经过 {@link normalizePeekLimit} 归一：`undefined` = 整个队列。
   */
  protected _peek?(address: URL, options?: { limit?: number }): Promise<MailMessage[]>;

  /**
   * [Subclass Responsibility - Optional] Specific closing logic.
   */
  protected async _close?(): Promise<void>;

  /**
   * [Subclass Responsibility - Optional] 处置一次交付（新入口，取代 {@link _ack} / {@link _nack}）。
   *
   * `where` 是内核词汇：
   * - `handled`：这一份到此为止，不留痕；
   * - `unhandled`：交回队列，还会再交出去；
   * - `discard`：结束它，并按这个协议的规矩**善后**（死信 / bounce / 打标记——做什么由协议定）。
   *
   * 与已发布钩子的关系：没接 `_settle` 的子类继续走 {@link _ack} / {@link _nack}（基类转发，
   * 语义等价），所以第三方 provider 不会因为这个改名而断。接了 `_settle` 就以它为准。
   * 声明了它 = 能力 `settle`（见 {@link supports}）。
   *
   * @returns 这次处置有没有落定（`false` = 没落定，例如这份已经不归这次交付了）；
   *   不报告就返 `undefined`，内核不会替你编一个 `true`。
   */
  protected _settle?(message: MailMessage, where: Disposition): Promise<boolean | void>;

  /**
   * [Subclass Responsibility - Optional] Provides implicit ACK capability for the `subscribe` mode.
   * For providers that don't support ACK (like in-memory), this can be an empty async function.
   *
   * @deprecated 用 {@link _settle}(message, 'handled')。它在 `v1.0.0` 就发布了，所以 2.x 里
   *   继续支持（基类会把 `handled` 转给它），拆包的 `3.0.0` 删。
   *
   * `message` 是**本次投递的副本**（浅拷贝，带 `mbx-attempt` / `mbx-round`，开了重试还有
   * `mbx-max-attempts`），与交给订阅回调的是同一份；**不是** `_send` 那个对象，也不是 `post()`
   * 的入参。重试链里每次尝试换一份新副本，只有当次尝试的回调 / `_ack` / `_nack` 拿到同一个对象。
   *
   * 因此 provider **不得按对象同一性记账**（`Map<MailMessage, handle>` / `WeakMap` / `set.has(message)`）：
   * 查不到不会抛错，只会静默不 ack，消息停在 broker 里等 visibility timeout 后无限重投。
   * 记账用 `message.id`（消息级）或 broker 自己的投递句柄；投递级身份（`subscriptionId + messageId`）
   * 只在 `DeliveryResult.deliveryId`（死信钩子的 `failed[]` 里）拿得到。
   *
   * 浅拷贝的边界：`headers` 是新对象（改它不回落到 `_send` 那份），`body` / `meta` / `from` / `to`
   * 仍是同一引用（改了会串到发送方）。
   */
  protected _ack?(message: MailMessage): Promise<void>;

  /**
   * [Subclass Responsibility - Optional] Provides NACK capability.
   *
   * @deprecated 用 {@link _settle}(message, 'unhandled' | 'discard')。布尔参数在 `v1.0.0` 就发布了，
   *   所以 2.x 里它仍是完整入口（`requeue = true` ≡ `unhandled`，`false` ≡ `discard`），拆包的 `3.0.0` 删。
   *
   * 这是 provider 表达「放弃」的**唯一**入口，两个参数合起来就是内核的全部判定：
   * - `requeue = true`：回队（回到哪个位置、重投几次，由 provider 定，内核不管）；
   * - `requeue = false`：**放弃**——永久移出队列；丢弃还是落 DLQ 由 provider 定。
   *
   * `message` 是**本轮结算后的投递副本**（带 `mbx-attempt` / `mbx-round`）：回队时它带着
   * 「本轮试了几次 / 这是第几轮」落回队列，`requeue=false` 落 DLQ 时同样有次数可写。
   * 例外照实说：广播 barrier 在**没记到投递副本**时会退回 `_send` 那份（没有任何计数）——
   * `_send` 接了 barrier 但投递没走 `_startDelivery` / `_deliverToLocalSubscription`、同 id 并发广播时
   * 后落定的那个 barrier、或副本表撞上 `MAX_SETTLED_COPIES` 被淘汰。所以 provider 侧别假设头一定在。
   *
   * 与 {@link _ack} 同理：这是副本，**不能按对象同一性记账**（用 `message.id` 或 broker 句柄）。
   *
   * 广播型 provider 里它只会在**广播全部投递都结算之后**被调用一次（由发送侧的结算判定决定
   * `requeue` 与否），不会再在每个订阅者失败时各回队一次。队列 / 传输型 provider 里它按投递
   * 调用：可重试失败 `requeue = true`，不可重试失败 `requeue = false`（先永久移出队列，
   * 再走 `_onDeliveryDeadLettered`，见 wiki/mailbox-arch.md 里「先 nack 后 DLQ」的顺序）。
   *
   * 不实现这个钩子（基类会告警一次）= 内核的回队 / 放弃决定落空：消息停在 broker 把它
   * 放的地方，通常就是无限重投。
   */
  protected _nack?(message: MailMessage, requeue: boolean): Promise<void>;

  /**
   * [Subclass Responsibility - Optional] Performs the actual status query logic.
   */
  protected _status?(address: URL): Promise<MailboxStatus>;

  // --- Protected Helper Methods (for internal use) ---

  private _createSubscriptionObject(subId: string, address: URL): Subscription {
    const provider = this; // Capture the MailboxProvider instance's `this` context.
    return {
      id: subId,
      address: address,
      get status() {
        // Use the captured `provider` context.
        return provider.subscriptions.has(subId) ? 'active' : 'closed';
      },
      unsubscribe: async (): Promise<void> => {
        // Use the captured `provider` context.
        const sub = provider.subscriptions.get(subId);
        if (sub) {
          await provider._teardownSubscription(sub);
        }
      },
    };
  }

  /**
   * 投递入口：注册一个待结算投递，然后跑第一次尝试。
   * 返回的 promise 在投递最终结算时 resolve（永不 reject）—— 广播的 barrier 等的就是它。
   *
   * 内部记账键由 `_reserveDeliveryKey` 分配：`post()` 允许自定义消息 id，同一个订阅者对
   * 同 id 的并发投递如果共用一个键，后者会覆盖前者的结算入口 —— 那条投递永不结算，
   * 对应的 barrier 永不落定，消息静默消失。
   */
  private _startDelivery(subscriptionId: string, message: MailMessage): Promise<DeliveryResult> {
    const key = this._reserveDeliveryKey(deliveryKey(subscriptionId, this.copyKeyOf(message)));
    let settle!: (result: DeliveryResult) => void;
    const promise = new Promise<DeliveryResult>((resolve) => {
      settle = resolve;
    });

    // 轮次是“谁把消息交给消费者谁 +1”里的订阅侧那一半：读消息上已有的轮次（broker / 队列
    // 带回来的）+1。重试链里不再 +1（见 _runDelivery 用的是 pending.round）。
    this.pendingDeliveries.set(key, {
      message,
      deliveryId: key,
      subscriptionId,
      settle,
      promise,
      attemptsMade: 0,
      round: readRound(message) + 1,
    });
    this._runDelivery(subscriptionId, message, key);

    return promise;
  }

  /**
   * 兜底：同一份信万一被并发投两次（重复入队 / provider 自己重发同一份），两条投递不能共用
   * 一个结算入口——后者会覆盖前者的 promise，barrier 永不落定，消息静默消失。
   * 份号进键之后这条基本不会触发，留着是因为它一行成本，而后果是一条消息没了。
   */
  private _reserveDeliveryKey(base: string): string {
    if (!this.pendingDeliveries.has(base)) {
      return base;
    }
    for (let suffix = 1; ; suffix++) {
      const candidate = `${base}\u0000${suffix}`;
      if (!this.pendingDeliveries.has(candidate)) {
        return candidate;
      }
    }
  }

  /**
   * 把一条消息投递给本 provider 的某个**本地订阅者**，走与 `subscribe` 完全相同的投递记账
   * （隐式 ack、错误处理、重试、结算）。生产者型 provider（自己组装消息再分发）必须走这里，
   * 不要直接调用户回调 —— 那样这次投递没人记账，失败也不会回队。
   */
  protected _deliverToLocalSubscription(subscriptionId: string, message: MailMessage): Promise<DeliveryResult> {
    return this._startDelivery(subscriptionId, message);
  }

  /**
   * 跑一次尝试。成功 → 隐式 ack + 结算 `ok`；抛错 → 交给 `_handleDeliveryError`。
   *
   * 交给回调的是带 `mbx-attempt` 的**副本**（见 {@link withAttemptHeaders}）：重投次数归
   * provider / 用户决定，但「这次是第几趟」必须让两边都看得见。副本是为了不把次数
   * 写回广播共享的那一条消息。
   */
  private _runDelivery(subscriptionId: string, message: MailMessage, key: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      // 等待期间被退订 / provider 已关闭：不再调用回调，按取消结算。
      this._settleAndFallback(key, 'cancelled');
      return;
    }

    const pending = this.pendingDeliveries.get(key);
    if (pending) {
      pending.attemptsMade += 1;
    }
    const attempt = Math.max(1, pending?.attemptsMade ?? 1);
    // 轮次只在 _startDelivery 里定一次：重试链里的每次尝试同属一轮，不能各 +1。
    const stamped = withAttemptHeaders(message, attempt, this.retry?.maxAttempts, pending?.round);
    if (pending) {
      pending.message = stamped;
    }

    // 看门狗只给「一次尝试」计时：卡死的回调会拖住整条广播的结算判定（消息既不回队也不死信）。
    this._armDeliveryWatchdog(key);

    let run: void | Promise<void>;
    try {
      run = sub.onReceive(stamped);
    } catch (error) {
      this._handleDeliveryError(subscriptionId, stamped, key, error);
      return;
    }

    Promise.resolve(run).then(
      async () => {
        try {
          // On successful execution, implicitly acknowledge the message.
          await this.ack(stamped);
          this.attempts.reset(key);
          this._settleAndFallback(key, 'ok');
        } catch (error) {
          this._handleDeliveryError(subscriptionId, stamped, key, error);
        }
      },
      (error) => {
        this._handleDeliveryError(subscriptionId, stamped, key, error);
      },
    );
  }

  /**
   * 订阅回调抛错时的统一处理（投递级）。
   *
   * 默认（`retry === null`）：可重试 → 结算 `retriable`；不可重试 → 结算 `fatal`（放弃）。
   * 开启重试后：可重试且未超上限 → 只重投给失败的那个订阅者（不广播给其他已成功的订阅者，
   * 否则它们的副作用会被执行两次）；超上限 → 清零台账、调 `_onRetryExhausted`，再结算 `retriable`。
   * 注意：“预算耗尽”不是“放弃”——消息仍会回队，由 `fetch()` 兜底。
   *
   * 广播型 provider 不在这里 `nack`：整条消息回不回队由发送侧在所有投递结算后统一判定
   * （见 `shouldRequeueAfterBroadcast`）。没接 barrier 的广播 provider 由
   * `_fallbackForMissingBarrier` 兜底（整条回队 + 告警），否则可重试失败就静默消失了。
   * 非广播（队列 / 传输）型 provider 每次投递对应 broker 的一次 ack：可重试失败
   * `nack(requeue=true)`；不可重试失败 `nack(requeue=false)`——不发这个信号，broker 就会在
   * visibility timeout 后把同一条坏消息无限重投（见 {@link _giveUpDelivery}）。
   */
  protected _handleDeliveryError(subscriptionId: string, message: MailMessage, key: string, error: any): void {
    console.error(`[${this.protocol}] Error processing message ${message.id}:`, error);

    const pending = this.pendingDeliveries.get(key);
    if (pending) {
      pending.lastError = error;
    }
    // 结算 / nack / 死信钩子都用投递副本：它带 `mbx-attempt`，provider 落 DLQ 时要这个数。
    const settledMessage = pending?.message ?? message;

    const isRetriable = this._isRetriable(error);

    if (isRetriable && this.retry) {
      const attempt = this.attempts.record(key);

      if (attempt < this.retry.maxAttempts && this.subscriptions.has(subscriptionId)) {
        const delay = nextRetryDelay(this.retry, attempt);
        const timer = setTimeout(() => {
          const current = this.pendingDeliveries.get(key);
          if (!current) {
            return; // 退避期间已结算（退订 / 关闭）
          }
          current.timer = undefined;
          if (!this.subscriptions.has(subscriptionId)) {
            // 等待期间退订了：不重投给已消失的订阅者，按取消结算（消息由兜底路径接手）。
            this._settleAndFallback(key, 'cancelled');
            return;
          }
          this._runDelivery(subscriptionId, current.message, key);
        }, delay);
        // 不要因为一个待重投就把 Node 事件循环撑住。
        (timer as unknown as { unref?: () => void }).unref?.();

        const waiting = this.pendingDeliveries.get(key);
        if (waiting) {
          waiting.timer = timer;
          // 退避等待不是“卡死的尝试”：看门狗只在尝试进行中计时，退避期间关掉，
          // 否则一个比看门狗还长的退避会被自己掐断。
          this._clearDeliveryWatchdog(waiting);
        } else {
          clearTimeout(timer); // 已经结算（例如退订），定时器作废
        }
        return;
      }

      if (attempt >= this.retry.maxAttempts) {
        this.attempts.reset(key);
        this._invokeRetryExhaustedHook(settledMessage, attempt);
      }
    }

    if (isRetriable && !this.broadcastDeliveries) {
      // Crucial: NACK the message first to prevent reprocessing, then handle other tasks.
      this.nack(settledMessage, true).catch(nackError => {
        console.error(`[${this.protocol}] CRITICAL: Failed to NACK message ${message.id}. Risk of message duplication.`, nackError);
      });
    }

    this._settleAndFallback(key, isRetriable ? 'retriable' : 'fatal');
  }

  /**
   * [Subclass Responsibility - Optional] 重试次数耗尽时的钩子（例如告警）。
   * 若这次广播没有任何订阅者成功，消息随后仍会退回队列，由 `fetch()` 兜底——耗尽 ≠ 放弃。
   * 钩子自己抛错 / 返回 rejected promise 不会打断处置判定（回队照常），只会被记录。
   */
  protected _onRetryExhausted?(message: MailMessage, attempts: number): void | Promise<void>;

  /**
   * [Subclass Responsibility - Optional] 死信钩子：投递被**放弃**（不回队）时用。
   *
   * 触发时机（两类 provider 都触发）：
   * - 广播型：全部投递都不可重试，或部分失败（已有订阅者成功，失败的那些不回队）——
   *   在 `nack(requeue)` **之后**调用；
   * - 队列 / 传输型：单次投递不可重试失败——在 `nack(message, false)` **之后**调用
   *   （先永久移出队列，再落 DLQ，见 wiki/mailbox-arch.md）。不回队是为了不把已成功者
   *   处理过的消息再投一次，代价是失败的投递从此隐形——这个钩子就是补上那个可观测性缺口。
   *
   * 内核只发信号，不知道也不关心你往哪写：`<topic>/_dlq`、外部 DLQ、日志都行。
   * `message` 是本轮结算后的投递副本（带 `mbx-attempt` / `mbx-round`；广播 barrier 没记到副本时
   * 退回不带计数的 `_send` 那份），`failed[].attempts`
   * 是各自那条重试链的次数。`failed[].deliveryId` 是投递级身份——副本会换，`deliveryId` 不会，
   * 所以要按投递记账就认它，不要按对象同一性。`MemoryProvider#enableDeadLetterQueue()` 是一个可参考的接法。
   * 钩子自己抛错 / 返回 rejected promise 不会吞掉回队 / 丢弃判定，错误会被记录。
   */
  protected _onDeliveryDeadLettered?(message: MailMessage, failed: readonly DeliveryResult[]): void | Promise<void>;

  /**
   * 调死信钩子，并把钩子自己的故障与投递处置隔开。
   *
   * 为什么要替钩子兜：钩子通常在 `nack` 之后、或在 barrier 的 `.then` 里被调——它一抛错，
   * 外层 catch 会把「回队 / 丢弃」一起吞掉（消息既不回队也不死信，正好退化成 issue#1）。
   * 同步抛错和异步 rejection 都接住（后者不接就是 unhandledRejection）。
   */
  private _invokeDeadLetteredHook(message: MailMessage, failed: readonly DeliveryResult[]): void {
    this._invokeHook(
      'dead-letter hook',
      message.id,
      () => this._onDeliveryDeadLettered?.(message, failed),
    );
  }

  /** 调耗尽钩子，同样不让它把处置判定带倒。 */
  private _invokeRetryExhaustedHook(message: MailMessage, attempts: number): void {
    this._invokeHook(
      'retry-exhausted hook',
      message.id,
      () => this._onRetryExhausted?.(message, attempts),
    );
  }

  private _invokeHook(label: string, messageId: string, call: () => void | Promise<void> | undefined): void {
    let returned: void | Promise<void> | undefined;
    try {
      returned = call();
    } catch (error) {
      console.error(`[${this.protocol}] ${label} failed for message ${messageId} (delivery disposition unchanged):`, error);
      return;
    }

    if (returned && typeof (returned as Promise<void>).catch === 'function') {
      (returned as Promise<void>).catch((error) => {
        console.error(`[${this.protocol}] ${label} rejected for message ${messageId} (delivery disposition unchanged):`, error);
      });
    }
  }

  /**
   * 放弃一条投递（传输 / 队列型 provider）：先 `nack(false)` 把消息永久移出队列，再走死信钩子。
   *
   * 顺序不能倒：钩子往 DLQ 写之前，broker 必须已经不再重投，否则 DLQ 和队列里会同时出现
   * 同一条消息（wiki/mailbox-arch.md 「不可重试错误的处理流程」）。不发这个信号，
   * 不可重试的坏消息就会被 broker 无限重投。
   */
  private async _giveUpDelivery(message: MailMessage, result: DeliveryResult): Promise<void> {
    try {
      await this.nack(message, false);
    } catch (error) {
      console.error(
        `[${this.protocol}] CRITICAL: Failed to NACK (discard) message ${message.id}; the transport may redeliver it.`,
        error,
      );
    }
    this._invokeDeadLetteredHook(message, [result]);
  }

  /** provider 没实现 `_nack` 时告警一次：内核的处置决定落空了。 */
  private _warnMissingNack(): void {
    if (this.nacklessWarned) {
      return;
    }
    this.nacklessWarned = true;
    console.warn(
      `[${this.protocol}] A delivery settled with a disposition (requeue or discard), but this provider does not implement ` +
      '`_nack(message, requeue)`, so the decision was dropped and the message stays where the transport left it ' +
      '(typically: redelivered forever after the visibility timeout). Implement `_nack`: requeue=true puts the message ' +
      'back (position and attempt cap are yours to choose), requeue=false means give up (drop it or dead-letter it).',
    );
  }

  /**
   * 广播的结算 barrier：把 `publish` 返回的每次投递绑成一个后台任务，全部投递
   * （含重试链）落定后统一判定要不要 `nack(requeue)`。给广播型 provider 的 `_send` 用。
   *
   * **处置信号里的消息是本轮结算后的投递副本**（带 `mbx-attempt` / `mbx-round`），不是
   * `_send` 传进来的那份共享对象——否则回队的那一份不带任何计数，`fetch()` 兜底消费者与
   * 想设上限的 provider 就都没东西可数。拿不到副本时退回 `_send` 那份（计数全缺）：
   * 投递没走基类入口（不经 `_startDelivery` / `_deliverToLocalSubscription`）、同 id 并发广播时
   * 后落定的 barrier、副本表被 {@link MAX_SETTLED_COPIES} 淘汰。
   *
   * 不阻塞 `post()`：`post()` 在派发完成时就 resolve，判定在投递结算后才发生。
   * 这正是 issue#2 的坑：“按成功订阅者数 > 0 跳过回队”在 fire-and-forget 广播上会误判 ——
   * 先失败的订阅者可能比慢而成功的订阅者先结算。
   */
  protected _trackBroadcastSettlement(
    message: MailMessage,
    deliveries: readonly (Promise<DeliveryResult | void> | DeliveryResult | void)[],
  ): void {
    // 登记 barrier：基类靠它区分「有人在判定」和「provider 漏接了 barrier」。
    // 必须在 `_send` 里同步登记（`await` 之前），否则同步失败的投递会先看到“无 barrier”。
    this._registerBroadcastBarrier(this.copyKeyOf(message));

    void Promise.allSettled(deliveries.map((delivery) => Promise.resolve(delivery)))
      .then(async (settled) => {
        const results = toDeliveryResults(settled);
        const requeue = shouldRequeueAfterBroadcast(results);
        const failed = results.filter((result) => !result.ok);
        // 处置与钩子都用**本轮结算后的投递副本**：`_send` 那份共享对象上没有 `mbx-attempt` /
        // `mbx-round`，把它退回队列就等于把计数抹了——兜底消费者看不出已经投过几轮，
        // 想自己封顶的 provider 也没东西可数。
        const disposition = this._takeSettledCopy(message) ?? message;

        // 先发处置信号，再落死信：钩子写 DLQ 时，队列侧的处置必须已经落定，
        // 否则同一消息会同时出现在队列和 DLQ 里（与传输型的 `nack(false)` → 钩子同一顺序）。
        await this.nack(disposition, requeue);

        if (!requeue && failed.length > 0) {
          this._invokeDeadLetteredHook(disposition, failed);
        }
      })
      .catch((error) => {
        console.error(`[${this.protocol}] CRITICAL: Failed to settle a broadcast.`, error);
      })
      .finally(() => {
        this._releaseBroadcastBarrier(this.copyKeyOf(message));
      });
  }

  private _registerBroadcastBarrier(messageId: string): void {
    this.broadcastBarriers.set(messageId, (this.broadcastBarriers.get(messageId) ?? 0) + 1);
  }

  private _releaseBroadcastBarrier(messageId: string): void {
    const depth = (this.broadcastBarriers.get(messageId) ?? 0) - 1;
    if (depth > 0) {
      this.broadcastBarriers.set(messageId, depth);
    } else {
      this.broadcastBarriers.delete(messageId);
    }
  }

  /** 这条消息当前有没有正在判定的 barrier（同 id 并发广播时按层数计）。 */
  private _barrierDepth(messageId: string): number {
    return this.broadcastBarriers.get(messageId) ?? 0;
  }

  /**
   * 广播型 provider 的兜底：投递已结算，但这条消息没有 barrier —— 说明 `_send` 漏接了
   * `_trackBroadcastSettlement`，没人做回队判定。宁可整条回队让 `fetch()` 兜底
   * （issue#1 的“不得静默丢失”），也不能让消息消失；同时告警提示 provider 作者。
   *
   * 推迟一个微任务再判定：`publish` 里同步抛错的投递跑在 `_send` 登记 barrier 之前。
   */
  private _fallbackForMissingBarrier(message: MailMessage, result: DeliveryResult): void {
    if (result.ok || this._barrierDepth(this.copyKeyOf(message)) > 0) {
      return;
    }
    queueMicrotask(() => {
      if (this._barrierDepth(this.copyKeyOf(message)) > 0) {
        return; // barrier 已登记（同一任务内），判定交给它
      }
      this._warnMissingBarrier(message.id);
      if (result.reason === 'fatal') {
        // 放弃：先把消息永久移出队列（`nack(false)`），再走死信钩子。
        void this._giveUpDelivery(message, result);
        return;
      }
      this.nack(message, true).catch(nackError => {
        console.error(`[${this.protocol}] CRITICAL: Failed to NACK message ${message.id}. Risk of message duplication.`, nackError);
      });
    });
  }

  private _warnMissingBarrier(messageId: string): void {
    if (this.barrierlessWarned.has(messageId)) {
      return;
    }
    if (this.barrierlessWarned.size > 500) {
      this.barrierlessWarned.clear(); // 不让告警名单无限增长
    }
    this.barrierlessWarned.add(messageId);
    console.warn(
      `[${this.protocol}] A broadcast delivery of message ${messageId} settled without a settlement barrier. ` +
      'A broadcast provider must call `_trackBroadcastSettlement(message, deliveries)` in `_send` ' +
      '(synchronously, before any await) or retriable failures will fall back to whole-message requeue.',
    );
  }

  /**
   * 结算一条投递，并按 provider 类型把**处置信号**发出去：
   *
   * - 广播型：交给 `_fallbackForMissingBarrier`（接了 barrier 的由 barrier 统一判定）；
   * - 队列 / 传输型：`fatal` = 放弃 → `nack(false)` + 死信钩子；`cancelled`（退订 / 看门狗）
   *   = 交回传输层重投 → `nack(true)`。
   *
   * 这两类分支以前分开写在 `_settleAndFallback` / `_abandonDelivery` 里，导致传输型的 `fatal`
   * 既没 nack 也没钩子（消息停在 in-flight，stale 扫描后又回来，无限循环）。
   */
  private _settleAndFallback(key: string, outcome: DeliveryOutcome): DeliveryResult | undefined {
    const pending = this.pendingDeliveries.get(key);
    if (!pending) {
      return undefined; // 已结算过
    }
    const result = this._settleDelivery(key, outcome);
    if (!result) {
      return undefined;
    }

    if (this.broadcastDeliveries) {
      this._fallbackForMissingBarrier(pending.message, result);
      return result;
    }

    if (outcome === 'fatal') {
      void this._giveUpDelivery(pending.message, result);
    } else if (outcome === 'cancelled') {
      // 非广播（传输型）：每次投递对应 broker 的一次 ack，交回传输层重投。
      this.nack(pending.message, true).catch(nackError => {
        console.error(`[${this.protocol}] CRITICAL: Failed to NACK message ${pending.message.id}. Risk of message duplication.`, nackError);
      });
    }
    return result;
  }

  /**
   * 放弃一条投递（退避中退订 / 看门狗超时）：按取消结算，消息交给兜底路径。
   */
  private _abandonDelivery(key: string, outcome: DeliveryOutcome = 'cancelled'): void {
    this._settleAndFallback(key, outcome);
  }

  // --- 结算看门狗 ---

  /**
   * 给当前这次尝试装一个结算看门狗。只在尝试开始时计时，退避等待期间不计时，
   * 所以不会掐断健康的重试链。
   */
  private _armDeliveryWatchdog(key: string): void {
    const pending = this.pendingDeliveries.get(key);
    if (!pending) {
      return;
    }
    this._clearDeliveryWatchdog(pending);
    const timeout = this.deliverySettleTimeout;
    if (!timeout || timeout <= 0) {
      return; // 显式关闭：长任务由调用方自己负责
    }
    const timer = setTimeout(() => {
      pending.watchdog = undefined;
      this._onDeliveryStall(key);
    }, timeout);
    (timer as unknown as { unref?: () => void }).unref?.();
    pending.watchdog = timer;
  }

  private _clearDeliveryWatchdog(pending: PendingDelivery): void {
    if (pending.watchdog) {
      clearTimeout(pending.watchdog);
      pending.watchdog = undefined;
    }
  }

  /**
   * 看门狗到期：回调还在跑（卡死 / 超长）。按取消结算，消息回到兜底路径；
   * 回调事后成功不会重复结算（见 `_settleDelivery` 的一次性守卫）。
   */
  private _onDeliveryStall(key: string): void {
    const pending = this.pendingDeliveries.get(key);
    if (!pending) {
      return;
    }
    console.warn(
      `[${this.protocol}] Delivery ${pending.deliveryId} did not settle within ${this.deliverySettleTimeout}ms ` +
      `(subscriber callback still running). Settling it as cancelled so the message can be requeued; ` +
      'raise `deliverySettleTimeout` (0 disables) if this delivery is expected to take longer.',
    );
    this._abandonDelivery(key, 'cancelled');
  }

  /**
   * 结算一条投递（幂等：已结算过则直接返回 `undefined`，不会重复投。
   */
  private _settleDelivery(key: string, outcome: DeliveryOutcome): DeliveryResult | undefined {
    const pending = this.pendingDeliveries.get(key);
    if (!pending) {
      return undefined; // 已结算过（例如退订时按 cancelled 结算）
    }
    this.pendingDeliveries.delete(key);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    this._clearDeliveryWatchdog(pending);

    const result: DeliveryResult = {
      deliveryId: pending.deliveryId,
      subscriptionId: pending.subscriptionId,
      messageId: pending.message.id,
      ok: outcome === 'ok',
      ...(outcome === 'ok' ? {} : { reason: outcome }),
      attempts: Math.max(1, pending.attemptsMade),
      ...(outcome === 'ok' || pending.lastError === undefined
        ? {}
        : { error: describeDeliveryError(pending.lastError) }),
    };
    if (this.broadcastDeliveries) {
      // 广播的处置由 barrier 统一发，而 barrier 手里只有 `send()` 那份共享对象；这里把带计数
      // 的副本存下来，否则回队的那一份没有任何计数可数（见 _trackBroadcastSettlement）。
      this._recordSettledCopy(pending.message, result.attempts ?? 1);
    }
    pending.settle(result);
    return result;
  }

  /**
   * 记下已结算投递的副本（按**份**存），保留趟数最大的那一份（这一份“跑得最远”的那条投递）。
   *
   * 按份而不是按 id：广播给 N 个订阅者的就是这一份，N 条投递都往同一个槽里写、留下最远的；
   * 按 id 存就会让同名的另一封信的副本挤掉这一份的（barrier 随后把别人的计数回进队列）。
   */
  private _recordSettledCopy(message: MailMessage, attempts: number): void {
    const key = this.copyKeyOf(message)
    const existing = this.settledCopies.get(key);
    if (existing && existing.attempts >= attempts) {
      return;
    }
    if (this.settledCopies.size >= MAX_SETTLED_COPIES) {
      const oldest = this.settledCopies.keys().next();
      if (!oldest.done) {
        this.settledCopies.delete(oldest.value);
      }
    }
    this.settledCopies.set(key, { message, attempts });
  }

  /** barrier 取走并清掉本轮那份副本；没记到就退回共享对象（provider 没走基类投递入口）。 */
  private _takeSettledCopy(message: MailMessage): MailMessage | undefined {
    const key = this.copyKeyOf(message)
    const copy = this.settledCopies.get(key);
    this.settledCopies.delete(key);
    return copy?.message;
  }

  /**
   * 「哪一份」的记账身份：系统发的 `mbx-send-id` 优先；没发号（非标准路径直接调
   * `_deliverToLocalSubscription` 等）退到对象身份。与队列侧同一口径，见 `copyIdentity`。
   */
  private copyKeyOf(message: unknown): string {
    return copyIdentity(message, (o) => {
      let tag = this.copyTags.get(o);
      if (tag === undefined) {
        tag = ++this.nextCopyTag;
        this.copyTags.set(o, tag);
      }
      return String(tag);
    });
  }

  /**
   * 取消某个订阅者尚未结算的投递（退订 / 关闭）。
   *
   * 只取消「等待重投」的投递（有退避定时器）。正在执行的回调不替它下结论：
   * 提前结算成 `cancelled` 会被 barrier 误判为“无人成功”→ 整条消息回队 →
   * 已经执行过的副作用被 `fetch()` 消费者再跑一次（issue#2 的重复，换了个入口）。
   * 卡死的回调由看门狗兜底。
   */
  private _cancelPendingDeliveries(subscriptionId: string): void {
    const prefix = deliveryKey(subscriptionId, '');
    for (const key of Array.from(this.pendingDeliveries.keys())) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const pending = this.pendingDeliveries.get(key);
      if (!pending || !pending.timer) {
        continue; // 正在跑的回调：由它自己结算
      }
      clearTimeout(pending.timer);
      pending.timer = undefined;
      this._abandonDelivery(key, 'cancelled');
    }
  }

  /**
   * 当前尚未结算的投递数量（诊断 / 测试用）。
   */
  protected get pendingDeliveryCount(): number {
    return this.pendingDeliveries.size;
  }

  protected _isRetriable(error: any): boolean {
    return isRetriableError(error);
  }
}
