import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Mailbox,
  MailboxProvider,
  MemoryEventBus,
  MemoryProvider,
  MailMessage,
  AckableMailMessage,
} from './index';
import { InvalidFetchOptionsError, UnsupportedCapabilityError } from './error';

/**
 * issue#4 第 3 点：缺 `peek`（只读不取）。
 *
 * 之前最接近的做法是 `fetch(addr, { manualAck: true })` 然不 ack —— 消息会进 in-flight
 * （默认 30s 超时后重投），语义上不是只读，还会干扰正常消费者的 `unreadCount` / `inFlightCount`。
 * 现在 `fetch(addr, { peek: true, limit?: n })` 返回副本快照：不出队、不建 in-flight、
 * 不刷活动时间；provider 不支持时明确报错，不会静默退化成普通取信。
 */

async function makeIsolatedMailbox() {
  const provider = MemoryProvider.createIsolated();
  const mailbox = new Mailbox();
  mailbox.registerProvider(provider);
  await mailbox.start();
  return { mailbox, provider };
}

describe('fetch({ peek: true })：只读快照', () => {
  let mailbox: Mailbox;

  beforeEach(async () => {
    ({ mailbox } = await makeIsolatedMailbox());
  });

  it('返回队列头部的全部消息，且不消耗任何东西', async () => {
    const address = 'mem:peek-basic@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 1 } });
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 2 } });

    const snapshot = await mailbox.fetch(address, { peek: true });

    expect(Array.isArray(snapshot)).toBe(true);
    expect(snapshot.map((m) => m.body)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(snapshot.map((m) => 'ack' in m)).toEqual([false, false]); // 只读快照不可 ack

    const status = await mailbox.status(address);
    expect(status.unreadCount).toBe(2);
    expect(status.inFlightCount).toBe(0);
  });

  it('反复快照都是同一份内容；之后的 fetch 仍按 FIFO 拿到同样的消息', async () => {
    const address = 'mem:peek-stable@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 1 } });
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 2 } });

    const first = await mailbox.fetch(address, { peek: true });
    const second = await mailbox.fetch(address, { peek: true });

    expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
    expect((await mailbox.fetch(address))?.body).toEqual({ n: 1 });
    expect((await mailbox.fetch(address))?.body).toEqual({ n: 2 });
    expect(await mailbox.fetch(address)).toBeNull();
  });

  it('不刷 lastActivityTime：诊断页轮询不会把空闲地址刷成「刚刚有活动」', async () => {
    const address = 'mem:peek-activity@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 1 } });

    const before = await mailbox.status(address);
    await mailbox.fetch(address, { peek: true });
    await mailbox.fetch(address, { peek: true });
    const after = await mailbox.status(address);

    expect(after.lastActivityTime).toBe(before.lastActivityTime);
  });

  it('返回副本：改它改不到队列里的那一份', async () => {
    const address = 'mem:peek-copy@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { deep: { n: 1 } } });

    const [copy] = await mailbox.fetch(address, { peek: true });
    (copy.body as { deep: { n: number } }).deep.n = 99;
    copy.headers = { tampered: true };

    const [again] = await mailbox.fetch(address, { peek: true });
    expect(again.body).toEqual({ deep: { n: 1 } });

    const consumed = await mailbox.fetch(address);
    expect(consumed?.body).toEqual({ deep: { n: 1 } });
  });

  it('limit：0 是空快照，超过队列长度只返回实有条数，省略 = 整个队列', async () => {
    const address = 'mem:peek-limit@example.com/inbox';
    for (const n of [1, 2, 3]) {
      await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n } });
    }

    expect(await mailbox.fetch(address, { peek: true, limit: 0 })).toEqual([]);
    expect((await mailbox.fetch(address, { peek: true, limit: 2 })).map((m) => m.body.n)).toEqual([1, 2]);
    expect((await mailbox.fetch(address, { peek: true, limit: 99 })).length).toBe(3);
    expect((await mailbox.fetch(address, { peek: true })).length).toBe(3);
    expect((await mailbox.status(address)).unreadCount).toBe(3);
  });

  it('非法 limit 报错，不静默取全部', async () => {
    const address = 'mem:peek-bad-limit@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: {} });

    await expect(mailbox.fetch(address, { peek: true, limit: -1 })).rejects.toThrowError(InvalidFetchOptionsError);
    await expect(mailbox.fetch(address, { peek: true, limit: 1.5 })).rejects.toThrowError(InvalidFetchOptionsError);
    expect((await mailbox.status(address)).unreadCount).toBe(1);
  });

  it('空队列 / 不存在的地址都是空数组（不是 null，也不是错误）', async () => {
    expect(await mailbox.fetch('mem:peek-empty@example.com/inbox', { peek: true })).toEqual([]);
    expect(await mailbox.fetch('mem:not-even-a-valid-address', { peek: true, limit: 5 })).toEqual([]);
  });

  it('peek + manualAck 自相矛盾：直接报错，绝不「猜」调用方想要哪个', async () => {
    const address = 'mem:peek-conflict@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: {} });

    await expect(mailbox.fetch(address, { peek: true, manualAck: true }))
      .rejects.toThrowError(InvalidFetchOptionsError);
    await expect(mailbox.fetch(address, { peek: true, manualAck: true }))
      .rejects.toThrow(/contradictory/);

    expect((await mailbox.status(address)).unreadCount).toBe(1); // 报错没消耗消息
    expect((await mailbox.status(address)).inFlightCount).toBe(0); // 也没偷偷建 in-flight
  });

  it('peek: false 就是普通取信（不是「只读取 0 条」）', async () => {
    const address = 'mem:peek-false@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 1 } });

    const message = await mailbox.fetch(address, { peek: false });
    expect(message?.body).toEqual({ n: 1 });
    expect((await mailbox.status(address)).unreadCount).toBe(0);
  });

  it('只涵盖等待中的消息：in-flight 的那份仍归那个消费者', async () => {
    const address = 'mem:peek-vs-inflight@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 1 } });
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 2 } });

    const inflight = (await mailbox.fetch(address, { manualAck: true })) as AckableMailMessage;
    expect(inflight.body).toEqual({ n: 1 });

    const snapshot = await mailbox.fetch(address, { peek: true });
    expect(snapshot.map((m) => m.body.n)).toEqual([2]); // 不会把别人手上的消息也列出来

    await inflight.nack(true);
    expect((await mailbox.fetch(address, { peek: true })).map((m) => m.body.n)).toEqual([1, 2]);
  });

  it('peek 不会让消息从别的消费者眼前消失（只读 = 不改变投递状态）', async () => {
    const address = 'mem:peek-other-consumer@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 1 } });

    const auditor = await mailbox.fetch(address, { peek: true });
    const consumer = await mailbox.fetch(address, { manualAck: true });

    expect(auditor.map((m) => m.body.n)).toEqual([1]);
    expect(consumer?.body).toEqual({ n: 1 });
    await consumer?.ack();
    expect(await mailbox.fetch(address, { peek: true })).toEqual([]);
  });

  it('地址非法时和取信一样被拒（peek 不是绕过校验的口子）', async () => {
    await expect(mailbox.fetch('mem:peek-invalid@example.com/inbox?thread=1', { peek: true }))
      .rejects.toThrowError(/would be dropped by address canonicalization/);
  });

  it('快照之间互相独立：改一条不影响另一条', async () => {
    const address = 'mem:peek-independent@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { shared: { n: 1 } } });

    const first = await mailbox.fetch(address, { peek: true });
    const second = await mailbox.fetch(address, { peek: true });

    (first[0].body as { shared: { n: number } }).shared.n = 42;
    expect((second[0].body as { shared: { n: number } }).shared.n).toBe(1);
  });
});

describe('MemoryEventBus.peek：总线层的只读快照', () => {
  it('不出队、不建 in-flight、不刷活动时间', () => {
    const bus = new MemoryEventBus();
    const topic = 'mem://bus-peek/inbox';
    bus.publish(topic, { id: 'p-1', from: new URL('mem://s@e/u'), to: new URL(topic), body: { n: 1 } } as MailMessage);

    const activityBefore = bus.getStatus(topic).lastActivityTime;
    const snapshot = bus.peek(topic);

    expect(snapshot.map((m) => m.id)).toEqual(['p-1']);
    expect(bus.getStatus(topic)).toEqual({
      exists: true,
      unreadCount: 1,
      inFlightCount: 0,
      overdueInFlightCount: 0,
      oldestOverdueMs: 0,
      lastActivityTime: activityBefore,
      subscriberCount: 0,
    });

    // 消息仍能被正常取走
    expect(bus.fetchAndForget(topic)?.id).toBe('p-1');
    expect(bus.peek(topic)).toEqual([]);
  });

  it('返回的是副本：观察者改不到队列里的消息', () => {
    const bus = new MemoryEventBus();
    const topic = 'mem://bus-peek-copy/inbox';
    const original = { id: 'p-2', from: new URL('mem://s@e/u'), to: new URL(topic), body: { n: 1 } } as MailMessage;
    bus.publish(topic, original);

    const [copy] = bus.peek(topic);
    copy.body.n = 99;

    expect(original.body.n).toBe(1);
    expect(bus.fetchAndForget(topic)?.body.n).toBe(1);
  });
});

describe('provider 不支持 peek 时必须报错，不能静默降级成取信', () => {
  class TransportProvider extends MailboxProvider {
    public queued: MailMessage[] = [];

    constructor() {
      super('transport');
    }

    protected async _send(message: MailMessage): Promise<void> {
      this.queued.push(message);
    }

    protected _subscribe(): () => void {
      return () => {};
    }

    protected async _unsubscribe(): Promise<void> {}

    protected async _fetch(): Promise<MailMessage | null> {
      return this.queued.shift() ?? null;
    }
  }

  it('没实现 _peek 的 provider：fetch({ peek: true }) 抛 UnsupportedCapabilityError，消息一条都没少', async () => {
    const provider = new TransportProvider();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);

    await mailbox.post({ from: 'transport:a@e/u', to: 'transport:b@e/inbox', body: { n: 1 } });

    await expect(mailbox.fetch('transport:b@e/inbox', { peek: true }))
      .rejects.toThrowError(UnsupportedCapabilityError);
    await expect(mailbox.fetch('transport:b@e/inbox', { peek: true }))
      .rejects.toThrow(/does not support 'read-only peek/);

    expect(provider.queued.length).toBe(1); // 关键：没有「以为在只读、实际被取走」
  });

  it('实现了 _peek 的 provider：基类把 limit 归一后交下去', async () => {
    const { mailbox, provider } = await makeIsolatedMailbox();
    const spy = vi.spyOn(provider as unknown as { _peek: (address: URL, options?: { limit?: number }) => Promise<MailMessage[]> }, '_peek')

    const address = 'mem:peek-spy@example.com/inbox';
    await mailbox.post({ from: 'mem:a@e/u', to: address, body: {} });
    await mailbox.fetch(address, { peek: true, limit: Infinity });

    expect(spy).toHaveBeenCalledWith(expect.any(URL), { limit: undefined });
  });
});
