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
 */
export function describeDeliveryError(error: unknown): string {
  let text: string;
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    text = `${error.name}: ${error.message}`;
    if (code !== undefined) {
      text += ` (code=${String(code)})`;
    }
  } else if (typeof error === 'string') {
    text = error;
  } else if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown };
    text = String(candidate.message ?? JSON.stringify(error));
    if (candidate.code !== undefined) {
      text += ` (code=${String(candidate.code)})`;
    }
  } else {
    text = String(error);
  }

  return text.length > MAX_DELIVERY_ERROR_LENGTH
    ? `${text.slice(0, MAX_DELIVERY_ERROR_LENGTH - 1)}\u2026`
    : text;
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
