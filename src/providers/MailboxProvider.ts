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
} from '../interfaces';
import { normalizePeekLimit } from '../lib/utils';
import { UnsupportedCapabilityError, InvalidFetchOptionsError } from '../error';
import {
  RetryPolicy,
  AttemptLedger,
  isRetriableError,
  nextRetryDelay,
  resolveRetryPolicy,
} from '../lib/retry';
import { DeliveryResult, DEFAULT_DELIVERY_SETTLE_TIMEOUT, deliveryKey, shouldRequeueAfterBroadcast, subscriptionIdOfDelivery, toDeliveryResults } from '../lib/delivery';

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
}

type PendingRetryTimer = ReturnType<typeof setTimeout>;

/**
 * 一次尚未结算的投递（某个订阅者对某条消息的处理，可能正卡在重试退避里）。
 * 只有结算之后，广播的发送侧才知道这次投递是成功还是失败（issue#2）。
 */
interface PendingDelivery {
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
}

/** 投递结算原因。`ok` 表示回调成功。 */
type DeliveryOutcome = 'ok' | 'retriable' | 'fatal' | 'cancelled';

export abstract class MailboxProvider implements IMailboxProvider {
  public readonly protocol: string;
  protected readonly subscriptions: Map<string, ManagedSubscription> = new Map();

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
   *
   * 注意：`close()` **不**清消息队列——“关掉通道”不等于“销毁在途数据”。要一并清掉积压消息
   * 用 `Mailbox#stop({ purge: true })` 或 {@link MailboxProvider.clear}。
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

    // 关闭时取消所有「等待重投」的投递：进程都在收尾，不再把消息重新喂回回调。
    // 取消不等于消息可以消失 —— 见 `_cancelPendingDeliveries`。
    // 正在执行的回调不替它下结论（它可能马上就要成功）：由它自己结算，卡死的由看门狗兜。
    for (const key of Array.from(this.pendingDeliveries.keys())) {
      this._cancelPendingDeliveries(subscriptionIdOfDelivery(key));
    }
    this.attempts.clear();

    // 2. 调用具体的清理逻辑
    await this._close?.();
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
   * This method manages the creation of the subscription object, centralizing the
   * implicit ACK and the error / retry handling of every delivery.
   *
   * 注册给具体 provider 的监听器返回一个在**投递最终结算**（含整条重试链）时才 resolve 的
   * `Promise<DeliveryResult>`。广播型 provider 的发送侧靠它做结算判定（issue#2）。
   */
  public subscribe(
    address: URL,
    onReceive: (message: MailMessage) => void | Promise<void>
  ): Subscription {
    const subId = this.generateId();

    const managedSub: ManagedSubscription = {
      id: subId,
      address,
      onReceive,
    };

    // Call the concrete provider's implementation to start listening.
    managedSub.unsubscribeHandle = this._subscribe(address, (message) =>
      this._startDelivery(subId, message)
    );
    this.subscriptions.set(subId, managedSub);

    // Return a standard Subscription object to the caller.
    return this._createSubscriptionObject(subId, address);
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
    if (!this._peek) {
      throw new UnsupportedCapabilityError(
        this.protocol,
        'read-only peek (implement `_peek(address, { limit })` on the provider, or fetch without `peek`)',
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
   * [Subclass Responsibility - Optional] Provides implicit ACK capability for the `subscribe` mode.
   * For providers that don't support ACK (like in-memory), this can be an empty async function.
   */
  protected _ack?(message: MailMessage): Promise<void>;

  /**
   * [Subclass Responsibility - Optional] Provides NACK capability.
   *
   * 广播型 provider 里它只会在**广播全部投递都结算之后**被调用一次（由发送侧的结算判定决定
   * `requeue` 与否），不会再在每个订阅者失败时各回队一次。
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
          provider.subscriptions.delete(subId);
          provider._cancelPendingDeliveries(subId);
          await provider._unsubscribe(sub.id, sub.unsubscribeHandle);
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
    const key = this._reserveDeliveryKey(subscriptionId, message.id);
    let settle!: (result: DeliveryResult) => void;
    const promise = new Promise<DeliveryResult>((resolve) => {
      settle = resolve;
    });

    this.pendingDeliveries.set(key, {
      message,
      deliveryId: deliveryKey(subscriptionId, message.id),
      subscriptionId,
      settle,
      promise,
    });
    this._runDelivery(subscriptionId, message, key);

    return promise;
  }

  /** 内部记账键：同 `(subscriptionId, messageId)` 的并发投递各自独立。 */
  private _reserveDeliveryKey(subscriptionId: string, messageId: string): string {
    const base = deliveryKey(subscriptionId, messageId);
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
   */
  private _runDelivery(subscriptionId: string, message: MailMessage, key: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      // 等待期间被退订 / provider 已关闭：不再调用回调，按取消结算。
      this._settleAndFallback(key, 'cancelled');
      return;
    }

    // 看门狗只给「一次尝试」计时：卡死的回调会拖住整条广播的结算判定（消息既不回队也不死信）。
    this._armDeliveryWatchdog(key);

    let attempt: void | Promise<void>;
    try {
      attempt = sub.onReceive(message);
    } catch (error) {
      this._handleDeliveryError(subscriptionId, message, key, error);
      return;
    }

    Promise.resolve(attempt).then(
      async () => {
        try {
          // On successful execution, implicitly acknowledge the message.
          await this.ack(message);
          this.attempts.reset(subscriptionId, message.id);
          this._settleDelivery(key, 'ok');
        } catch (error) {
          this._handleDeliveryError(subscriptionId, message, key, error);
        }
      },
      (error) => {
        this._handleDeliveryError(subscriptionId, message, key, error);
      },
    );
  }

  /**
   * 订阅回调抛错时的统一处理（投递级）。
   *
   * 默认（`retry === null`）：可重试 → 结算 `retriable`；不可重试 → 结算 `fatal`（死信）。
   * 开启重试后：可重试且未超上限 → 只重投给失败的那个订阅者（不广播给其他已成功的订阅者，
   * 否则它们的副作用会被执行两次）；超上限 → 清零台账、调 `_onRetryExhausted`，再结算 `retriable`。
   *
   * 广播型 provider 不在这里 `nack`：整条消息回不回队由发送侧在所有投递结算后统一判定
   * （见 `shouldRequeueAfterBroadcast`）。没接 barrier 的广播 provider 由
   * `_fallbackForMissingBarrier` 兜底（整条回队 + 告警），否则可重试失败就静默消失了。
   * 非广播型 provider 每次投递对应 broker 的一次 ack，保持原有 per-delivery `nack(requeue=true)`。
   */
  protected _handleDeliveryError(subscriptionId: string, message: MailMessage, key: string, error: any): void {
    console.error(`[${this.protocol}] Error processing message ${message.id}:`, error);

    const isRetriable = this._isRetriable(error);

    if (isRetriable && this.retry) {
      const attempt = this.attempts.record(subscriptionId, message.id);

      if (attempt < this.retry.maxAttempts && this.subscriptions.has(subscriptionId)) {
        const delay = nextRetryDelay(this.retry, attempt);
        const timer = setTimeout(() => {
          const pending = this.pendingDeliveries.get(key);
          if (!pending) {
            return; // 退避期间已结算（退订 / 关闭）
          }
          pending.timer = undefined;
          if (!this.subscriptions.has(subscriptionId)) {
            // 等待期间退订了：不重投给已消失的订阅者，按取消结算（消息由兜底路径接手）。
            this._settleAndFallback(key, 'cancelled');
            return;
          }
          this._runDelivery(subscriptionId, message, key);
        }, delay);
        // 不要因为一个待重投就把 Node 事件循环撑住。
        (timer as unknown as { unref?: () => void }).unref?.();

        const pending = this.pendingDeliveries.get(key);
        if (pending) {
          pending.timer = timer;
          // 退避等待不是“卡死的尝试”：看门狗只在尝试进行中计时，退避期间关掉，
          // 否则一个比看门狗还长的退避会被自己掐断。
          this._clearDeliveryWatchdog(pending);
        } else {
          clearTimeout(timer); // 已经结算（例如退订），定时器作废
        }
        return;
      }

      if (attempt >= this.retry.maxAttempts) {
        this.attempts.reset(subscriptionId, message.id);
        this._onRetryExhausted?.(message, attempt);
      }
    }

    if (isRetriable && !this.broadcastDeliveries) {
      // Crucial: NACK the message first to prevent reprocessing, then handle other tasks.
      this.nack(message, true).catch(nackError => {
        console.error(`[${this.protocol}] CRITICAL: Failed to NACK message ${message.id}. Risk of message duplication.`, nackError);
      });
    }

    this._settleAndFallback(key, isRetriable ? 'retriable' : 'fatal');
  }

  /**
   * [Subclass Responsibility - Optional] 重试次数耗尽时的钩子（例如写死信队列 / 告警）。
   * 若这次广播没有任何订阅者成功，消息随后仍会退回队列，由 `fetch()` 兜底。
   */
  protected _onRetryExhausted?(message: MailMessage, attempts: number): void;

  /**
   * [Subclass Responsibility - Optional] 死信钩子：广播已结算，有投递失败但消息**不**回队时用
   * （即“部分失败”或“全部不可重试”）。不回队是为了不把已成功者处理过的消息再投一次，
   * 代价是失败的投递从此隐形 —— 这个钩子就是补上那个可观测性缺口（写死信队列 / 告警）。
   */
  protected _onDeliveryDeadLettered?(message: MailMessage, failed: readonly DeliveryResult[]): void;

  /**
   * 广播的结算 barrier：把 `publish` 返回的每次投递绑成一个后台任务，全部投递
   * （含重试链）落定后统一判定要不要 `nack(requeue)`。给广播型 provider 的 `_send` 用。
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
    this._registerBroadcastBarrier(message.id);

    void Promise.allSettled(deliveries.map((delivery) => Promise.resolve(delivery)))
      .then(async (settled) => {
        const results = toDeliveryResults(settled);
        const requeue = shouldRequeueAfterBroadcast(results);
        if (!requeue) {
          const failed = results.filter((result) => !result.ok);
          if (failed.length > 0) {
            this._onDeliveryDeadLettered?.(message, failed);
          }
        }
        await this.nack(message, requeue);
      })
      .catch((error) => {
        console.error(`[${this.protocol}] CRITICAL: Failed to settle a broadcast.`, error);
      })
      .finally(() => {
        this._releaseBroadcastBarrier(message.id);
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
    if (result.ok || this._barrierDepth(message.id) > 0) {
      return;
    }
    queueMicrotask(() => {
      if (this._barrierDepth(message.id) > 0) {
        return; // barrier 已登记（同一任务内），判定交给它
      }
      this._warnMissingBarrier(message.id);
      if (result.reason === 'fatal') {
        this._onDeliveryDeadLettered?.(message, [result]);
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
   * 结算一条投递；广播型 provider 若这条消息没接 barrier，走兜底。
   */
  private _settleAndFallback(key: string, outcome: DeliveryOutcome): void {
    const pending = this.pendingDeliveries.get(key);
    if (!pending) {
      return; // 已结算过
    }
    const result = this._settleDelivery(key, outcome);
    if (result && this.broadcastDeliveries) {
      this._fallbackForMissingBarrier(pending.message, result);
    }
  }

  /**
   * 放弃一条投递（退避中退订 / 看门狗超时）：按取消结算，消息交给兜底路径。
   */
  private _abandonDelivery(key: string, outcome: DeliveryOutcome = 'cancelled'): void {
    const pending = this.pendingDeliveries.get(key);
    if (!pending) {
      return;
    }
    const result = this._settleDelivery(key, outcome);
    if (!result) {
      return;
    }
    if (this.broadcastDeliveries) {
      this._fallbackForMissingBarrier(pending.message, result);
      return;
    }
    // 非广播（传输型）：每次投递对应 broker 的一次 ack，交回传输层重投。
    this.nack(pending.message, true).catch(nackError => {
      console.error(`[${this.protocol}] CRITICAL: Failed to NACK message ${pending.message.id}. Risk of message duplication.`, nackError);
    });
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
    };
    pending.settle(result);
    return result;
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
