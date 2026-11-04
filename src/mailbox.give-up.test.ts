/**
 * 「放弃（give up）」在语义契约里怎么表达 —— 回归防线
 *
 * 内核决定**要不要**重投（`_nack(requeue)` + `shouldRequeueAfterBroadcast`），
 * 但「重投几次 / 投到队列哪个位置 / 放弃之后留下什么」归 provider。这里锁三件事：
 *
 *   1. **放弃的信号必须由内核发出来**：队列 / 传输型 provider（`broadcastDeliveries = false`）
 *      上，不可重试失败必须走到 `nack(requeue = false)`——`wiki/mailbox-arch.md` 写的是
 *      「Provider 必须先 `nack(false)` 把消息永久移出队列，再落 DLQ」。信号不发，真实 broker
 *      上的坏消息就会在 visibility timeout 后无限重投。
 *   2. **放弃的事实必须可观测**：死信钩子在两类 provider 上都要触发，并带上 `attempts` /
 *      `error`（否则 DLQ 记录写不出「为什么、试了几次」）；钩子自己抛错也不能把回队 / 丢弃
 *      判定吞掉；钩子的 rejection 不能漏成 unhandledRejection。
 *   3. **次数与位置归 provider**：内核只在 headers 上留 `mbx-attempt` / `mbx-max-attempts`
 *      这种「余料」，不在队列结构里替 provider 定上限。
 *
 * 命名标记：
 *   [语义] 契约不变量，破坏它们就是回归。
 *   [事实] 锁住「内核**不**保证」的那一半（provider 的活儿），提醒读者别按内核保证理解。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mailbox } from './mailbox';
import { MailboxProvider } from './providers/MailboxProvider';
import { MemoryProvider, MemoryEventBus } from './providers';
import { MailMessageQueue } from './lib/MessageQueue';
import type { RetryPolicy } from './lib/retry';
import type { AckableMailMessage, MailMessage } from './interfaces';
import type { DeliveryResult } from './lib/delivery';

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const retriable = (message = 'upstream down') =>
  Object.assign(new Error(message), { isRetriable: true });

const fatal = (message = 'bad payload') => new Error(message);

let seq = 0;
const addrOf = (name: string, protocol = 'q'): string =>
  `${protocol}://t${seq++}-${name}@broker/inbox`;

function canonicalOf(address: URL | string): string {
  const url = typeof address === 'string' ? new URL(address) : address;
  const userInfo = url.username ? `${url.username}@` : '';
  return `${url.protocol}//${userInfo}${url.host}${url.pathname}`;
}

/**
 * 队列 / 传输型 provider 的参考形状（`broadcastDeliveries = false`，基类默认）：
 * 一次投递 = broker 的一次 ack，消息取走后停在 in-flight，直到 `_ack` / `_nack`。
 * 「放弃」在这类 provider 上只有一个出口：`_nack(message, false)`。
 *
 * `BrokerShapedProvider` 故意**不**实现 `_nack`——基类的 `_nack?` 是可选钩子，
 * 没实现时内核的「回队 / 放弃」决定会静默落空（见下面那组用例）。
 */
class BrokerShapedProvider extends MailboxProvider {
  readonly queue = new MailMessageQueue<MailMessage>();
  readonly delivered: MailMessage[] = [];

  constructor(protocol = 'q', retry?: RetryPolicy | null) {
    super(protocol, retry);
  }

  protected topicOf(address: URL | string): string {
    return canonicalOf(address);
  }

  protected async _send(message: MailMessage): Promise<void> {
    this.queue.enqueue(this.topicOf(message.to), message);
    this.pump(this.topicOf(message.to));
  }

  /**
   * broker 主动 push：只推**派发时刻**在队列里的那几封（回队的不会当场重投，
   * 真实 broker 也不会），没消费者就不推。
   */
  protected pump(topic: string): void {
    if (this.subscriptions.size === 0) {
      return;
    }
    const batch = this.queue.getStatus(topic).unreadCount;
    for (let i = 0; i < batch; i++) {
      const taken = this.queue.dequeue(topic, { manualAck: true, ackTimeout: null });
      if (!taken) {
        return;
      }
      for (const sub of Array.from(this.subscriptions.values())) {
        this.delivered.push(taken);
        void this._deliverToLocalSubscription(sub.id, taken);
      }
    }
  }

  protected _subscribe(_address: URL, _onReceive: any): any {
    return null;
  }

  protected async _unsubscribe(): Promise<void> {}

  protected async _fetch(
    address: URL,
    options?: { manualAck?: boolean; ackTimeout?: number | null },
  ): Promise<MailMessage | AckableMailMessage | null> {
    const topic = this.topicOf(address);
    const taken = options?.manualAck
      ? this.queue.dequeue(topic, { manualAck: true, ackTimeout: options.ackTimeout })
      : this.queue.dequeue(topic);
    return (taken as MailMessage | AckableMailMessage | undefined) ?? null;
  }

  /** broker 式 provider 的结算口径：按份号（系统发的 `mbx-send-id`），不按发送方的名字。 */
  protected flightKey(message: MailMessage): string {
    return this.queue.locate(message.id).find((c) => c.state === 'inFlight')?.key ?? message.id
  }

  protected async _ack(message: MailMessage): Promise<void> {
    this.queue.ack(this.flightKey(message));
  }

  protected async _peek(address: URL, options?: { limit?: number }): Promise<MailMessage[]> {
    return this.queue.peek(this.topicOf(address), options?.limit);
  }

  public queueState(address: string | URL): { unreadCount: number; inFlightCount: number } {
    // 只取这两个计数器：测试里比的是“还在不在队列 / 有没有卡在在飞”。
    const { unreadCount, inFlightCount } = this.queue.getStatus(this.topicOf(address));
    return { unreadCount, inFlightCount };
  }
}

/** 实现了 `_nack` 的常规队列型 provider：记录内核发出的每一次处置决定。 */
class TransportProvider extends BrokerShapedProvider {
  readonly nacks: { id: string; requeue: boolean }[] = [];
  readonly deadLettered: { message: MailMessage; failed: readonly DeliveryResult[] }[] = [];
  readonly exhausted: { id: string; attempts: number }[] = [];

  protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
    this.nacks.push({ id: message.id, requeue });
    this.queue.nack(this.flightKey(message), requeue);
  }

  protected _onDeliveryDeadLettered(message: MailMessage, failed: readonly DeliveryResult[]): void {
    this.deadLettered.push({ message, failed });
  }

  protected _onRetryExhausted(message: MailMessage, attempts: number): void {
    this.exhausted.push({ id: message.id, attempts });
  }
}

describe('放弃的信号：队列 / 传输型 provider 上的不可重试失败', () => {
  let mailbox: Mailbox;
  let provider: TransportProvider;
  let address: string;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mailbox = new Mailbox();
    provider = new TransportProvider();
    mailbox.registerProvider(provider);
    await mailbox.start();
    address = addrOf('transport-fatal');
  });

  afterEach(async () => {
    await mailbox.stop();
    vi.restoreAllMocks();
  });

  it('[语义] 不可重试失败必须发出「放弃」信号：nack(requeue=false) 恰好一次', async () => {
    mailbox.subscribe(address, () => {
      throw fatal();
    });

    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick();

    expect(provider.nacks).toEqual([{ id: expect.any(String), requeue: false }]);
    // 消息既不该停在 in-flight，也不该回到队列
    expect(provider.queueState(address)).toEqual({ unreadCount: 0, inFlightCount: 0 });
  });

  it('[语义] 放弃的事实必须可观测：死信钩子收到 reason / attempts / error', async () => {
    mailbox.subscribe(address, () => {
      throw fatal('payload schema mismatch');
    });

    const sent = await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick();

    expect(provider.deadLettered).toHaveLength(1);
    expect(provider.deadLettered[0].message.id).toBe(sent.id);

    const [failure] = provider.deadLettered[0].failed;
    expect(failure.ok).toBe(false);
    expect(failure.reason).toBe('fatal');
    expect(failure.attempts).toBe(1);
    expect(failure.error).toContain('payload schema mismatch');
  });

  it('[语义] 先永久移出队列，再落死信：nack 必须排在钩子之前', async () => {
    const order: string[] = [];

    class OrderedProvider extends TransportProvider {
      protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
        order.push(`nack:${requeue}`);
        await super._nack(message, requeue);
      }
      protected _onDeliveryDeadLettered(): void {
        order.push('dead-letter');
      }
    }

    const box = new Mailbox();
    const ordered = new OrderedProvider();
    box.registerProvider(ordered);
    box.subscribe(address, () => {
      throw fatal();
    });

    await box.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick();

    expect(order).toEqual(['nack:false', 'dead-letter']);
    await box.stop();
  });

  it('[语义] 可重试失败不是放弃：nack(requeue=true)，且不走死信钩子', async () => {
    mailbox.subscribe(address, () => {
      throw retriable();
    });

    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick();

    expect(provider.nacks).toEqual([{ id: expect.any(String), requeue: true }]);
    expect(provider.deadLettered).toHaveLength(0);
    expect(provider.queueState(address).unreadCount).toBe(1);
  });

  it('[语义] 重试预算耗尽也不是放弃：仍回队、死信钩子不触发，但耗尽钩子要报到次数', async () => {
    mailbox.subscribe(address, () => {
      throw retriable();
    });
    provider.setRetryPolicy({ maxAttempts: 2, baseDelay: 5 });

    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick(150);

    expect(provider.exhausted).toEqual([{ id: expect.any(String), attempts: 2 }]);
    expect(provider.nacks).toEqual([{ id: expect.any(String), requeue: true }]);
    expect(provider.deadLettered).toHaveLength(0);
    expect(provider.queueState(address).unreadCount).toBe(1);
  });

  it('[语义] 内核不自己裁决次数：上限由 RetryPolicy 决定，记账里带上次数', async () => {
    let attempts = 0;
    mailbox.subscribe(address, () => {
      attempts++;
      throw retriable();
    });
    provider.setRetryPolicy({ maxAttempts: 4, baseDelay: 5 });

    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick(300);

    expect(attempts).toBe(4);
    expect(provider.exhausted[0].attempts).toBe(4);
  });
});

describe('放弃的信号：provider 漏接时不能让决定静默蒸发', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('[语义] 没实现 `_nack` 的 provider：决定落空时必须告警一次，不刷屏', async () => {
    const warn = vi.spyOn(console, 'warn');
    const mailbox = new Mailbox();
    const provider = new BrokerShapedProvider('nolock');
    mailbox.registerProvider(provider);
    await mailbox.start();
    const address = addrOf('missing-nack', 'nolock');

    mailbox.subscribe(address, () => {
      throw retriable(); // → 内核决定 nack(true)
    });
    await mailbox.post({ from: 'nolock://s@broker/u', to: address, body: { n: 1 } });
    await tick();

    mailbox.subscribe(address, () => {
      throw fatal(); // → 内核决定 nack(false)
    });
    await mailbox.post({ from: 'nolock://s@broker/u', to: address, body: { n: 2 } });
    await tick();

    const nackWarnings = warn.mock.calls.filter((args) => String(args[0]).includes('`_nack`'));
    expect(nackWarnings).toHaveLength(1);
    expect(String(nackWarnings[0][0])).toContain('nolock');

    await mailbox.stop();
  });

  it('[事实] 实现了 `_nack` 的 provider 不会被这条告警打扰', async () => {
    const warn = vi.spyOn(console, 'warn');
    const mailbox = new Mailbox();
    mailbox.registerProvider(new TransportProvider());
    const address = addrOf('has-nack');
    mailbox.subscribe(address, () => {
      throw fatal();
    });

    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick();

    expect(warn.mock.calls.filter((args) => String(args[0]).includes('`_nack`'))).toHaveLength(0);
    await mailbox.stop();
  });
});

describe('死信钩子自己不可靠时，处置判定不能被它吞掉', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('[语义] 钩子同步抛错：丢弃 / 回队照常，错误被记录下来', async () => {
    const error = vi.spyOn(console, 'error');

    class Boom extends TransportProvider {
      protected _onDeliveryDeadLettered(): void {
        throw new Error('dlq write failed');
      }
    }

    const mailbox = new Mailbox();
    const boom = new Boom();
    mailbox.registerProvider(boom);
    const address = addrOf('hook-throws');
    mailbox.subscribe(address, () => {
      throw fatal();
    });

    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick();

    expect(boom.nacks).toEqual([{ id: expect.any(String), requeue: false }]);
    expect(error.mock.calls.some((args) => String(args).includes('dead-letter hook'))).toBe(true);
    await mailbox.stop();
  });

  it('[语义] 钩子返回 rejected promise：不能漏成 unhandledRejection', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);

    const mailbox = new Mailbox();
    class AsyncBoom extends MemoryProvider {
      hookCalls = 0;
      protected async _onDeliveryDeadLettered(): Promise<void> {
        this.hookCalls++;
        throw new Error('dlq is down');
      }
    }
    // 注意：`createIsolated()` 是静态方法，子类调用它仍会构造基类实例——这里直接 new，
    // 否则钩子根本没接上，用例会“绿得很假”。
    const provider = new AsyncBoom(null, new MemoryEventBus());
    mailbox.registerProvider(provider);
    const address = addrOf('async-hook', 'mem');
    mailbox.subscribe(address, () => {
      throw fatal();
    });

    try {
      await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
      await tick(80);
    } finally {
      process.off('unhandledRejection', onRejection);
      await mailbox.stop();
    }

    expect(provider.hookCalls).toBe(1); // 钩子确实被调到了
    expect(rejections).toHaveLength(0);
  });

  it('[语义] 广播路径同样先结算再落死信：钩子抛错不影响处置判定', async () => {
    class BoomBroadcast extends MemoryProvider {
      readonly nacks: boolean[] = [];
      protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
        this.nacks.push(requeue);
        await super._nack(message, requeue);
      }
      protected _onDeliveryDeadLettered(): void {
        throw new Error('dlq write failed');
      }
    }

    const mailbox = new Mailbox();
    const provider = new BoomBroadcast(null, new MemoryEventBus());
    mailbox.registerProvider(provider);
    const address = addrOf('broadcast-hook', 'mem');

    mailbox.subscribe(address, () => undefined); // 成功的订阅者
    mailbox.subscribe(address, () => {
      throw retriable();
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    expect(provider.nacks).toEqual([false]); // 不回队（已有人处理过）
    expect((await mailbox.status(address)).unreadCount).toBe(0);
    await mailbox.stop();
  });
});

describe('放弃的余料：内核只留痕，不做上限', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('[语义] 每次尝试都在 headers 上留 mbx-attempt；开启重试时带上 mbx-max-attempts', async () => {
    const mailbox = new Mailbox();
    const provider = MemoryProvider.createIsolated({ maxAttempts: 3, baseDelay: 5 });
    mailbox.registerProvider(provider);
    const address = addrOf('attempt-header', 'mem');

    const seen: (string | undefined)[] = [];
    const seenMax: (string | undefined)[] = [];
    mailbox.subscribe(address, (message) => {
      seen.push(message.headers?.['mbx-attempt'] as string | undefined);
      seenMax.push(message.headers?.['mbx-max-attempts'] as string | undefined);
      throw retriable();
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick(200);

    expect(seen).toEqual(['1', '2', '3']);
    expect(seenMax).toEqual(['3', '3', '3']);
    await mailbox.stop();
  });

  it('[语义] 尝试计数不串台：重投只喂给失败的那个订阅者', async () => {
    const mailbox = new Mailbox();
    const provider = MemoryProvider.createIsolated({ maxAttempts: 3, baseDelay: 5 });
    mailbox.registerProvider(provider);
    const address = addrOf('no-leak', 'mem');

    let goodAttempt: string | undefined;
    mailbox.subscribe(address, (message) => {
      goodAttempt = message.headers?.['mbx-attempt'] as string | undefined;
    });
    mailbox.subscribe(address, () => {
      throw retriable();
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick(200);

    expect(goodAttempt).toBe('1'); // 成功者只被投递一次，计数也不被失败者的重试污染
    await mailbox.stop();
  });

  it('[事实] 内核不给 fetch() 侧的重投设上限：nack(true) 可以无限循环（归 provider）', async () => {
    const mailbox = new Mailbox();
    const provider = new TransportProvider();
    mailbox.registerProvider(provider);
    const address = addrOf('poison');

    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    // 没有订阅者：消息留在队列里，由 fetch() 消费者处置。
    for (let i = 0; i < 20; i++) {
      const taken = await mailbox.fetch(address, { manualAck: true });
      expect(taken).not.toBeNull();
      await taken!.nack(true);
    }

    expect(provider.queueState(address)).toEqual({ unreadCount: 1, inFlightCount: 0 });
    await mailbox.stop();
  });

  it('[事实] fetch() 侧的放弃只有一个出口：nack(false)，内核默认不留任何痕迹', async () => {
    const mailbox = new Mailbox();
    const provider = new TransportProvider();
    mailbox.registerProvider(provider);
    const address = addrOf('consumer-gives-up');

    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(false);

    expect(provider.queueState(address)).toEqual({ unreadCount: 0, inFlightCount: 0 });
    expect(await mailbox.fetch(address, { peek: true })).toEqual([]);
    // 内核不提供死信：要留下什么，得 provider 自己接（见 providers/memory.dead-letter.test.ts）
    await mailbox.stop();
  });
});
