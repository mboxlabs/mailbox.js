/**
 * 代表一个活跃的订阅会话。
 *
 * 它是在 `await subscribe(...)` **完成之后**才递到调用方手上的：await 就是
 * 「provider 确认这条订阅已生效」的时刻。
 */
export interface Subscription {
  readonly id: string;
  readonly address: URL;
  /**
   * 订阅状态。
   *
   * - `active` / `closed`：继承 {@link MailboxProvider} 的实现能给出的两个值（按“还在不在
   *   订阅表里”推导，不靠 provider 自己上报）。
   * - `paused`：**留给 provider 扩展的类型约定**。内核不实现 pause / resume，也不会在任何
   *   时刻产出它——把它当成“系统支持暂停”就错了；只实现了暂停语义的 provider 才能返它。
   *
   * 这里没有 `connecting`：订阅建立是一个 `await` 点，await 完成前根本拿不到本对象，
   * 所以不存在「已拿到对象但还在连接中」这个可观察中间态。
   */
  status: 'active' | 'paused' | 'closed';
  /**
   * 退订。
   *
   * 在「handle 还在 `await` 里」的窗口里调用也安全：登记先于 await，所以退订看得见它；
   * 拆 handle 的动作则后移到 handle 落地时（基类保证不把 `undefined` 当句柄递给 provider）。
   * 代价是那条补拆发生在 `subscribe()` 那一侧、而不是本方法里——本方法会先返回。
   */
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
 * 内核的三个处置值（消费者侧唯一通用的词汇表）。
 *
 * 它们说的不是「成功 / 失败」，而是「这一次交付要怎么收尾」：
 *
 * | 值 | 这一份信 | 还会再交给我吗 | provider 按协议善后 |
 * | --- | --- | --- | --- |
 * | `handled`   | 结束，不留痕 | 不 | 不 |
 * | `unhandled` | 交回队列 | **会** | 不 |
 * | `discard`   | 判它不合格，结束 | 不 | **做**（死信 / bounce / 打标记…） |
 *
 * 其余字符串是 provider 自定义值，必须由能力声明（`supports.has('disposition:<值>')`）覆盖，
 * 否则内核在处置发生前就报 {@link UnsupportedCapabilityError}。
 *
 * 「按协议善后」是 provider 按自己协议做的事，内核不规定它是什么：`MemoryProvider` 是往死信
 * topic 存一份副本（没开 `enableDeadLetterQueue()` 就等同于丢弃，零痕迹）；SMTP 是 reject /
 * bounce；IMAP 是打 `\Deleted` 再 expunge；MQTT 一类压根没有这个概念。**不要指望 `discard`
 * 自带 DLQ。**
 *
 * 不管各协议怎么善后，有一条对所有实现都成立：`discard` 之后**这条消息不能再被交回给任何
 * 消费者**。死信链到顶（`maxNesting`）时也不例外——那种记录**停放**在那里：不在 `unreadCount`
 * 里、`fetch` 取不到，只能查（`MemoryProvider#peekParked`），排走要显式 `purgeParked`。
 * 把它塞回队列等于反悔这句承诺（排空脚本会永远取到同一条）。
 *
 * 回队位置、已重投几趟由 provider 决定，内核不管——但内核会把带 `mbx-attempt` / `mbx-round`
 * 的投递副本交给你，设上限就有得数。
 */
export const CORE_DISPOSITIONS = ['handled', 'unhandled', 'discard'] as const;

/** {@link CORE_DISPOSITIONS} 里的三个内核处置值。 */
export type CoreDisposition = (typeof CORE_DISPOSITIONS)[number];

/**
 * 一次交付的处置值。三个内核值 + provider 自己声明过的自定义值
 * （`string & {}` 只是为了让编辑器继续提示那三个值，不做限制）。
 */
export type Disposition = CoreDisposition | (string & {});

/**
 * 代表一个可被处置的信件句柄——它代表**这一次交付**，不是这封信。
 *
 * **一次取信 = 一次处置**：句柄只生效一次。重复处置、租约到期重投后拿着旧句柄来处置，
 * 都**不生效**，并把这个事实回给你（返回 `false`）——不抛错，也不静默 no-op。
 * 要「先占着再定」用租约（`ackTimeout`、`ackTimeout: 0` 常驻租约），不是靠多按几次按钮。
 *
 * 为什么必须守住这条：重复处置若能生效，接了死信队列的 provider 就会为同一次放弃留下多条
 * 记录（补偿脚本会重复补偿）；迟到的处置若能生效，就会误伤重投后新消费者手里的同一条消息。
 */
export interface Ackable {
  /**
   * 结束这次交付，并说明怎么结束它（见 {@link CORE_DISPOSITIONS}）。
   *
   * 省略 = `handled`：这一份到此为止，系统不留任何东西。`ack` 不是「处理成功了」的意思——
   * 你怎么处理的、还是干脆判定这封信不合格，provider 不知道也不问。
   *
   * @param where 处置值。`handled` / `unhandled` / `discard`，或 provider 声明过的自定义值。
   * @returns 这次处置**有没有生效**：
   *   - `true`：生效了（消息按 `where` 收尾）；
   *   - `false`：没生效——这个句柄已经处置过，或它代表的那次交付已经不归它了（租约被回收、
   *     消息已被别的消费者处理 / 丢弃）。**调用方不该把 `false` 当成功。**
   *   - `undefined`：这个 provider 不报告处置结果（能力没到）。想知道就别忽略这个返回值。
   *
   * 处置值不被认得时**先抛错、不动消息**：句柄的「一次处置」机会不会被一个失败的调用消耗掉。
   */
  ack(where?: Disposition): Promise<boolean | void>;

  /**
   * @deprecated 用 {@link Ackable.ack} 的处置值：`nack(true)` = `ack('unhandled')`，
   *   `nack(false)` = `ack('discard')`。
   *
   *   为什么还留着：布尔参数在 `v1.0.0` 就发布了，直接把参数去掉会让老代码里的 `nack(false)`
   *   （= 丢弃）静默变成「退回队列」——从丢弃变成无限重投，这是语义漂移而不是编译错误。
   *   它会在 2.0 与拆包同时删除。
   *
   * @param requeue `true` = 放回队列（还会再交给我一次）；`false`（默认）= 结束它，
   *   **不会再交给我**，由 provider 按自己协议的规矩善后（死信 / bounce / 打标记…
   *   没实现就等同于丢弃，**不要指望 `nack(false)` 自带 DLQ**）。
   * @returns 语义同 {@link Ackable.ack}：这次处置有没有生效。
   */
  nack(requeue?: boolean): Promise<boolean | void>;
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
   * provider 的扩展键里可见（`mem:` 是 `status()['mem.overdueInFlightCount']`）。
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
   * 取信才扫），所以光看它不够：过期未收回的那部分在 provider 的扩展键里
   * （`mem:` 是 `['mem.overdueInFlightCount']`），或直接用 `Mailbox#recover()` 收回。
   */
  inFlightCount?: number;
  /**
   * 最后一次有消息活动（发送或接收）的时间 (ISO 8601 格式)；没有活动记录时为 `null`。
   *
   * 必须是 `null` 而不是 `undefined`：`undefined` 会在 `JSON.stringify` 后整个字段消失，
   * 诊断页拿到的是 `undefined` 而不是「没有活动」。
   */
  lastActivityTime?: string | null;

  /**
   * 扩展位：provider 自己的观测量放这里（`v1.0.0` 就留好的口子）。
   *
   * **入选判据（D7）**：只有「核心操作本身能产生的观测量」才进上面的具名字段——
   * `state` / `exists` / `unreadCount` / `inFlightCount` / `lastActivityTime`。
   * 停放区、租约过期积压、死信计数这些属于某个投递策略的账，一律走这里的扩展键，
   * 并且**用 `<scheme>.<名字>` 前缀**，免得两个 provider 往同一个键上写不同的东西：
   *
   * - `mem.parkedCount` / `mem.oldestParkedMs`：判死但先不丢的那些（死信链封顶是典型来源），
   *   不在 `unreadCount` 里、也不会被 `fetch` 交出来，只能查 `MemoryProvider#peekParked()`；
   * - `mem.overdueInFlightCount` / `mem.oldestOverdueMs`：`inFlightCount` 里租约已到期、还没被
   *   收回的份数与最老时长（回收是惰性的，靠下一次取信或 `recover()` 才扫）。告警该盯它，
   *   而不是 `inFlightCount`（健康的在飞也是非零的）；
   * - `mem.subscriberCount`：这条地址上挂着几个订阅者。
   *
   * 要不要填由 provider 的能力决定（见 `Capability.Parked` 之类）；内核不解释这些键的内容，
   * 只原样带出去。
   */
  [key: string]: any;
}

/**
 * 一个 scheme 的地址语法声明（D5）。
 *
 * 「`mem:` 与 `mem://` 是不是同一个信箱」「query 算不算寻址」「authority 有没有意义」——
 * 这些是**某个 scheme 的知识**，不是 URL 的通用规则，也不该由内核统一强加：内核一旦折叠字段
 * 或禁止 query，就等于把某一个 scheme 的折叠规则冒充成所有人的规则（`canonicalId` 曾干过这事）。
 *
 * 所以内核**不解析地址内部**：地址是一个不透明 URL，能不能等价、哪里非法，由该 scheme 的
 * provider 声明（这里）并在自己的每个入口执行。内核只保证**一致性**：同一个地址串在
 * `post` / `subscribe` / `fetch` / `status` / `recover` 每个入口都按同一方式解析、交给同一个
 * provider——不会出现「只在一个入口合法」。
 *
 * 这份声明不是用来改变内核行为的（内核不看它），而是让**调用方与诊断面能问到**：运维不必读
 * provider 源码就知道 `mem:` 会拒绝 query。声明与行为是否一致由 conformance 用例锁
 * （见 `wiki/paper/conformance/cases/address.json`）。
 */
export interface MailboxAddressGrammar {
  /** 这个语法属于哪个 scheme（`mem:` / `amqp:` / `input:`…）。 */
  scheme: string;
  /** `//host` 那一段在这个 scheme 里有没有意义。 */
  authority: 'required' | 'optional' | 'forbidden';
  /** 信箱身份在哪一段，一句人话（诊断页直接读）。 */
  identity: string;
  /** query 参与不参与寻址；`rejected` = 带 query 的地址在该 scheme 的入口直接报错（不静默合并）。 */
  query: 'addressing' | 'ignored' | 'rejected';
  /** fragment 同上。 */
  fragment: 'addressing' | 'ignored' | 'rejected';
  /**
   * 这个 scheme 认为「同一个信箱」的等价写法（由 provider 实现，并保证所有入口一致）。
   * 例：`mem:` 声明 `mem:a@h/i` ≡ `mem://a@h/i`——多写的 `//` 是容错写法，不是另一个信箱。
   */
  equivalences: string[];
}

/**
 * 快照里一个地址的状态：{@link MailboxStatus} 加地址身份。
 */
export interface MailboxAddressSnapshot extends MailboxStatus {
  /**
   * 这个地址，形式由处理它的 provider 给出（`listAddresses()` 返回什么就是什么）。
   *
   * 内核不折叠、不规范化它（D5）：`mem:` 会返回自己那套等价形式里的一个写法，别的 scheme 返回
   * 自己的。它可以原样喂回同一个 provider（`fetch` / `status` / `recover`），这是
   * {@link IMailboxProvider.listAddresses} 要求的**唯一**契约。
   */
  address: string;
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
  /** 不带地址调用时：每个地址收回了几份（key = provider 自己列出的地址串）。 */
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
  /**
   * 按 `address` 排序的地址状态，保证快照可重复、断言可写死。
   *
   * 排序键是 provider 给出的地址串本身，不做规范化（D5）：内核不知道 `mem:` 与 `mem://` 等价，
   * 也不该知道。策略专属的聚合（停放份数、过期租约积压）不在这里求和——内核不认识那些键，
   * 要按 scheme 聚合就自己遍历 `addresses` 上的 `mem.*` 之类扩展键。
   */
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
   *
   * **返回 Promise：`await` 完成才是「订阅可收投递」的时刻。** 与 Python `Mailbox.subscribe`
   * / Rust `Mailbox::subscribe` 同形。「这条订阅已生效」是**每订阅**粒度的事实，而且只有管着这个
   * scheme 的 provider 答得上：进程内总线是登记完成那一刻；接了真实对端的，是它能按自己协议的
   * 规矩确认的那一刻——**协议不给确认时，由 provider 决定怎么如实答，内核不替它编一个**。
   * 正因为内核不知道也不该猜，它只能等 provider 回答——这件事因此挂在每个订阅上，
   * 收不进 provider 级的 `init()`：那里只答得出「这个 provider 起来了」，答不出
   * 「这条订阅现在能收投递」。
   * **不 await 等于未订阅**：回调可能根本没注册，错误也只会变成没人接的 rejection。
   *
   * 错误时机（两边都是刻意的，不要抹平）：
   * - 同步就能发现的错（地址语法、scheme 未注册、provider 的 `_subscribe` 直接 `throw`）
   *   **照旧同步 throw**，与 `post()` / `fetch()` 一致（I-4：同一个地址不能只在一个入口合法）；
   * - provider 回话拒绝（`_subscribe` reject）才是 rejection，与 `send()` 对称。
   *
   * 实现提示：继承 {@link MailboxProvider} 时，`_subscribe` **不要求 async**（v1 的同步钩子不改
   * 也能跑），但基类会等它。直接实现本接口的 provider 请自己保证：`await subscribe()` 返回后
   * 投递就能开始，而且订阅在 await 窗口里被退订时不要把 `undefined` 当句柄拆。
   *
   * **关闭与建立交错时这条作废**（已判的语义，见 `wiki/delivery-semantics.md` §1）：登记必须在
   * `await` **之前**落表，否则 `close()` / `stop()` 在窗口里看不见它、没人负责拆；handle 迟到时
   * 必须在 provider 答话那一刻补拆，句柄报 `closed` 而不是抛异常；`close()` 必须**有界**，
   * 不等一个永不落地的 `_subscribe`。
   */
  subscribe(address: URL, onReceive: (message: MailMessage) => void | Promise<void>): Promise<Subscription>;

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
   * [Optional] 把该地址上**租约已到期**的在飞消息收回队列，返回收回了几份（幂等）。
   *
   * 有“租约”这个概念的 provider（队列型 / 拉取型）实现它，`Mailbox#recover()` 就能把僵死消费者
   * 手里的过期租约收回来。没实现（推送型，或可见性超时在 broker 侧的 AMQP / SQS）会被
   * `recover()` 报成 `supported: false` —— **不能当作“一切正常”**。
   */
  recoverLeases?(address: URL): Promise<number>;

  /**
   * [Optional] 这个 scheme 的地址语法（见 {@link MailboxAddressGrammar}）。
   *
   * 内核不用它做任何判定（地址对内核是不透明的），但它是**能问到的东西**：诊断面、上层路由、
   * 以及「我能不能往这个 scheme 写 query」的调用方都需要它。实现了地址能力
   * （`listAddresses` / 自定义 scheme）的 provider 应当声明。
   */
  readonly addressGrammar?: MailboxAddressGrammar;

  /**
   * [Optional] 列出本 provider 当前认得的地址。
   *
   * **唯一要求**：列出的每个串都能原样喂回**同一个 provider**（`status` / `fetch` /
   * `recoverLeases`）。形式由该 scheme 决定——内核不解析、不折叠、不排序规则（D5），
   * `snapshot()` 只是把它们再查询一遍并按串排序以保证可重复。
   *
   * 可选能力：只有消息确实存在本地的 provider（如 `MemoryProvider`）能实现。
   * 没实现就不实现——{@link MailboxSnapshot} 会把这类 provider 归入
   * {@link MailboxSnapshot.unsupportedProviders}，不会把「枚举不了」当成「队列为空」。
   */
  listAddresses?(): Promise<string[]>;

  /**
   * 创建一个唯一标识符。主要是用于生成邮件的 ID。
   */
  generateId(): string;
}
