/**
 * 订阅重试的共享策略与记账工具。
 *
 * 这里只放「策略数学」——纯函数、可单测、可被其他包（如 tool-rpc 的 mailbox 传输）复用；
 * 拦截订阅失败的位置仍在 `MailboxProvider` 基类，因为那是唯一能看到回调抛错的地方。
 *
 * 三端（TS / Python / Rust）保持同一套语义：`isRetriableError` 的判定条件、退避公式、
 * 尝试计数方式都一致。
 */

/**
 * 订阅失败后的重试策略。
 *
 * 注意：重试是 **opt-in** 的。默认（`null`）保持「失败只回队、不自动重投」的行为，
 * 因为 AMQP / SQS 这类传输层自带重投与死信，库再重投就是双重投递。
 */
export interface RetryPolicy {
  /** 总尝试次数，含首次。必须 >= 1；1 等价于不重试。 */
  maxAttempts: number;
  /** 首次重试前的等待毫秒数。 */
  baseDelay: number;
  /** 退避倍数，默认 2。 */
  factor?: number;
  /** 单次等待上限（毫秒），默认 30_000。 */
  maxDelay?: number;
}

export const DEFAULT_RETRY_POLICY: Required<RetryPolicy> = {
  maxAttempts: 3,
  baseDelay: 1_000,
  factor: 2,
  maxDelay: 30_000,
};

/**
 * 归一化策略；`null` / `undefined` 表示不重试（保持默认行为）。
 */
export function resolveRetryPolicy(
  policy?: RetryPolicy | null
): Required<RetryPolicy> | null {
  if (!policy) {
    return null;
  }
  const resolved = {
    maxAttempts: Math.max(1, Math.floor(policy.maxAttempts)),
    baseDelay: Math.max(0, policy.baseDelay),
    factor: policy.factor ?? DEFAULT_RETRY_POLICY.factor,
    maxDelay: policy.maxDelay ?? DEFAULT_RETRY_POLICY.maxDelay,
  };
  return resolved;
}

/**
 * 判定错误是否可重试。与 Python 的 `_is_retriable` / Rust 的 `MailboxError::is_retriable` 一致：
 * 显式标记 `isRetriable === true`，或 `code` 命中传输层重试白名单。
 */
export function isRetriableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { isRetriable?: unknown; code?: unknown };
  if (candidate.isRetriable === true) {
    return true;
  }
  return candidate.code !== undefined && [503, 504, 'ECONNRESET', 'ETIMEDOUT'].includes(candidate.code as never);
}

/**
 * 第 `attempt` 次尝试失败之后，下一次重试要等多久（毫秒）。
 *
 * `attempt` 是已经发生的尝试次数（首次失败即 1），因此第一次退避就是 `baseDelay`。
 * 指数退避并夹在 `maxDelay` 之内。
 */
export function nextRetryDelay(policy: RetryPolicy, attempt: number): number {
  const resolved = resolveRetryPolicy(policy) ?? DEFAULT_RETRY_POLICY;
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const delay = resolved.baseDelay * Math.pow(resolved.factor, safeAttempt - 1);
  return Math.min(delay, resolved.maxDelay);
}

/**
 * 按「订阅者 + 消息」维度记录已经尝试过几次。
 *
 * 键必须包含订阅者：订阅是广播，某个订阅者失败不代表其他订阅者也失败，重试次数不能混在一起算。
 * 条目带 TTL，避免长期运行的进程里台账无限增长。
 */
export class AttemptLedger {
  private entries: Map<string, { attempts: number; updatedAt: number }> = new Map();

  constructor(private readonly ttlMs: number = 300_000) {}

  private static key(subscriptionId: string, messageId: string): string {
    return `${subscriptionId}\u0000${messageId}`;
  }

  /** 记录一次尝试，返回这是第几次。 */
  record(subscriptionId: string, messageId: string): number {
    this.gc();
    const key = AttemptLedger.key(subscriptionId, messageId);
    const previous = this.entries.get(key)?.attempts ?? 0;
    const attempts = previous + 1;
    this.entries.set(key, { attempts, updatedAt: Date.now() });
    return attempts;
  }

  /** 当前已尝试次数（未记录过则为 0）。 */
  count(subscriptionId: string, messageId: string): number {
    return this.entries.get(AttemptLedger.key(subscriptionId, messageId))?.attempts ?? 0;
  }

  /** 处理成功后清零，让同 id 的消息日后还能重试。 */
  reset(subscriptionId: string, messageId: string): void {
    this.entries.delete(AttemptLedger.key(subscriptionId, messageId));
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.updatedAt > this.ttlMs) {
        this.entries.delete(key);
      }
    }
  }
}
