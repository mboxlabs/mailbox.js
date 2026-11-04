/**
 * 投递（delivery）身份的共享记账工具。issue#2 的修复核心。
 *
 * `subscribe` 是广播：一条消息 = N 次投递。失败处理若只有「消息」身份（`nack(message)`），
 * 部分失败时就会把已成功者处理过的整条消息退回队列 —— 消息级和投递级两层语义不一致。
 *
 * 这里定义投递级的结算结果，以及「广播结算后要不要回队」的唯一判定。
 * 三端（TS / Python / Rust）保持同一语义。
 */

/**
 * 单次投递**尝试**的默认结算超时（毫秒）。`0` 关闭。
 *
 * 卡死的订阅回调会让广播的结算 barrier 永不落定：消息既不回队也不死信，`unreadCount`
 * 里也看不见（等于静默消失）。看门狗给「一次尝试」一个上界：超时后按取消结算，消息回到
 * 兜底路径。它只给单次尝试计时，所以不会掐断健康的重试链或退避等待。
 */
export const DEFAULT_DELIVERY_SETTLE_TIMEOUT = 30_000;

/**
 * 一次投递的最终结算结果。
 *
 * 一次投递 = 某个订阅者对某条消息的一次完整处理，**包含整条重试链**：
 * 只有当回调成功、或彻底失败（预算耗尽 / 不可重试 / 被取消）时才结算。
 * 广播的发送侧据此判断「有没有订阅者成功」。
 */
export interface DeliveryResult {
  /** 投递身份：`subscriptionId + messageId`，与 `AttemptLedger` 同一粒度。 */
  readonly deliveryId: string;
  readonly subscriptionId: string;
  readonly messageId: string;
  /** true = 回调成功结算；false = 这次投递最终失败。 */
  readonly ok: boolean;
  /**
   * 失败分类（`ok === false` 时才有意义）：
   * - `retriable`：可重试错误，但重试预算已用尽 —— 值得让 `fetch()` 兜底。
   * - `fatal`：不可重试 —— 按死信处理，不回队（避免无限重试同一条坏消息）。
   * - `cancelled`：待重投被取消（退订 / 关闭）—— 等同 `retriable` 兜底。
   */
  readonly reason?: 'retriable' | 'fatal' | 'cancelled';
  /**
   * 这条投递一共跑过几次尝试（含首次；未开启重试时是 1）。
   *
   * 为什么内核要报这个数：「重投几次」归 provider，但死信记录要写「试了几次」。
   * 内核不报，provider 就只能自己再记一遍账（且与内核的 `AttemptLedger` 对不上）。
   */
  readonly attempts?: number;
  /**
   * 失败原因摘要（`Name: message`，必要时带 `code=`），截断到 {@link MAX_DELIVERY_ERROR_LENGTH}。
   *
   * 死信钩子只拿到 `reason` 分类是写不出可用记录的：运维要看的是「为什么」。
   * 这里只放摘要文本，不放 Error 对象 —— 钩子可能被同步调用，也可能被序列化到日志 / DLQ。
   */
  readonly error?: string;
}

/** 死信记录里失败原因摘要的最大长度（跨三端一致，防止超长 body 把日志 / DLQ 撑爆）。 */
export const MAX_DELIVERY_ERROR_LENGTH = 300;

/**
 * 把任意抛出的值归一成一句可落库的摘要：`Error: bad payload`、`Error: flaky (code=503)`。
 *
 * 非 Error（字符串 / `{ code }` 字面量）也要留下可读的信息，不能变成 `undefined`。
 *
 * **必须是全函数（绝不抛）**。它跑在结算路径上（`_settleDelivery` / `toDeliveryResults`），
 * 而 `_settleDelivery` 是「先摘 `pendingDeliveries` → 构造 result → `settle()`」：抛在这里 =
 * 结算被半途取消 —— `settle()` 不发 → barrier 的 `allSettled` 永挂 → `nack(requeue)`、死信钩子、
 * 缺 barrier 兜底全部不执行（消息静默丢失）；抛在重试 / 看门狗的 `setTimeout` 里就是
 * uncaughtException（进程挂）。以前 `JSON.stringify(error)` 正是这个炸点：循环引用 / BigInt /
 * 抛错的 `toJSON` / Proxy trap 都会让摘要函数自己抛。三端（TS / Python / Rust）同一约定。
 */
export function describeDeliveryError(error: unknown): string {
  let text: string;
  try {
    text = summarizeThrown(error);
  } catch {
    // 兜底也必须不抛：到这一步意味着上面某个属性访问自己弄坏了（Proxy trap / getter 抛错）。
    text = UNSUMMARIZABLE;
  }

  return text.length > MAX_DELIVERY_ERROR_LENGTH
    ? `${text.slice(0, MAX_DELIVERY_ERROR_LENGTH - 1)}\u2026`
    : text;
}

/** 循环引用的占位标记（跨端一致：Python / Rust 移植时也写 `[Circular]`）。 */
const CIRCULAR_MARKER = '[Circular]';

/** 什么都读不出时的占位摘要（不能是空串：死信记录里的 `error` 靠它存在与否）。 */
const UNSUMMARIZABLE = '[unsummarizable error]';

/** 读一个属性，getter / Proxy trap 抛错就当没有（摘要函数不能因为探看而抛）。 */
function readField(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** `String(x)` 也能为自定义 `toString` 抛错。 */
function safeText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    const text = String(value);
    return text === '' ? fallback : text;
  } catch {
    return fallback;
  }
}

/**
 * 永不抛的 `JSON.stringify`：
 * - 循环引用 → `[Circular]`（而不是 TypeError）；
 * - BigInt → `123n`；函数 → `[Function name]`；
 * - `toJSON` / trap 抛错 → 占位串。
 */
function safeStringify(value: object): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, entry) => {
      if (typeof entry === 'bigint') {
        return `${entry}n`;
      }
      if (typeof entry === 'function') {
        return `[Function${entry.name ? ` ${entry.name}` : ''}]`;
      }
      if (typeof entry === 'symbol') {
        return entry.toString();
      }
      if (entry && typeof entry === 'object') {
        if (seen.has(entry)) {
          return CIRCULAR_MARKER;
        }
        seen.add(entry);
      }
      return entry;
    });
    // `toJSON()` 返回 undefined 时 JSON.stringify 给的是 undefined。
    return typeof json === 'string' ? json : UNSUMMARIZABLE;
  } catch {
    return UNSUMMARIZABLE;
  }
}

/** 分类与拼接；任何一步抛错都由 `describeDeliveryError` 的 catch 兜住。 */
function summarizeThrown(error: unknown): string {
  if (error instanceof Error) {
    const name = safeText(readField(error, 'name'), 'Error');
    const message = safeText(readField(error, 'message'));
    let text = message ? `${name}: ${message}` : name;
    const code = readField(error, 'code');
    if (code !== undefined) {
      text += ` (code=${safeText(code, UNSUMMARIZABLE)})`;
    }
    return text;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const message = readField(error, 'message');
    const messageText = message === undefined || message === null ? '' : safeText(message);
    // `message` 缺失或空串 → 用结构摘要，而不是把死信记录里留一个空 `error`。
    let text = messageText || safeStringify(error);
    const code = readField(error, 'code');
    if (code !== undefined) {
      text += ` (code=${safeText(code, UNSUMMARIZABLE)})`;
    }
    return text;
  }
  return safeText(error, UNSUMMARIZABLE);
}

/**
 * 投递尝试次数的 header 名（控制平面）。
 *
 * 「重投几次」由 provider 决定，但每次投递得知道自己第几次来：真实 broker 的
 * `_nack(false)` 落 DLQ、日志、幂等判断都要用。放在 headers（控制平面）而不是 meta
 * （数据平面，业务字段，内核不写）。
 *
 * **作用域要看清：它是「本轮投递链内」的趟数（基类在交给回调前注入到副本上），不是重投计数。**
 * 重试链内 1→2→3；消息回队、下一轮投递又从 1 开始数。拿它当上限，每一轮都只数到
 * `maxAttempts` 就停在那里，上限永远不会触发——跨轮累积的值在 {@link MBX_ROUND_HEADER}。
 */
export const MBX_ATTEMPT_HEADER = 'mbx-attempt';

/** 本次投递的重试上限（仅在 provider 开启了重试策略时注入）。 */
export const MBX_MAX_ATTEMPTS_HEADER = 'mbx-max-attempts';

/**
 * 投递**轮次**的 header 名（控制平面）：这条消息是第几轮被交到消费者手里（1 起算，字符串）。
 *
 * 为什么必须有它：内核把「重投几次 / 上限在哪」划给 provider，就得给 provider 可数的东西。
 * `mbx-attempt` 只数单条链内的趟数，跨回队就归零；轮次则随消息走（回队交回的就是那份打戳
 * 副本），所以：
 * - `fetch()` 兜底消费者能看出「这条已经被投递过 N 轮」；
 * - provider 想在队列侧做 SQS 式 `maxReceiveCount`（内核自己不做终态，见 conformance 的
 *   `attempt-cap-terminal`）读它就能封顶。
 *
 * 递增规则只有一条：**谁把消息交给消费者，谁 +1**（基类在开始一次订阅投递时 +1；队列在把
 * 消息交给 `fetch()` 消费者时 +1）。回队不 +1，只读快照更不 +1——`peek()` 是看一眼，不是交出去。
 * 内核只会把它往上加，绝不把消息上已有的值改回小值：provider / broker 自己带回来的计数不会被
 * 内核抹掉。
 */
export const MBX_ROUND_HEADER = 'mbx-round';

/**
 * 「这一份信」的编号（控制平面）：每次 `post()` 一个，由系统发，随副本一路带着走。
 *
 * 为什么要它：`id` 是**发送方**给的名字（`OutgoingMail.id` 还建议用内容 hash），名字可以重复——
 * 同一封信发两次、两个发送方撞名、恶意发送方故意撞名，都合法。队列要是拿 `id` 当记账的键，
 * 就会把两份不同的信当成一份：回队被当成重复吞掉、在飞槽位被顶替、按 id 的结算落到别人手里那份上。
 * 所以记账必须按「哪一份」，不能按「叫什么」。
 *
 * 它必须放在 headers 里而不是只在内存里记：投递副本是被一路 `{...message}` 拷出来的，
 * 只有头能穿过每一次拷贝活下来（对象身份活不下来）。
 *
 * **发送方塞的值一律不采信**（见 {@link stripSenderForgedSystemHeaders}）：否则一个伪造的编号
 * 就能让两份信在队列里被当成一份。
 */
export const MBX_SEND_ID_HEADER = 'mbx-send-id';

/**
 * 发送方**不许**自带的系统头（控制平面里由内核 / provider 发的那些）。
 *
 * 采信它们会带来两类事故：
 * - 伪造计数：`mbx-round: 9999` 会被内核当真实累积值继续 +1，任何按轮次封顶的 provider
 *   （SQS 式 `maxReceiveCount`）都会把这条当场判死 —— 发送方自己选了「立刻被丢弃」。
 * - 伪造痕迹：`mbx-dead-letter*` 贴在活消息上，会污染死信排空 worker 的过滤条件。
 *
 * 不在名单里的 `mbx-reply-to` 是发送方自己的字段（回信地址），必须保留。
 */
const SENDER_FORGED_SYSTEM_HEADERS = new Set<string>([
  MBX_ATTEMPT_HEADER,
  MBX_MAX_ATTEMPTS_HEADER,
  MBX_ROUND_HEADER,
  MBX_SEND_ID_HEADER,
  'mbx-sent-at', // `MailboxProvider.send()` 每次都会重新注入，采信只会让审计时间可被伪造
])

/** 死信链的痕迹头：`mbx-dead-letter` / `mbx-dead-letter-depth` / `mbx-dead-letter-reason` … */
const DEAD_LETTER_HEADER_PREFIX = 'mbx-dead-letter'

/** 这个头是不是系统发的、发送方不该自带的。 */
export function isSystemOwnedHeader(name: string): boolean {
  return SENDER_FORGED_SYSTEM_HEADERS.has(name) || name.startsWith(DEAD_LETTER_HEADER_PREFIX)
}

/**
 * 剥掉发送方自带的系统头（返回新对象，不改调用方那份）。
 *
 * 只在**发送边界**用一次（`Mailbox.post()`）：内核自己后面注入的那些不受影响。
 */
export function stripSenderForgedSystemHeaders(
  headers: Record<string, any> | undefined,
): Record<string, any> {
  if (!headers) {
    return {}
  }
  const kept: Record<string, any> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!isSystemOwnedHeader(name)) {
      kept[name] = value
    }
  }
  return kept
}

/** 读「这一份信」的编号；没有就是 undefined（队列会退回按对象身份认这份）。 */
export function readSendId(message?: unknown): string | undefined {
  const headers = (message as { headers?: Record<string, any> } | null | undefined)?.headers
  const raw = headers?.[MBX_SEND_ID_HEADER]
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** 读消息上的投递轮次；没有（或不是正数）就是 0 = 还没被交到消费者手里过。 */
export function readRound(message?: { headers?: Record<string, any> } | null): number {
  const parsed = Number(message?.headers?.[MBX_ROUND_HEADER]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** 写上游次（不改动原对象）；`round <= 0` 时原样返回（= 不注入）。 */
export function withRound<T extends { headers?: Record<string, any> }>(message: T, round: number): T {
  if (!Number.isFinite(round) || round <= 0) {
    return message;
  }
  return { ...message, headers: { ...(message.headers ?? {}), [MBX_ROUND_HEADER]: String(round) } };
}

/**
 * 把消息交给下一个消费者：返回 `mbx-round = 旧值 + 1` 的**副本**。
 * 拉取侧（provider 自己的队列）用它，就与基类在订阅侧的 +1 同一套语义、不会重复计数。
 */
export function nextRoundCopy<T extends { headers?: Record<string, any> }>(message: T): T {
  return withRound(message, readRound(message) + 1);
}

/**
 * 给投递副本打上尝试次数（不改动原对象）。
 *
 * **必须返回副本**：广播里同一条消息会被投给 N 个订阅者，只有失败的那个在重投。
 * 直接改共享对象就会把 A 的尝试次数串给 B（B 明明只被投递过一次）。
 * 只拷信封（浅拷贝）：body / meta 引用保持不变，别在投递热路径上做深拷贝。
 *
 * @param attempt 本轮链内的第几趟（{@link MBX_ATTEMPT_HEADER}）。
 * @param maxAttempts 本轮链的上限；省略 = 不注入 `mbx-max-attempts`（未开重试策略）。
 * @param round 本轮投递轮次（{@link MBX_ROUND_HEADER}）；省略 = 不改写已有的轮次头。
 */
export function withAttemptHeaders<T extends { headers?: Record<string, any> }>(
  message: T,
  attempt: number,
  maxAttempts?: number,
  round?: number,
): T {
  const headers = {
    ...(message.headers ?? {}),
    [MBX_ATTEMPT_HEADER]: String(attempt),
    ...(maxAttempts === undefined ? {} : { [MBX_MAX_ATTEMPTS_HEADER]: String(maxAttempts) }),
    ...(round === undefined ? {} : { [MBX_ROUND_HEADER]: String(round) }),
  };
  return { ...message, headers };
}

/** 投递身份。分隔符用 `\u0000`，避免 id 拼接歧义。 */
export function deliveryKey(subscriptionId: string, messageId: string): string {
  return `${subscriptionId}\u0000${messageId}`;
}

/** 从投递身份里取出 subscriptionId。 */
export function subscriptionIdOfDelivery(deliveryId: string): string {
  return deliveryId.slice(0, deliveryId.indexOf('\u0000'));
}

/** 从投递身份里取出 messageId。 */
export function messageIdOfDelivery(deliveryId: string): string {
  return deliveryId.slice(deliveryId.indexOf('\u0000') + 1);
}

export function isDeliveryResult(value: unknown): value is DeliveryResult {
  return (
    !!value
    && typeof value === 'object'
    && typeof (value as DeliveryResult).ok === 'boolean'
  );
}

/**
 * 把广播监听器的结算值归一化成 `DeliveryResult`。
 *
 * 走 `MailboxProvider` 的订阅回调一定返回 `DeliveryResult`；第三方 provider 直接注册的
 * 监听器可能返回任意值 —— fulfilled 视作成功，rejected 视作可重试失败（宁可多兜一次，
 * `requeue()` 的去重守卫会挡住重复）。
 */
export function toDeliveryResults(
  settled: readonly PromiseSettledResult<unknown>[],
): DeliveryResult[] {
  return settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      if (isDeliveryResult(result.value)) {
        return result.value;
      }
      return { deliveryId: `listener\u0000${index}`, subscriptionId: '', messageId: '', ok: true };
    }
    return {
      deliveryId: `listener\u0000${index}`,
      subscriptionId: '',
      messageId: '',
      ok: false,
      reason: 'retriable' as const,
      attempts: 1,
      error: describeDeliveryError((result as PromiseRejectedResult).reason),
    };
  });
}

/**
 * 广播结算后，是否把整条消息退回队列。
 *
 * 判定只看投递，不看「这个 topic 还有没有活跃订阅者」——后者会把全部订阅者都失败的情况
 * 变成静默丢失（issue#1 刚补上的兜底保证）。正确条件：
 *
 * 1. **没有任何投递成功** —— 有成功者时整条回队就是跨投递模式重复投递；
 * 2. **至少一次投递值得重试**（`retriable` / `cancelled`）—— 全是 `fatal` 就按死信丢弃。
 *
 * @param results 同一消息在广播里全部投递的结算结果。
 */
export function shouldRequeueAfterBroadcast(results: readonly DeliveryResult[]): boolean {
  if (results.length === 0) {
    return false;
  }
  if (results.some((result) => result.ok)) {
    return false; // 已有订阅者处理过，回队 = 副作用再执行一次
  }
  return results.some((result) => result.reason !== 'fatal');
}
