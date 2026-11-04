/**
 * 拉取侧（消费者自己 `ack` / `nack`）死信归档的幂等与顺序 —— 「一次处置只留一条痕」
 *
 * 订阅侧的放弃由内核结算：`_settleAndFallback` 只结算一次，`_giveUpDelivery` 是
 * `nack(false)` **然后** 死信钩子，所以天然最多一条记录。拉取侧不经过内核记账
 * （消费者手里拿着 ackable），provider 自己接的这层必须有同样的两条约束：
 *
 *   1. **一次 fetch = 一次处置**：重复 `nack` / `ack` 之后不再作数，因而不会重复归档；
 *   2. **先处置、后留痕**：与内核同一顺序，消息不会同时存在于队列（或 in-flight）和 DLQ；
 *      处置若没真的落定（消息已被 stale 重投 / 已被 clear / 已被别人处置），就不写死信。
 *
 * 命名标记：[语义] 契约；[事实] 附带锁定的行为。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mailbox } from '../mailbox';
import { MemoryProvider } from './memory';

const tick = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let seq = 0;
const addrOf = (name: string): string => `mem://idemp${seq++}-${name}@bus/inbox`;

describe('[语义] 拉取侧的一次处置：重复 nack 不得重复归档死信', () => {
  let mailbox: Mailbox;
  let provider: MemoryProvider;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    provider = MemoryProvider.createIsolated();
    mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    await mailbox.start();
    provider.enableDeadLetterQueue();
  });

  afterEach(async () => {
    await mailbox.stop();
    vi.restoreAllMocks();
  });

  const dlqOf = (address: string) =>
    mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true });

  it('[语义] 同一个 handle 上 nack(false) 两次只留一条死信：一次放弃 = 一条痕', async () => {
    const address = addrOf('double-nack');
    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(false);
    await taken!.nack(false); // 重试 / 兜底代码里常见：再放弃一次

    const entries = await dlqOf(address);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(sent.id);
    expect((await mailbox.status(address)).unreadCount).toBe(0);
  });

  it('[语义] nack(true) 之后再 nack(false) 不作数：回队的消息不会同时在队列和 DLQ 里', async () => {
    const address = addrOf('requeue-then-drop');
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(true); // 明确不是放弃：回队
    await taken!.nack(false); // 迟到 / 重复的放弃

    expect(await dlqOf(address)).toEqual([]);
    expect((await mailbox.status(address)).unreadCount).toBe(1); // 还能被正常消费
  });

  it('[语义] nack(false) 之后再 nack(true) 不作数：已放弃的消息不会又回到队列', async () => {
    const address = addrOf('drop-then-requeue');
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(false);
    await taken!.nack(true);

    expect((await mailbox.status(address)).unreadCount).toBe(0);
    expect(await dlqOf(address)).toHaveLength(1);
  });

  it('[语义] ack 之后再 nack 不作数：处理成功的消息不得留下死信', async () => {
    const address = addrOf('ack-then-nack');
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.ack();
    await taken!.nack(false);
    await taken!.nack(true);

    expect(await dlqOf(address)).toEqual([]);
    expect((await mailbox.status(address)).unreadCount).toBe(0);
    expect((await mailbox.status(address)).inFlightCount).toBe(0);
  });

  it('[语义] nack(false) 之后再 ack 不作数：迟到的 ack 不会抹掉别人的 in-flight', async () => {
    const address = addrOf('nack-then-ack');
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 2 } });

    const first = await mailbox.fetch(address, { manualAck: true });
    const second = await mailbox.fetch(address, { manualAck: true });
    await first!.nack(false);
    await first!.ack(); // 迟到的处置：按 id 结算就会误伤第二个人手里的消息

    expect((await mailbox.status(address)).inFlightCount).toBe(1);
    await second!.ack();
    expect((await mailbox.status(address)).inFlightCount).toBe(0);
    expect(await dlqOf(address)).toHaveLength(1);
  });

  it('[语义] 处置没落定就不写死信：消息已被 stale 重投，旧 handle 的 nack(false) 不算放弃', async () => {
    const address = addrOf('stale-handle-drop');
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const stale = await mailbox.fetch(address, { manualAck: true, ackTimeout: 5 }) // 它自己的租约只有 5ms
    await tick(30) // 到期（按这份租约自己的到期时刻判，不是下一个取信者传的值）
    // 第二次 fetch 顺手做清扫：消息先回队，再被新消费者取走
    const fresh = await mailbox.fetch(address, { manualAck: true, ackTimeout: 60_000 })
    expect(fresh).not.toBeNull();

    await stale!.nack(false); // 迟到的放弃：手里那条已经不归它了

    expect(await dlqOf(address)).toEqual([]);
    expect((await mailbox.status(address)).inFlightCount).toBe(1); // 新消费者还在处理

    await fresh!.ack();
    expect((await mailbox.status(address)).inFlightCount).toBe(0);
  });

  it('[语义] 已被 clear() 丢弃的消息：nack(false) 既不复活动作也不留死信', async () => {
    const address = addrOf('cleared');
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const taken = await mailbox.fetch(address, { manualAck: true });
    await provider.clear();
    await taken!.nack(false);

    expect(await dlqOf(address)).toEqual([]);
    expect((await mailbox.status(address)).unreadCount).toBe(0);
    expect((await mailbox.status(address)).inFlightCount).toBe(0);
  });

  it('[语义] 守卫按 handle 而非按消息：stale 重投后新消费者的 nack(false) 照旧留一条痕', async () => {
    const address = addrOf('redelivered-drop');
    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const stale = await mailbox.fetch(address, { manualAck: true, ackTimeout: 5 }) // 它自己的租约只有 5ms
    await tick(30) // 到期：下一次取信会把它收回重投
    const fresh = await mailbox.fetch(address, { manualAck: true, ackTimeout: 60_000 });
    await fresh!.nack(false);

    const entries = await dlqOf(address);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(sent.id);
    expect(stale).not.toBeNull();
  });

  it('[语义] 每条被放弃的消息各留一条痕：守卫不能把不同消息的死信吃掉', async () => {
    const address = addrOf('many-drops');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const posted = await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: i } });
      ids.push(posted.id);
    }

    for (let i = 0; i < 3; i++) {
      const taken = await mailbox.fetch(address, { manualAck: true });
      await taken!.nack(false);
      await taken!.nack(false); // 每个 handle 都重复一次
    }

    const entries = await dlqOf(address);
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.id).sort()).toEqual(ids.slice().sort());
  });
});

describe('[语义] 拉取侧留痕的顺序：先处置、后 DLQ', () => {
  let mailbox: Mailbox;
  let provider: MemoryProvider;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    provider = MemoryProvider.createIsolated();
    mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    await mailbox.start();
    provider.enableDeadLetterQueue();
  });

  afterEach(async () => {
    await mailbox.stop();
    vi.restoreAllMocks();
  });

  it('[语义] 归档发生时消息已经不在队列 / in-flight 里（与内核 _giveUpDelivery 同一顺序）', async () => {
    const address = addrOf('order');
    const seen: Array<{ unreadCount: number; inFlightCount: number }> = [];
    const original = (provider as unknown as {
      archiveDeadLetter: (...args: unknown[]) => void;
    }).archiveDeadLetter.bind(provider);
    (provider as unknown as { archiveDeadLetter: (...args: unknown[]) => void }).archiveDeadLetter = (
      ...args: unknown[]
    ) => {
      const status = provider.bus.getStatus(address);
      seen.push({ unreadCount: status.unreadCount, inFlightCount: status.inFlightCount });
      return original(...args);
    };

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(false);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ unreadCount: 0, inFlightCount: 0 });
    expect((await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true }))).toHaveLength(1);
  });

  it('[语义] 归档失败不能吞掉处置：消息照样离开队列，失败被记录而不是把 nack 打断', async () => {
    const address = addrOf('archive-throws');
    (provider as unknown as { archiveDeadLetter: () => void }).archiveDeadLetter = () => {
      throw new Error('dead-letter sink is on fire');
    };

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    const taken = await mailbox.fetch(address, { manualAck: true });

    await expect(taken!.nack(false)).resolves.toBeUndefined();

    const status = await mailbox.status(address);
    expect(status.unreadCount).toBe(0);
    expect(status.inFlightCount).toBe(0); // 不能卡在 in-flight 等着被 stale 扫描无限重投
    expect(console.error).toHaveBeenCalled();
  });

  it('[事实] 记录内容不受幂等改造影响：reason / attempts / round / 不带旧句柄', async () => {
    const address = addrOf('record-shape');
    const sent = await mailbox.post({
      from: 'mem://s@bus/u',
      to: address,
      body: { n: 1 },
      meta: { order: 42 },
    });

    // 真的走两轮取信、第 2 轮才放弃：计数由内核 / 队列写，**不是**调用方手填的
    //（拉取侧没有订阅重试链，所以「链内次数」是 1，跨轮计数才是 2）。
    const first = await mailbox.fetch(address, { manualAck: true });
    await first!.nack(true);
    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(false);
    await taken!.nack(false);

    const [entry] = await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true });
    expect(entry.id).toBe(sent.id);
    expect(entry.headers?.['mbx-dead-letter']).toBe('true');
    expect(entry.headers?.['mbx-dead-letter-reason']).toBe('consumer-nack');
    expect(entry.headers?.['mbx-dead-letter-attempts']).toBe('1');
    expect(entry.headers?.['mbx-dead-letter-round']).toBe('2');
    expect(entry.headers?.['mbx-dead-letter-topic']).toBe(address);
    expect(entry.meta).toEqual({ order: 42 });
    expect(typeof (entry as unknown as { nack?: unknown }).nack).toBe('undefined');
    expect(typeof (entry as unknown as { ack?: unknown }).ack).toBe('undefined');
  });

  it('[事实] 没开死信队列时，重复 nack 也毫无副作用（默认行为不变）', async () => {
    provider.disableDeadLetterQueue();
    const address = addrOf('dlq-off');
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });

    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(false);
    await taken!.nack(false);
    await taken!.ack();

    expect((await mailbox.status(address)).unreadCount).toBe(0);
    expect((await mailbox.status(address)).inFlightCount).toBe(0);
    expect(await provider.listAddresses()).not.toContain(`${address}_dlq`);
  });
});
