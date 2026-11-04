/**
 * 代表一个活跃的订阅会话。
 */
export interface Subscription {
  readonly id: string;
  readonly address: URL;
  status: 'active' | 'connecting' | 'paused' | 'closed';
  unsubscribe(): Promise<void>;
}

/**
 * 代表一封待发送的信件。
 * 这是用户在调用 post() 方法时需要构建的对象。
 */
export interface OutgoingMail {
  /**
   * 消息标识。如果未提供，Mailbox 将自动生成。
   *
   * **它是发送方给的名字，不是系统的状态键。** 名字重复是可以的：同一个 id 发两次、
   * 两个发送方撞名、恶意发送方故意撞名，都不应该让系统把别人的信当成这一份丢掉。
   * 队列、在飞表、回队去重、结算全部按「哪一份」记账（每份信一个 `mbx-send-id`，
   * 在发送边界发一个：`MailboxProvider.send()`，发送方伪造不了），而不是按 id。
   *
   * 想要【内容级幂等】（同一份内容只投递一次）：那是**发送边界上的显式策略**，目前未实现——
   * 发送侧**不会**按 id 丢弃重复信件。需要就自己在 `post()` 前判，并自己决定怎么告知调用方。
   */
  id?: string;
  from: URL | string;
  to:URL | string;
  body: any;
  /**
   * Mailbox 框架及其生态约定的控制信息（控制平面），用于指导消息的传输、路由、认证和关联。
   *
   * 标准 Header 约定：
   * - `req-id`: 请求标识 (Request ID)。用于在异步交互中匹配请求与响应。
   *   在运输层，它是单次交互的关联键。**内核只透传它，不按它去重**：想挡住网络重传造成的
   *   重复请求，得由传输层或接收方自己实现（可以拿它当键），内核不替你做。
   *   每次请求应生成独立的 req-id 以确保当前闭环。
   * - `trace-id`: 全链路追踪标识 (Trace ID)。由业务源头生成并在整个生命周期中透传。
   *   用于跨多个 Request 串联起完整的业务流日志，是解决分布式复杂拓扑下可观测性问题的关键。
   * - `mbx-reply-to`: 邮箱系统标准的回复地址。指明响应消息应发往的 Mailbox 地址。
   * - `mbx-sent-at`: 发送时间戳 (ISO 8601)。由 Provider 在发送时自动注入。
   *   代表消息正式进入传输系统的时刻，是审计消息时效、监控传输延迟的权威标准。
   * - `mbx-attempt`: **本轮投递链内**是第几趟（1 起算，字符串）。由基类在把消息交给订阅回调前
   *   注入到投递**副本**上，所以重投中的回调、`_nack` 与死信记录都能看到「这一轮试了几次」。
   *   它是链内计数，**不是重投计数**：消息回队、下一轮投递重新从 `'1'` 数（跨轮累积看
   *   `mbx-round`）。没开重试策略时本轮恒为 `'1'`。
   * - `mbx-max-attempts`: 只在 provider 开了重试策略时注入（= `RetryPolicy.maxAttempts`）。
   *   上限归 provider，内核不自行发明。
   * - `mbx-round`: 这条消息是**第几轮**被交到消费者手里（1 起算，字符串，跨回队累积）。
   *   规则是「谁把消息交给消费者，谁给它 +1」：基类在每次开始订阅投递时 +1，队列在把消息交给
   *   `fetch()` 消费者时 +1；回队交回的始终是那份打戳副本，所以下一轮看得见累积值。
   *   **要在队列侧做 SQS 式 `maxReceiveCount` 上限，数的就是它，不是 `mbx-attempt`。**
   * - `mbx-send-id`: 「这一份信」的编号。在发送边界发一个（`MailboxProvider.send()`——`_send()`
   *   唯一的入口，全局唯一），随投递副本一路带着走。发号只有这一处：写在门面上第三方 provider 就得
   *   自己记得；让队列自己发更坏（每次 `enqueue` 一个新号 = 同一份信两本账）。
   *   为什么需要：`id` 会重复，而队列得分清「哪一份」——排队 / 在飞 / 回队去重 / 结算都按它。
   *   跳端移植注意：这个头必须随消息序列化（不能只存内存），否则一份信的副本会被当成另一份。
   *
   * **自带的系统头一律不采信**（`send()` 统一剥，`post()` 也先剥一遍）：`mbx-send-id`、`mbx-round`、`mbx-attempt`、
   * `mbx-max-attempts`、`mbx-sent-at`，以及所有 `mbx-dead-letter*`。采信它们就等于把“重试几次”、
   * “要不要被封顶丢弃”、“这是不是死信记录”交给发送方定。`mbx-reply-to` 不在名单里——它是发送方自己的字段。
   */
  headers?: {
    'req-id'?: string;
    'trace-id'?: string;
    'mbx-reply-to'?: string;
    'mbx-sent-at'?: string;
    [key: string]: any;
  };
  /**
   * 本邮件消息的附加数据（邮件的数据平面），是消息的业务内容的补充元信息，由业务应用自定义和使用。
   * 系统只负责透传，不进行解析和干预。本质上是邮件的一部分。
   */
  meta?: { [key: string]: any; };
}

/**
 * 代表一封在系统内传递的、带有唯一标识的规范信件。
 * 这是在 Mailbox 与 Provider 之间传递的主要对象。
 * 消费者收到的也是此类型的消息。
 */
export interface MailMessage extends Omit<OutgoingMail, 'from' | 'to'> {
  readonly id: string;
  readonly from: URL;
  readonly to: URL;
}

/**
 * 代表一个可被手动确认或拒绝的信件。
 *
 * **一次取信 = 一次处置**：只有第一次 `ack` / `nack` 生效，同一个 handle 上重复确认不再作数
 * （`ack()` 之后再 `nack(false)` 既不会退回队列也不会丢弃）。provider 必须守住这条：重复处置
 * 若还能生效，接了死信队列的 provider 就会为同一次放弃留下多条记录，而迟到的处置会误伤
 * 重投后新消费者手里的同一条消息。
 */
export interface Ackable {
  /**
   * **结束这次交付：这一份到此为止，系统不留任何东西。**
   *
   * `ack` 不是“处理成功了”的意思，而是“我看完了，别再管这一份”——你怎么处理的、处理成
   * 什么样、还是干脆判定这封信不合格直接扔掉，provider 不知道也不问。想静默丢弃，就用它。
   *
   * 结算绑在这一次 `fetch` 上（句柄内部拿着份号 + 第几次交出去），所以迟到的旧句柄不能销掉
   * 新消费者的租约：它只会安静地 no-op（本方法回 `void`，要看到“没落定”得用队列层的
   * `MailMessageQueue.ack` / `nack`，它们回 boolean）。
   */
  ack(): Promise<void>;

  /**
   * **结束这次交付，并且请 provider 按它自己协议的规矩善后。**
   *
   * @param requeue `true` = 放回队列，还会再交给我一次；`false`（默认）= 结束它，
   *   **不会再交给我**，由 provider 决定怎么善后。
   *
   * 三个动作的真实差别（不是“成功 / 失败”）：
   *
   * | 动作 | 这一份 | 还会交给我吗 | provider 按协议善后 |
   * | --- | --- | --- | --- |
   * | `ack()`             | 删 | 不 | 不 |
   * | `nack(false)`       | 删 | 不 | **做** |
   * | `nack(true)`        | 回队 | 会 | 不 |
   *
   * “善后”是 provider 按自己协议做的事，内核不规定它是什么：
   * `MemoryProvider` 是往死信 topic 存一份副本（没开 `enableDeadLetterQueue()` 就等同于
   * `ack()`——纯丢弃，零痕迹）；SMTP 是 reject / bounce；IMAP 是打 `\Deleted` 再 expunge；
   * MQTT 一类压根没有这个概念。**不要指望 `nack(false)` 自带 DLQ。**
   *
   * 不管各协议怎么善后，有一条对所有实现都成立：`nack(false)` 之后**这条消息不能再被交回给
   * 任何消费者**。死信链到顶（`maxNesting`）时也不例外——那种记录**停放**在那里：不在
   * `unreadCount` 里、`fetch` 取不到，只能查（`MemoryProvider#peekParked`），排走要显式
   * `purgeParked`。把它塞回队列等于反悔这句承诺（排空脚本会永远取到同一条）。
   *
   * 回队位置、已重投几趟由 provider 决定，内核不管——但内核会把带 `mbx-attempt` /
   * `mbx-round` 的投递副本交给你，设上限就有得数。
   */
  nack(requeue?: boolean): Promise<void>;
}

export type AckableMailMessage = MailMessage & Ackable;

/**
 * `fetch()` 的只读快照形式（issue#4）：返回副本，不出队、不建 in-flight、不动活动时间。
 *
 * 返回总是**数组**（空队列是 `[]`），与单条取回的 `MailMessage | null` 刻意不同：
 * 只读快照没有「取不到」这种状态，只有「看到几条」。
 */
export interface PeekFetchOptions {
  peek: true;
  /** 最多看几条；省略（或 `Infinity`）看整个队列。必须是非负整数。 */
  limit?: number;
  [name: string]: any;
}

/** `fetch()` 的手动 ACK 形式：消息进 in-flight，直到 ack / nack 或超时重投。 */
export interface ManualAckFetchOptions {
  manualAck: true;
  /**
   * **这份租约**的时长（ms）：取走那一刻就定下并记在租约上，之后不由别人改。
   *
   * 省略（或负数 / 非法值）用 {@link DEFAULT_ACK_TIMEOUT}；`0` / `null` = 这份租约永不过期，
   * 只能由它自己的句柄 ack / nack（别的消费者再怎么清扫都不能把它抖回队列）。
   *
   * 注意它**不是**“清扫阈值”：到期回收扫的是每条租约自己的到期时刻。所以一个消费者拿 1ms
   * 来取信，不会提前接管别人未到期的租约；拿 60s 来取信，也不会拖后一条早已到期的租约。
   * 回收是惰性的（无后台定时器，只有下一次 manualAck 取信才扫）：过期未收回的份数在
   * {@link MailboxStatus.overdueInFlightCount} 里可见。
   */
  ackTimeout?: number | null;
  [name: string]: any;
}

/** `fetch()` 的默认（隐式 ACK）形式：取到即出队。 */
export interface PlainFetchOptions {
  manualAck?: false;
  [name: string]: any;
}

/** `fetch()` 的全量选项形状（实现侧签名用）。 */
export interface FetchOptions {
  manualAck?: boolean;
  peek?: boolean;
  limit?: number;
  ackTimeout?: number | null;
  [name: string]: any;
}

/**
 * 代表一个邮箱地址的状态信息。
 */
export interface MailboxStatus {
  /**
   * provider 对**这个地址**的可观测状态：
   *
   * - `online`：provider 在线，且认得这个地址（有队列 / 订阅 / 活动记录）；
   * - `unknown`：provider 在线，但对这份地址**没有任何记录**（地址不存在、拼错，
   *   或者 provider 本身不支持状态查询）；
   * - `offline` / `degraded`：provider 自己连不上 / 只能给出部分答复。
   *
   * 不要把「地址不存在」报成 `online` + 0：诊断页区分不出「不存在」与「空闲」。
   * 要区分「地址不存在」和「provider 答不了」，看 {@link MailboxStatus.exists}。
   */
  state: 'online' | 'offline' | 'degraded' | 'unknown';
  /**
   * provider 是否认得这个地址（有过消息 / 订阅 / 活动记录）。
   *
   * 只有在 provider **明确回答了**状态查询时才有值；不支持 `status` 的 provider 不会把它
   * 设成 `false`（那会把「问不到」误报成「不存在」）。
   */
  exists?: boolean;
  /**
   * 队列中未被消费的消息数量（不包含 in-flight）。
   */
  unreadCount?: number;

  /**
   * 已交给消费者、尚未 ack/nack 的消息数量。
   *
   * 不计入 `unreadCount`，否则卡在 in-flight 的消息在状态里完全隐形。
   * 这些消息在自己那份租约到期后会被重新入队——但**回收是惰性的**（只有下一次 manualAck
   * 取信才扫），所以必须跟 {@link overdueInFlightCount} 一起看。
   */
  inFlightCount?: number;
  /**
   * `inFlightCount` 里**租约已到期、还没被收回**的份数。
   *
   * 在飞消息的回收是惰性的（没有后台定时器，只有下一次 manualAck 取信才扫），所以一个僵死的
   * 消费者能把已过期的租约永远挂在 in-flight 里。这个数就是让那笔积压不再隐形：告警该盯它，
   * 而不是 `inFlightCount`（健康的在飞也是非零的）。
   */
  overdueInFlightCount?: number;
  /** 最老那条过期租约已经过期多久（ms）；没有过期租约时为 0。 */
  oldestOverdueMs?: number;
  /**
   * **停放**的份数：已判死、不会再交给任何消费者，但也还没被真正丢弃的记录。
   *
   * 它们**不在** `unreadCount` 里，也不会被 `fetch` 交出来（否则排空脚本会永远取到同一条），
   * 只能查：`MemoryProvider#peekParked(address)`。死信链到顶（`maxNesting`）就是典型来源。
   * 没有这个数，运维就只看到「没未读」，看不出「有一条判死的停在这儿」。
   */
  parkedCount?: number;
  /** 最老那条停放记录停了多久（ms）；没有停放时为 0。 */
  oldestParkedMs?: number;
  /**
   * 最后一次有消息活动（发送或接收）的时间 (ISO 8601 格式)；没有活动记录时为 `null`。
   *
   * 必须是 `null` 而不是 `undefined`：`undefined` 会在 `JSON.stringify` 后整个字段消失，
   * 诊断页拿到的是 `undefined` 而不是「没有活动」。
   */
  lastActivityTime?: string | null;

  /**
   * 索引签名，允许 MailboxStatus 包含任意其他字符串键的属性。
   * 这些属性将作为提供者特定的扩展信息。
   */
  [key: string]: any;
}

/**
 * 快照里一个地址的状态：{@link MailboxStatus} 加地址身份。
 */
export interface MailboxAddressSnapshot extends MailboxStatus {
  /** 寻址用的规范形式（见 {@link getCanonicalMailboxAddressIdentifier}）。 */
  canonicalId: string;
  /** 处理这个地址的 provider 协议名。 */
  protocol: string;
}

/**
 * `Mailbox#recover()` 的报告。
 */
export interface LeaseRecoveryReport {
  /** 实际收回了几份（幂等：紧接着再调一次通常是 0）。
   *  注意：`reclaimed === 0` 本身不等于“没事”——要看 `supported`。 */
  reclaimed: number;
  /** 被调到的 provider 到底有没有“租约可回收”这个概念。 */
  supported: boolean;
  /** 不带地址调用时：每个地址收回了几份（key = canonicalId）。 */
  byAddress?: Record<string, number>;
  /** 不带地址调用时：本次碰不到的 provider（没有 `recoverLeases`，或不能枚举自身地址）。 */
  unreachableProviders?: string[];
}

/**
 * 全量快照：一时刻整个 `Mailbox`（所有 provider、所有 topic）的诊断视图。
 *
 * 给诊断页、测试断言用（issue#4）。只能由能枚举自身 topic 的 provider（实现
 * {@link IMailboxProvider.listAddresses}）提供地址；不能枚举的（AMQP / SQS 这类消息不在本地的
 * broker）列在 {@link MailboxSnapshot.unsupportedProviders} 里，避免快照把「枚举不了」误读成「队列为空」。
 */
export interface MailboxSnapshot {
  /**
   * 快照的完整度：
   * - `online`：所有 provider 都能枚举，且所有地址都是 `online`；
   * - `degraded`：有 provider 无法枚举，或某个地址不是 `online`（看到了一部分）；
   * - `unknown`：没有任何 provider 能枚举（包括一个 provider 都没有注册）。
   */
  state: 'online' | 'offline' | 'degraded' | 'unknown';
  /** 已注册的协议名（排序后）。 */
  protocols: string[];
  /** 快照里的地址总数。 */
  addressCount: number;
  /** 所有地址的 `unreadCount` 之和。 */
  unreadCount: number;
  /** 所有地址的 `inFlightCount` 之和。 */
  inFlightCount: number;
  /** 所有地址的 `overdueInFlightCount` 之和（僵死消费者的信号）。 */
  overdueInFlightCount: number;
  /** 所有地址里最老化的一条过期租约过期了多久（ms）；没有则 0。 */
  oldestOverdueMs: number;
  /** 所有地址的 `parkedCount` 之和（判死停放的信号，不在 `unreadCount` 里）。 */
  parkedCount: number;
  /** 按 `canonicalId` 排序的地址状态，保证快照可重复、断言可写死。 */
  addresses: MailboxAddressSnapshot[];
  /** 不支持枚举自身地址的 provider（它们的队列不在本次快照里）。 */
  unsupportedProviders: string[];
  /** 快照生成的时间（ISO 8601）。 */
  takenAt: string;
}

/**
 * 定义了所有具体通信方式必须实现的接口。
 * Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。
 */
export interface IMailboxProvider {
  protocol: string;

  /**
   * 初始化 Provider。用于建立连接、验证配置等。
   */
  init?(): Promise<void>;

  /**
   * 关闭 Provider。用于释放资源、断开连接等。
   * 不会销毁积压消息（见 {@link IMailboxProvider.clear}）。
   */
  close?(): Promise<void>;

  /**
   * 丢弃本 provider 持有的积压消息（含 in-flight），不动订阅。可选实现。
   *
   * 为什么不是所有 provider 都能实现：真实 broker（AMQP / SQS…）的消息不在本地，
   * 删它属于破坏性运维操作。由 provider 自己决定支持与否；`Mailbox#stop({ purge: true })`
   * 会跳过没实现这个方法的 provider。
   */
  clear?(): Promise<void>;

  send(message: MailMessage): Promise<MailMessage>;

  /**
   * 【订阅模式】订阅一个地址，当有信件到达时触发回调。
   * 确认机制为隐式ACK：当 onReceive 函数成功执行，消息被自动确认。
   *
   * 回调抛错时，内核只做两件事：
   *   1. 把错误分类成可重试 / 不可重试（见 `isRetriableError`）；
   *   2. 发出**处置信号**：`_nack(message, true)` = 回队（不是放弃），
   *      `_nack(message, false)` = 放弃，并在之后调 `_onDeliveryDeadLettered`。
   *
   * 内核**不**保证的事（均归 provider）：重投几次、回到队列的哪个位置、放弃之后留下什么。
   * 但处置信号里的 `message` 是**本轮结算后的投递副本**（带 `mbx-attempt` / `mbx-round`），
   * 不是 `send()` 那个共享对象——所以回队的那份在队列里也带着次数，`fetch()` 兜底消费者看得见。
   * 隐式 ACK 收到的也是副本（带计数的投递副本，见基类 `_ack`）。
   * 推论：provider **不得按对象同一性记账**（`Map<MailMessage, handle>` / `WeakMap` / `set.has(message)`）——
   * 查不到不报错，只会静默不 ack。用 `message.id` 或 broker 自己的投递句柄记账。
   * （广播 barrier 没记到副本时会退回 `send()` 那份不带计数的副本：投递没走基类入口 / 同 id
   * 并发广播 / 副本表淘汰，所以 读取计数时要容 `undefined`。）
   * “移入死信队列”不是内核行为：基类只给钩子，默认实现不接（`MemoryProvider` 需要显式
   * `enableDeadLetterQueue()`）。需要 DLQ 就在钩子里自己写。
   */
  subscribe(address: URL, onReceive: (message: MailMessage) => void | Promise<void>): Subscription;

  /**
   * 【拉取模式】从指定地址主动拉取一封信件。
   * 支持自动ACK (默认) 和手动ACK两种模式。
   *
   * 【只读】`{ peek: true, limit?: n }`：返回副本数组，不出队、不建 in-flight（诊断 / 审计用）。
   * 参数名在三端（TS / Python / Rust）保持一致。
   *
   * 实现注意：不认识 `peek` 的 provider **不能默默把它当普通 fetch 跑**（那会把消息取走，
   * 而调用方以为自己在只读快照）。继承 {@link MailboxProvider} 基类的实现会在入口报错；
   * 直接实现本接口的 provider 必须自己处理或拒绝 `peek`。
   */
  fetch(address: URL, options: PeekFetchOptions): Promise<MailMessage[]>;
  fetch(address: URL, options: ManualAckFetchOptions): Promise<AckableMailMessage | null>;
  fetch(address: URL, options?: PlainFetchOptions): Promise<MailMessage | null>;
  fetch(address: URL, options?: FetchOptions): Promise<MailMessage | AckableMailMessage | MailMessage[] | null>;

  /**
   * 查询指定地址的状态。
   * 这是一个可选实现的方法。如果 Provider 不支持，可以抛出 "Not Implemented" 错误或返回一个默认状态。
   * @param address 要查询状态的地址。
   * @returns 返回地址的状态信息。地址不存在时返回 `state: 'unknown'` + `exists: false`，
   *          而不是 `state: 'online'` + 0（issue#4）。
   */
  status?(address: URL): Promise<MailboxStatus>;

  /**
   * 列出本 provider 当前认得的地址（canonical id，见 {@link getCanonicalMailboxAddressIdentifier}）。
   *
   * 可选能力：只有消息确实存在本地的 provider（如 `MemoryProvider`）能实现。
   * 没实现就不实现——{@link MailboxSnapshot} 会把这类 provider 归入
   * {@link MailboxSnapshot.unsupportedProviders}，不会把「枚举不了」当成「队列为空」。
   */
  /**
   * [Optional] 把该地址上**租约已到期**的在飞消息收回队列，返回收回了几份（幂等）。
   *
   * 有“租约”这个概念的 provider（队列型 / 拉取型）实现它，`Mailbox#recover()` 就能把僵死消费者
   * 手里的过期租约收回来。没实现（推送型，或可见性超时在 broker 侧的 AMQP / SQS）会被
   * `recover()` 报成 `supported: false` —— **不能当作“一切正常”**。
   */
  recoverLeases?(address: URL): Promise<number>;

  listAddresses?(): Promise<string[]>;

  /**
   * 创建一个唯一标识符。主要是用于生成邮件的 ID。
   */
  generateId(): string;
}
