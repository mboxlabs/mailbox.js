/**
 * `MemoryProvider` 的死信参考接法（opt-in）—— 「放弃之后留下什么」的示范
 *
 * 内核裁决：死信归 provider。基类只发信号 + 给钩子（`_onDeliveryDeadLettered`），
 * 本文件锁住的是「接上之后必须留下什么」：
 *
 *   1. 默认**关**——不改变现有行为（`nack(requeue=false)` 仍是丢弃）；
 *   2. 开启后被放弃的消息在 `<topic><suffix>`（默认 `_dlq`）里可 `peek` / `fetch` / `status`；
 *   3. 归档副本带上「为什么、第几次、原来在哪」的控制头，业务 `meta` 不被内核污染；
 *   4. 回队（可重试失败、没人成功）**不是**放弃，不进死信；
 *   5. 死信记录可被取回并重新投递（DLQ 不是一条只进不出的死胡同）。
 *
 * 命名标记：[语义] 契约；[事实] 附带锁定的行为。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mailbox } from '../mailbox';
import { MemoryProvider, DEFAULT_DEAD_LETTER_SUFFIX } from './memory';

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const retriable = (message = 'upstream down') =>
  Object.assign(new Error(message), { isRetriable: true });

const fatal = (message = 'bad payload') => new Error(message);

let seq = 0;
const addrOf = (name: string): string => `mem://dlq${seq++}-${name}@bus/inbox`;

describe('[语义] 死信队列是 opt-in 的 provider 行为', () => {
  let mailbox: Mailbox;
  let provider: MemoryProvider;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    provider = MemoryProvider.createIsolated();
    mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    await mailbox.start();
  });

  afterEach(async () => {
    await mailbox.stop();
    vi.restoreAllMocks();
  });

  it('[语义] 默认不开：被放弃的消息没有 DLQ（内核不保证留下什么）', async () => {
    const address = addrOf('default-off');
    mailbox.subscribe(address, () => {
      throw fatal();
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    expect(provider.deadLetterEnabled).toBe(false);
    expect((await mailbox.status(address)).unreadCount).toBe(0);
    expect(await mailbox.fetch(address, { peek: true })).toEqual([]);
    expect(await provider.listAddresses()).not.toContain(`${address}_dlq`);
  });

  it('[语义] 全部投递都不可重试 → 消息被丢弃，但开启后在 _dlq 里可取回', async () => {
    provider.enableDeadLetterQueue();
    const address = addrOf('all-fatal');
    mailbox.subscribe(address, () => {
      throw fatal('boom');
    });

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    expect((await mailbox.status(address)).unreadCount).toBe(0);

    const dlq = provider.deadLetterTopic(address);
    expect(dlq).toBe(`${address}${DEFAULT_DEAD_LETTER_SUFFIX}`);

    const archived = await mailbox.fetch(dlq!);
    expect(archived).not.toBeNull();
    expect(archived!.id).toBe(sent.id);
    expect(archived!.body).toEqual({ n: 1 });
  });

  it('[语义] 归档副本带上「为什么 / 第几次 / 原来在哪」，且不污染业务 meta', async () => {
    provider.enableDeadLetterQueue();
    const address = addrOf('record-headers');
    mailbox.subscribe(address, () => {
      throw fatal('schema mismatch');
    });

    const sent = await mailbox.post({
      from: 'mem://s@bus/u',
      to: address,
      body: { n: 1 },
      meta: { order: 42 },
    });
    await tick();

    const entry = await mailbox.fetch(provider.deadLetterTopic(address)!);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(sent.id);

    expect(entry!.headers?.['mbx-dead-letter']).toBe('true');
    expect(entry!.headers?.['mbx-dead-letter-reason']).toBe('fatal');
    expect(entry!.headers?.['mbx-dead-letter-attempts']).toBe('1');
    expect(String(entry!.headers?.['mbx-dead-letter-error'])).toContain('schema mismatch');
    expect(entry!.headers?.['mbx-dead-letter-topic']).toBe(address);
    expect(entry!.headers?.['mbx-dead-letter-at']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 数据平面不动：内核的控制信息只走 headers
    expect(entry!.meta).toEqual({ order: 42 });
    expect(entry!.to.toString()).toBe(address);
  });

  it('[语义] 回队不是放弃：全部失败且可重试时不进死信', async () => {
    provider.enableDeadLetterQueue();
    const address = addrOf('all-retriable');
    mailbox.subscribe(address, () => {
      throw retriable();
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    expect((await mailbox.status(address)).unreadCount).toBe(1); // 退回队头，由 fetch() 兜底
    expect(await mailbox.fetch(provider.deadLetterTopic(address)!)).toBeNull();
  });

  it('[语义] 部分失败：不回队（已有人处理过），失败的那次投递进死信', async () => {
    provider.enableDeadLetterQueue();
    const address = addrOf('partial');
    mailbox.subscribe(address, () => undefined); // 成功
    mailbox.subscribe(address, () => {
      throw retriable('billing down');
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    expect((await mailbox.status(address)).unreadCount).toBe(0);

    const entries = await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].headers?.['mbx-dead-letter-reason']).toBe('retriable');
    expect(String(entries[0].headers?.['mbx-dead-letter-error'])).toContain('billing down');
  });

  it('[语义] 每次失败投递各留一条记录，带各自的尝试次数', async () => {
    provider.enableDeadLetterQueue();
    const address = addrOf('attempts-in-record');
    mailbox.subscribe(address, () => undefined); // 成功，防止整条回队
    mailbox.subscribe(address, () => {
      throw retriable();
    });

    provider.setRetryPolicy({ maxAttempts: 3, baseDelay: 5 });
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick(200);

    const entries = await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].headers?.['mbx-dead-letter-attempts']).toBe('3');
  });

  it('[语义] 死信记录可被取回后重新投递：DLQ 不是只进不出', async () => {
    provider.enableDeadLetterQueue();
    const address = addrOf('repost');
    const subscription = mailbox.subscribe(address, () => {
      throw fatal();
    });

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 7 } });
    await tick();
    await subscription.unsubscribe(); // 收手：重放时没有订阅者，消息才会落到队列

    const entry = await mailbox.fetch(provider.deadLetterTopic(address)!);
    const replayed = await mailbox.post({
      from: entry!.from,
      to: entry!.to,
      body: entry!.body,
    });

    expect((await mailbox.status(address)).unreadCount).toBe(1);
    const back = await mailbox.fetch(address);
    expect(back!.id).not.toBe(sent.id); // 重放是新的一次投递（原 id 已被记账为放弃）
    expect(back!.body).toEqual({ n: 7 });
    expect(replayed.id).toBe(back!.id);
  });

  it('[事实] 死信 topic 在 status / snapshot / listAddresses 里可见，clear() 一并清掉', async () => {
    provider.enableDeadLetterQueue({ suffix: '.dlq' });
    const address = addrOf('visible');
    mailbox.subscribe(address, () => {
      throw fatal();
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    const dlq = provider.deadLetterTopic(address);
    expect(dlq).toBe(`${address}.dlq`);
    expect((await mailbox.status(dlq!)).unreadCount).toBe(1);
    expect(await provider.listAddresses()).toContain(dlq!);

    const snapshot = await mailbox.snapshot();
    expect(snapshot.addresses.map((entry) => entry.address)).toContain(dlq!);

    await mailbox.clear();
    expect((await mailbox.status(dlq!)).unreadCount).toBe(0);
  });

  it('[事实] 关掉之后不再写入；重复开启只改后缀', async () => {
    provider.enableDeadLetterQueue();
    provider.disableDeadLetterQueue();
    const address = addrOf('toggle');
    mailbox.subscribe(address, () => {
      throw fatal();
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    expect(provider.deadLetterEnabled).toBe(false);
    expect(provider.deadLetterTopic(address)).toBeNull();
    expect(await mailbox.fetch(`${address}${DEFAULT_DEAD_LETTER_SUFFIX}`)).toBeNull();
  });

  it('[语义] 拉取侧的放弃（消费者自己 nack(false)）也进死信：不能静默消失', async () => {
    provider.enableDeadLetterQueue();
    const address = addrOf('consumer-nack');

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } }); // 无订阅者 → 入队
    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(false);

    expect((await mailbox.status(address)).unreadCount).toBe(0);

    const entries = await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].headers?.['mbx-dead-letter-reason']).toBe('consumer-nack');
    // 归档副本不该带着旧消费者的 ack / nack 句柄
    expect(typeof (entries[0] as unknown as { nack?: unknown }).nack).toBe('undefined');
  });

  it('[语义] 拉取侧 nack(true) 是回队不是放弃：不进死信、可再取回', async () => {
    provider.enableDeadLetterQueue();
    const address = addrOf('consumer-requeue');

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(true);

    expect((await mailbox.status(address)).unreadCount).toBe(1);
    expect(await mailbox.fetch(provider.deadLetterTopic(address)!)).toBeNull();
    expect((await mailbox.fetch(address))?.id).toBe(taken!.id);
  });

  it('[事实] 子类的 createIsolated() 必须构造子类实例，否则覆写的钩子静默没接上', async () => {
    class Tracked extends MemoryProvider {
      hooked = 0;
      protected _onDeliveryDeadLettered(): void {
        this.hooked++;
      }
    }

    const tracked = Tracked.createIsolated();
    expect(tracked).toBeInstanceOf(Tracked);

    mailbox.registerProvider(tracked);
    const address = addrOf('subclass-factory');
    mailbox.subscribe(address, () => {
      throw fatal();
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    expect(tracked.hooked).toBe(1);
  });

  it('[事实] 空后缀 / 非法后缀要报错，不能让死信写回原队列', async () => {
    expect(() => provider.enableDeadLetterQueue({ suffix: '' })).toThrow();
    expect(() => provider.enableDeadLetterQueue({ suffix: '?thread=1' })).toThrow();
    expect(provider.deadLetterEnabled).toBe(false);
  });
});
