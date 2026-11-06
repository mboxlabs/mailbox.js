/**
 * 投递计数（`mbx-attempt` / `mbx-round`）的语义防线。
 *
 * 内核把「重投几次 / 上限在哪」划给 provider，那就必须给 provider **可数的东西**。这里钉四条：
 *
 *   1. **两个计数不能混用**：`mbx-attempt` 只数**当前这条重试链内**的趟数（回队后下一轮重新从
 *      `'1'` 数）；`mbx-round` 才是**跨轮累积**的投递轮次。拿 `mbx-attempt` 当上限，每轮都只数到
 *      `maxAttempts` 就停在那儿，上限永远不会触发。
 *   2. **回队的副本必须带计数**：广播的 barrier 交给 `_nack` / `_onDeliveryDeadLettered` 的必须是
 *      本轮结算后的投递副本，不是 `send()` 那份共享对象——否则回队那份在队列里什么计数都没有，
 *      `fetch()` 兜底消费者看不出「这条已经被订阅投递过几轮」，provider 也封顶不了。
 *   3. **谁把消息交给消费者，谁给轮次 +1**：订阅侧基类 +1，拉取侧队列 +1；`peek()` 不 +1（那只是
 *      看一眼）。内核只会把轮次往上加，绝不把已有值改小。
 *   4. **上限仍归 provider，但输入由内核给**：只靠 headers 就能实现 SQS 式 `maxReceiveCount`。
 *
 * 命名标记：
 *   [语义] 契约不变量，破坏它们就是回归。
 *   [事实] 锁住「内核**不**保证」的那一半（provider 的活儿）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mailbox } from './mailbox';
import { MailboxProvider } from './providers/MailboxProvider';
import { MemoryProvider, MemoryEventBus } from './providers';
import { MailMessageQueue } from './lib/MessageQueue';
import { MBX_ATTEMPT_HEADER, MBX_ROUND_HEADER, readRound } from './lib/delivery';
import type { MailMessage } from './interfaces';
import type { DeliveryResult } from './lib/delivery';

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retriable = () => Object.assign(new Error('upstream down'), { isRetriable: true });

let seq = 0;
const memAddr = (name: string): string => `mem://t${seq++}-${name}@bus/inbox`;
const canonicalOf = (address: URL | string): string => {
  const url = typeof address === 'string' ? new URL(address) : address;
  const userInfo = url.username ? `${url.username}@` : '';
  return `${url.protocol}//${userInfo}${url.host}${url.pathname}`;
};

/** 读计数头，缺省写成 `undefined`，让断言一眼看出「没有这个头」。 */
const countersOf = (message?: { headers?: Record<string, any> } | null) => ({
  attempt: message?.headers?.[MBX_ATTEMPT_HEADER],
  max: message?.headers?.['mbx-max-attempts'],
  round: message?.headers?.[MBX_ROUND_HEADER],
});

// ---------------------------------------------------------------------------
// 广播型（MemoryProvider）：处置信号与回队副本都必须带本轮计数
// ---------------------------------------------------------------------------

/** 记录 `_nack` 与死信钩子实际收到的消息（不是「应该有」，是「拿到了什么」）。 */
class BroadcastSpy extends MemoryProvider {
  readonly nacks: { requeue: boolean; attempt?: string; round?: string }[] = [];
  readonly deadLettered: { attempt?: string; round?: string; failed: readonly DeliveryResult[] }[] = [];

  protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
    const { attempt, round } = countersOf(message);
    this.nacks.push({ requeue, attempt, round });
    await super._nack(message, requeue);
  }

  protected _onDeliveryDeadLettered(message: MailMessage, failed: readonly DeliveryResult[]): void {
    const { attempt, round } = countersOf(message);
    this.deadLettered.push({ attempt, round, failed });
    super._onDeliveryDeadLettered(message, failed);
  }
}

describe('计数头：广播回队的副本必须带本轮次数与轮次', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('[语义] 回队的副本带着本轮的次数与轮次（fetch / peek 兜底消费者看得见）', async () => {
    const provider = MemoryProvider.createIsolated({ maxAttempts: 3, baseDelay: 1 });
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = memAddr('requeue-copy');

    await mailbox.subscribe(address, () => {
      throw retriable();
    });
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick(150);

    // 回队那一份：本轮链内试了 3 次、这是第 1 轮投递。
    const [queued] = await mailbox.fetch(address, { peek: true });
    expect(countersOf(queued)).toEqual({ attempt: '3', max: '3', round: '1' });

    const taken = await mailbox.fetch(address, { manualAck: true });
    expect(countersOf(taken).attempt).toBe('3');

    await mailbox.stop({ purge: true });
  });

  it('[语义] barrier 的 `_nack` 与死信钩子收到的是打戳副本，不是 send() 那份共享对象', async () => {
    const provider = new BroadcastSpy({ maxAttempts: 3, baseDelay: 1 }, new MemoryEventBus());
    provider.enableDeadLetterQueue();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = memAddr('barrier-copy');

    await mailbox.subscribe(address, () => { /* 成功者：整条不回队 */ });
    await mailbox.subscribe(address, () => {
      throw retriable();
    });
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick(150);

    expect(provider.nacks).toEqual([{ requeue: false, attempt: '3', round: '1' }]);
    expect(provider.deadLettered).toHaveLength(1);
    expect(provider.deadLettered[0]).toMatchObject({ attempt: '3', round: '1' });
    expect(provider.deadLettered[0].failed[0].attempts).toBe(3);

    await mailbox.stop({ purge: true });
  });

  it('[语义] 重试链内轮次不变，只有趟数在涨', async () => {
    const provider = MemoryProvider.createIsolated({ maxAttempts: 3, baseDelay: 1 });
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = memAddr('chain-round');

    const seen: { attempt?: string; round?: string }[] = [];
    await mailbox.subscribe(address, (message) => {
      seen.push(countersOf(message));
      throw retriable();
    });
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick(150);

    expect(seen.map((c) => c.attempt)).toEqual(['1', '2', '3']);
    expect(seen.map((c) => c.round)).toEqual(['1', '1', '1']);

    await mailbox.stop({ purge: true });
  });
});

// ---------------------------------------------------------------------------
// 队列 / 传输型：`mbx-attempt` 归零、`mbx-round` 累积
// ---------------------------------------------------------------------------

/**
 * broker 型 provider（`broadcastDeliveries = false`）：`_nack(true)` 把**内核交还的那份副本**
 * 放回队列并再投一次——真实 broker（SQS / AMQP）重投时会带上自己的接收计数，这里是同一形状。
 */
class RedeliveryBroker extends MailboxProvider {
  readonly queue = new MailMessageQueue<MailMessage>();
  /** 每次把消息交给订阅者时，消息身上带的计数（入队原件，未经内核打戳）。 */
  readonly handedOff: { attempt?: string; round?: string }[] = [];
  readonly nacks: { requeue: boolean; attempt?: string; round?: string }[] = [];
  /** provider 自己定的上限（内核不管）：轮次到这个数就放弃，不再回队。 */
  public maxRounds: number | null = null;
  readonly givenUp: string[] = [];

  constructor(retry?: { maxAttempts: number; baseDelay: number } | null) {
    super('q', retry);
  }

  private topicOf(address: URL | string): string {
    return canonicalOf(address);
  }

  protected async _send(message: MailMessage): Promise<void> {
    this.queue.enqueue(this.topicOf(message.to), message);
    this.pump(this.topicOf(message.to));
  }

  private pump(topic: string): void {
    const sub = Array.from(this.subscriptions.values())[0];
    if (!sub) {
      return;
    }
    const taken = this.queue.dequeue(topic, { manualAck: true, ackTimeout: null });
    if (!taken) {
      return;
    }
    this.handedOff.push(countersOf(taken));
    void this._deliverToLocalSubscription(sub.id, taken);
  }

  protected _subscribe(): any {
    return null;
  }

  protected async _unsubscribe(): Promise<void> {}

  protected async _fetch(): Promise<MailMessage | null> {
    return null;
  }

  /** broker 式 provider 的结算口径：按份号（系统发的 `mbx-send-id`），不按发送方的名字。 */
  protected flightKey(message: MailMessage): string {
    return this.queue.locate(message.id).find((c) => c.state === 'inFlight')?.key ?? message.id
  }

  protected async _ack(message: MailMessage): Promise<void> {
    this.queue.ack(this.flightKey(message));
  }

  protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
    const topic = this.topicOf(message.to);
    const { attempt, round } = countersOf(message);
    const key = this.flightKey(message)
    this.nacks.push({ requeue, attempt, round });

    if (!requeue) {
      this.queue.nack(key, false);
      return;
    }
    // 上限归 provider：内核只把带计数的副本交回来，要不要继续投由这里判。
    if (this.maxRounds !== null && readRound(message) >= this.maxRounds) {
      this.queue.nack(key, false);
      this.givenUp.push(message.id);
      return;
    }
    // broker 重投时保留内核给的计数（真实 broker 写的是自己的 ApproximateReceiveCount）。
    this.queue.nack(key, false);
    this.queue.enqueue(topic, message);
    this.pump(topic);
  }

  public queueState(address: string | URL): { unreadCount: number; inFlightCount: number } {
    // 只取这两个计数器：测试里比的是“还在不在队列 / 有没有卡在在飞”。
    const { unreadCount, inFlightCount } = this.queue.getStatus(this.topicOf(address));
    return { unreadCount, inFlightCount };
  }
}

describe('计数头：链内趟数与跨轮轮次各管各的', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('[语义] 跨回队的新一轮投递：趟数回到 1，轮次继续累积', async () => {
    const provider = new RedeliveryBroker({ maxAttempts: 2, baseDelay: 1 });
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = 'q://t-cross@broker/inbox';

    const seen: { attempt?: string; round?: string }[] = [];
    await mailbox.subscribe(address, (message) => {
      seen.push(countersOf(message));
      throw retriable();
    });
    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick(150);

    // 消费者看到的：`mbx-attempt` 每轮都从 1 数到 maxAttempts —— 拿它当上限永远数不出来。
    expect(seen.slice(0, 4).map((c) => c.attempt)).toEqual(['1', '2', '1', '2']);
    // ……而 `mbx-round` 一轮一个数，只增不减。
    expect(seen.slice(0, 4).map((c) => c.round)).toEqual(['1', '1', '2', '2']);
    // 内核交还给 provider 的那一份同样带轮次 —— 这就是 provider 封顶要的输入。
    expect(provider.nacks.slice(0, 3).map((n) => n.round)).toEqual(['1', '2', '3']);
    expect(provider.nacks.slice(0, 3).map((n) => n.attempt)).toEqual(['2', '2', '2']);

    await mailbox.stop({ purge: true });
  });

  it('[语义] 内核不会抹掉系统带回来的轮次：只 +1，不改小', async () => {
    // 轮次是**系统记账**：broker 自己已经投过 5 轮，内核接手后只能往上加。
    // 注意入口：这个 5 不是发送方在 `post()` 里塞的（那种不采信，见
    // `mailbox.same-id.test.ts`），而是 broker 自己给在飞消息打的戳。
    class BrokerWithHistory extends RedeliveryBroker {
      protected async _send(message: MailMessage): Promise<void> {
        await super._send({
          ...message,
          headers: { ...(message.headers ?? {}), [MBX_ROUND_HEADER]: '5' },
        })
      }
    }

    const provider = new BrokerWithHistory(null);
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = 'q://t-preserve@broker/inbox';

    const seen: { attempt?: string; round?: string }[] = [];
    await mailbox.subscribe(address, (message) => {
      seen.push(countersOf(message));
      throw new Error('bad payload'); // 不可重试：只投一次就放弃，计数头一眼能看完
    });
    await mailbox.post({
      from: 'q://s@broker/u',
      to: address,
      body: { n: 1 },
    });
    await tick(120);

    expect(seen).toEqual([{ attempt: '1', round: '6' }]);
    await mailbox.stop({ purge: true });
  });

  it('[事实] 上限归 provider，但只靠 headers 就能封顶：毒消息不再无限重投', async () => {
    const provider = new RedeliveryBroker({ maxAttempts: 2, baseDelay: 1 });
    provider.maxRounds = 3; // provider 自己的 maxReceiveCount
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = 'q://t-cap@broker/inbox';

    const seen: { attempt?: string; round?: string }[] = [];
    await mailbox.subscribe(address, (message) => {
      seen.push(countersOf(message));
      throw retriable();
    });
    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick(200);

    // 3 轮 × 2 趟 = 6 次投递，然后被 provider 放弃：不会无限循环。
    expect(seen).toHaveLength(6);
    expect(seen.map((c) => c.round)).toEqual(['1', '1', '2', '2', '3', '3']);
    expect(provider.givenUp).toHaveLength(1);
    expect(provider.queueState(address)).toEqual({ unreadCount: 0, inFlightCount: 0 });

    await mailbox.stop({ purge: true });
  });
});

// ---------------------------------------------------------------------------
// 拉取侧：交给消费者时 +1；只读快照不 +1
// ---------------------------------------------------------------------------

describe('计数头：轮次由「交给消费者」的那一方递增', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('[语义] 纯拉取循环里轮次递增（nack(true) 把带计数的副本放回队列）', async () => {
    const provider = MemoryProvider.createIsolated();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = memAddr('pull-rounds');

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      const taken = await mailbox.fetch(address, { manualAck: true });
      expect(taken).not.toBeNull();
      seen.push(taken!.headers?.[MBX_ROUND_HEADER]);
      await taken!.nack(true);
    }
    expect(seen).toEqual(['1', '2', '3']);

    await mailbox.stop({ purge: true });
  });

  it('[语义] peek() 不递增轮次：看一眼不算把消息交出去', async () => {
    const provider = MemoryProvider.createIsolated();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = memAddr('peek-round');

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const first = await mailbox.fetch(address, { peek: true });
    expect(first[0]?.headers?.[MBX_ROUND_HEADER]).toBeUndefined();
    const second = await mailbox.fetch(address, { peek: true });
    expect(second[0]?.headers?.[MBX_ROUND_HEADER]).toBeUndefined();

    const taken = await mailbox.fetch(address, { manualAck: true });
    expect(taken?.headers?.[MBX_ROUND_HEADER]).toBe('1');

    await mailbox.stop({ purge: true });
  });
});

// ---------------------------------------------------------------------------
// 死信记录：消费者侧放弃也必须写得出真实次数
// ---------------------------------------------------------------------------

describe('计数头：死信记录里的次数与轮次必须是真的', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('[语义] consumer-nack 的记录不再是恒 1：订阅侧试过几次就写几次', async () => {
    const provider = MemoryProvider.createIsolated({ maxAttempts: 3, baseDelay: 1 });
    provider.enableDeadLetterQueue();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = memAddr('cn-attempts');

    await mailbox.subscribe(address, () => {
      throw retriable();
    });
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick(150);

    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(false);

    const [dead] = await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true });
    expect(dead.headers?.['mbx-dead-letter-reason']).toBe('consumer-nack');
    expect(dead.headers?.['mbx-dead-letter-attempts']).toBe('3'); // 订阅链内试了 3 次
    expect(dead.headers?.['mbx-dead-letter-round']).toBe('2'); // 订阅 1 轮 + 这次取信

    await mailbox.stop({ purge: true });
  });

  it('[语义] 订阅侧放弃的记录同样带轮次', async () => {
    const provider = MemoryProvider.createIsolated({ maxAttempts: 2, baseDelay: 1 });
    provider.enableDeadLetterQueue();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = memAddr('sub-round');

    await mailbox.subscribe(address, () => { /* 成功者 */ });
    await mailbox.subscribe(address, () => {
      throw retriable();
    });
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick(120);

    const [dead] = await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true });
    expect(dead.headers?.['mbx-dead-letter-reason']).toBe('retriable');
    expect(dead.headers?.['mbx-dead-letter-attempts']).toBe('2');
    expect(dead.headers?.['mbx-dead-letter-round']).toBe('1');

    await mailbox.stop({ purge: true });
  });
});
