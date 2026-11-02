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
