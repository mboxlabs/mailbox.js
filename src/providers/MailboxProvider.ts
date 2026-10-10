import { nanoid } from '@isdk/hash';
import {
  IMailboxProvider,
  MailMessage,
  Subscription,
  AckableMailMessage,
  MailboxStatus,
} from '../interfaces';
import {
  RetryPolicy,
  AttemptLedger,
  isRetriableError,
  nextRetryDelay,
  resolveRetryPolicy,
} from '../lib/retry';

/**
 * Represents a subscription record managed internally by the MailboxProvider.
 * It holds the necessary data to manage the subscription's lifecycle.
 */
interface ManagedSubscription {
  id: string;
  address: URL;
  wrappedOnReceive: (message: MailMessage) => void | Promise<void>;
  // Holds the underlying handle returned by the concrete provider's _subscribe method,
  // which is needed for unsubscribing.
  unsubscribeHandle?: any;
}

type PendingRetryTimer = ReturnType<typeof setTimeout>;

export abstract class MailboxProvider implements IMailboxProvider {
  public readonly protocol: string;
  protected readonly subscriptions: Map<string, ManagedSubscription> = new Map();

  /**
   * 订阅失败后的重试策略。`null` 表示不重试（默认）：可重试失败只把消息退回队列，
   * 由 `fetch()` 兜底。重试是 opt-in 的，因为 AMQP / SQS 这类传输自带重投与死信，
   * 库再重投就是双重投递。
   */
  protected retry: Required<RetryPolicy> | null = null;

  /** 按「订阅者 + 消息」记账尝试次数；订阅是广播，不能混在一起算。 */
  private readonly attempts = new AttemptLedger();
  private readonly pendingRetries: Map<string, Map<PendingRetryTimer, MailMessage>> = new Map();

  constructor(protocol: string, retry?: RetryPolicy | null) {
    if (!protocol) {
      throw new Error('Provider protocol cannot be empty.');
    }
    this.protocol = protocol;
    this.retry = resolveRetryPolicy(retry);
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
   */
  public async close(): Promise<void> {
    // 1. 自动清理所有活跃订阅
    const subscriptions = Array.from(this.subscriptions.values());
    if (subscriptions.length > 0) {
      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            await this._unsubscribe(sub.id, sub.unsubscribeHandle);
          } catch (e) {
            console.error(`[${this.protocol}] Error unsubscribing ${sub.id} during close:`, e);
          }
        })
      );
      this.subscriptions.clear();
    }

    // 关闭时取消所有待重投：进程都在收尾，不再把消息重新喂回回调。
    for (const subId of Array.from(this.pendingRetries.keys())) {
      this._cancelPendingRetries(subId);
    }
    this.attempts.clear();

    // 2. 调用具体的清理逻辑
    await this._close?.();
  }

  /**
   * Sends a mail message.
   * This method handles common logic (like adding a timestamp and injecting x-req-sent-at for replies)
   * and then calls the concrete `_send` method for protocol-specific delivery.
   */
  public async send(message: MailMessage) {
    const messageToSend: MailMessage = {
      ...message,
      headers: {
        ...message.headers,
        'mbx-sent-at': new Date().toISOString(), // Always inject mbx-sent-at for outgoing messages
      },
    };

    await this._send(messageToSend);
    return messageToSend;
  }

  /**
   * Subscribes to an address.
   * This method manages the creation and lifecycle of the subscription object,
   * including wrapping the callback for implicit ACK and centralized error handling.
   */
  public subscribe(
    address: URL,
    onReceive: (message: MailMessage) => void | Promise<void>
  ): Subscription {
    const subId = this.generateId();

    // Wrap the onReceive callback to implement implicit ACK and unified error handling.
    const wrappedOnReceive = async (message: MailMessage): Promise<void> => {
      try {
        await onReceive(message);
        // On successful execution, implicitly acknowledge the message.
        await this.ack(message);
        this.attempts.reset(subId, message.id);
      } catch (error) {
        // Handle the error according to the defined strategy.
        this._handleReceiveError(error, message, this.subscriptions.get(subId));
      }
    };

    const managedSub: ManagedSubscription = {
      id: subId,
      address,
      wrappedOnReceive,
    };

    // Call the concrete provider's implementation to start listening.
    managedSub.unsubscribeHandle = this._subscribe(address, wrappedOnReceive);
    this.subscriptions.set(subId, managedSub);

    // Return a standard Subscription object to the caller.
    return this._createSubscriptionObject(subId, address);
  }

  /**
   * Fetches a message.
   * Delegates directly to the concrete provider's implementation.
   */
  public async fetch(address: URL, options: { manualAck: true }): Promise<AckableMailMessage | null>;
  public async fetch(address: URL, options?: { manualAck?: false }): Promise<MailMessage | null>;
  public async fetch(
    address: URL,
    options?: { manualAck?: boolean }
  ): Promise<MailMessage | AckableMailMessage | null> {
    const message = await this._fetch(address, options);
    return message;
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

  protected async ack(message: MailMessage) {
    this._ack?.(message);
  }

  protected async nack(message: MailMessage, requeue: boolean) {
    this._nack?.(message, requeue);
  }

  // --- Protected Abstract Methods (to be implemented by subclasses) ---

  /**
   * [Subclass Responsibility] Performs the actual sending logic.
   */
  protected abstract _send(message: MailMessage): Promise<void>;

  /**
   * [Subclass Responsibility] Performs the actual subscription logic.
   * @returns A handle that can be used later to unsubscribe (e.g., a listener function, a subscription ID).
   */
  protected abstract _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => Promise<void>
  ): any;

  /**
   * [Subclass Responsibility] Performs the actual un-subscription logic.
   */
  protected abstract _unsubscribe(subscriptionId: string, unsubscribeHandle: any): Promise<void>;

  /**
   * [Subclass Responsibility] Performs the actual message fetching logic.
   */
  protected abstract _fetch(
    address: URL,
    options?: { manualAck?: boolean }
  ): Promise<MailMessage | AckableMailMessage | null>;

  /**
   * [Subclass Responsibility - Optional] Specific closing logic.
   */
  protected async _close?(): Promise<void>;

  /**
   * [Subclass Responsibility - Optional] Provides implicit ACK capability for the `subscribe` mode.
   * For providers that don't support ACK (like in-memory), this can be an empty async function.
   */
  protected _ack?(message: MailMessage): Promise<void>;

  /**
   * [Subclass Responsibility - Optional] Provides NACK capability.
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
          provider._cancelPendingRetries(subId);
          await provider._unsubscribe(sub.id, sub.unsubscribeHandle);
          provider.subscriptions.delete(subId);
        }
      },
    };
  }

  /**
   * 订阅回调抛错时的统一处理。
   *
   * 默认（`retry === null`）：可重试 → `nack(requeue=true)` 退回队列；不可重试 → 丢弃。
   * 开启重试后：可重试且未超上限 → 只重投给失败的那个订阅者（不广播给其他已成功的订阅者，
   * 否则它们的副作用会被执行两次）；超上限 → 清零台账、调 `_onRetryExhausted`，再退回队列
   * 交给 `fetch()` 兜底。
   */
  protected _handleReceiveError(error: any, message: MailMessage, sub?: ManagedSubscription): void {
    console.error(`[${this.protocol}] Error processing message ${message.id}:`, error);

    const isRetriable = this._isRetriable(error);

    if (isRetriable && this.retry && sub) {
      const attempt = this.attempts.record(sub.id, message.id);

      if (attempt < this.retry.maxAttempts && this.subscriptions.has(sub.id)) {
        const delay = nextRetryDelay(this.retry, attempt);
        const timer = setTimeout(() => {
          const pending = this.pendingRetries.get(sub.id);
          if (pending) {
            pending.delete(timer);
          }
          if (!this.subscriptions.has(sub.id)) {
            // 等待期间退订了：不重投给已消失的订阅者，退回队列而不是静默丢掉。
            this.nack(message, true).catch(() => undefined);
            return;
          }
          void sub.wrappedOnReceive(message);
        }, delay);
        // 不要因为一个待重投就把 Node 事件循环撑住。
        (timer as unknown as { unref?: () => void }).unref?.();
        if (!this.pendingRetries.has(sub.id)) {
          this.pendingRetries.set(sub.id, new Map());
        }
        this.pendingRetries.get(sub.id)!.set(timer, message);
        return;
      }

      if (attempt >= this.retry.maxAttempts) {
        this.attempts.reset(sub.id, message.id);
        this._onRetryExhausted?.(message, attempt);
      }
    }

    // Crucial: NACK the message first to prevent reprocessing, then handle other tasks.
    this.nack(message, isRetriable)
      .catch(nackError => {
        console.error(`[${this.protocol}] CRITICAL: Failed to NACK message ${message.id}. Risk of message duplication.`, nackError);
      });
  }

  /**
   * [Subclass Responsibility - Optional] 重试次数耗尽时的钩子（例如写死信队列 / 告警）。
   * 调用后消息仍会退回队列，由 `fetch()` 兜底。
   */
  protected _onRetryExhausted?(message: MailMessage, attempts: number): void;

  /**
   * 取消某个订阅者的待重投。
   *
   * 取消定时器不等于消息可以消失：每一条被取消的重投都退回队列，由 `fetch()` 兜底。
   */
  private _cancelPendingRetries(subscriptionId: string): void {
    const pending = this.pendingRetries.get(subscriptionId);
    if (!pending) {
      return;
    }
    for (const [timer, message] of pending) {
      clearTimeout(timer);
      this.nack(message, true).catch(() => undefined);
    }
    this.pendingRetries.delete(subscriptionId);
  }

  protected _isRetriable(error: any): boolean {
    return isRetriableError(error);
  }
}
