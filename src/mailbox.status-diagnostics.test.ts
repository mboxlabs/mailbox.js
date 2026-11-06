import { describe, it, expect, beforeEach } from 'vitest';
import {
  Mailbox,
  MailboxProvider,
  MemoryEventBus,
  MemoryProvider,
  MailMessage,
  MailboxStatus,
} from './index';
import type { IMailboxProvider } from './index';

/**
 * issue#4 第 1 点 + 第 3 点的后半段：
 * - `status()` 对**任何**地址都回 `online` + 0，诊断页分不出「地址不存在」和「地址空闲」；
 * - `lastActivityTime` 是 `undefined`，`JSON.stringify` 之后整个字段消失；
 * - 没有全量快照，诊断页只能一个地址一个地址地猜。
 */
describe('status() 认得「这个地址存不存在」', () => {
  let mailbox: Mailbox;
  let provider: MemoryProvider;

  beforeEach(async () => {
    provider = MemoryProvider.createIsolated();
    mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    await mailbox.start();
  });

  it('从未碰过的地址：state 是 unknown、exists 是 false，计数字段仍然给出（0）', async () => {
    const status = await mailbox.status('mem:not-even-a-valid-address');

    expect(status.state).toBe('unknown');
    expect(status.exists).toBe(false);
    expect(status.unreadCount).toBe(0);
    expect(status.inFlightCount).toBe(0);
    expect(status['mem.subscriberCount']).toBe(0);
    expect(status.message).toContain('No queue, subscription or activity is known');
  });

  it('issue 里那两个例子都不再报 online', async () => {
    for (const address of ['mem:not-even-a-valid-address', 'mem:anything@example.com/nope']) {
      const status = await mailbox.status(address);
      expect(status.state).not.toBe('online');
      expect(status.exists).toBe(false);
    }
  });

  it('「存在但空闲」与「不存在」是两回事：投过又取空的地址仍是 online', async () => {
    const address = 'mem:drained@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 1 } });
    await mailbox.fetch(address);

    const status = await mailbox.status(address);
    expect(status.exists).toBe(true);
    expect(status.state).toBe('online');
    expect(status.unreadCount).toBe(0); // 空闲
    expect(status.lastActivityTime).toBeTypeOf('string');
  });

  it('只有订阅、一条消息都没有的地址也算存在（订阅就是「这个地址有人用」）', async () => {
    const address = 'mem:subscribed-only@example.com/inbox';
    await mailbox.subscribe(address, () => {});

    const status = await mailbox.status(address);
    expect(status.exists).toBe(true);
    expect(status.state).toBe('online');
    expect(status['mem.subscriberCount']).toBe(1);
    expect(status.unreadCount).toBe(0);
  });

  it('lastActivityTime 用 null 而不是 undefined：JSON 往返后字段还在', async () => {
    const status = await mailbox.status('mem:json-roundtrip@example.com/inbox');

    expect(status.lastActivityTime).toBeNull();

    const wire = JSON.parse(JSON.stringify(status)) as MailboxStatus;
    expect('lastActivityTime' in wire).toBe(true);
    expect(wire.lastActivityTime).toBeNull();
    expect(wire.exists).toBe(false);
    expect(wire.state).toBe('unknown');
  });

  it('有活动之后 lastActivityTime 是 ISO 字符串，重复查询不会把它刷新（status 也是只读的）', async () => {
    const address = 'mem:read-only-status@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 1 } });

    const first = await mailbox.status(address);
    const second = await mailbox.status(address);

    expect(first.lastActivityTime).toBeTypeOf('string');
    expect(second.lastActivityTime).toBe(first.lastActivityTime);
  });

  it('in-flight 的消息让地址「存在」，即使队列已经空了', async () => {
    const address = 'mem:inflight-only@example.com/inbox';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: { n: 1 } });
    await mailbox.fetch(address, { manualAck: true });

    const status = await mailbox.status(address);
    expect(status.exists).toBe(true);
    expect(status.unreadCount).toBe(0);
    expect(status.inFlightCount).toBe(1);
  });

  it('clear() 之后地址回到「不存在」；但仍有订阅者的地址继续算存在', async () => {
    const cleared = 'mem:cleared@example.com/inbox';
    const subscribed = 'mem:cleared-but-subscribed@example.com/inbox';
    await mailbox.subscribe(subscribed, () => {});
    await mailbox.post({ from: 'mem:a@example.com/u', to: cleared, body: { n: 1 } });
    await mailbox.post({ from: 'mem:a@example.com/u', to: subscribed, body: { n: 1 } });

    await mailbox.clear();

    expect((await mailbox.status(cleared)).exists).toBe(false);
    expect((await mailbox.status(cleared)).state).toBe('unknown');
    expect((await mailbox.status(subscribed)).exists).toBe(true); // 订阅表没被 clear 拆掉（issue#3 的语义）
    expect((await mailbox.status(subscribed))['mem.subscriberCount']).toBe(1);
  });

  it('provider 不支持 status 时仍然只说 unknown，不冒充 exists: false（问不到 ≠ 不存在）', async () => {
    const bare = {
      protocol: 'nostatus',
      send: async () => undefined,
      subscribe: () => ({ id: 's', address: new URL('nostatus:a@b/i'), status: 'active', unsubscribe: async () => {} }),
      fetch: async () => null,
      generateId: () => 'id',
    } as unknown as IMailboxProvider;

    const box = new Mailbox();
    box.registerProvider(bare);

    const status = await box.status('nostatus:x@example.com/inbox');
    expect(status.state).toBe('unknown');
    expect(status.exists).toBeUndefined();
    expect(status.message).toBe("The 'nostatus' provider does not support status queries.");
  });

  it('地址解析与校验对 status() 同样生效（非法形式不会被当成「另一个地址」）', async () => {
    await expect(mailbox.status('mem:q@example.com/inbox?thread=1')).rejects.toThrowError(/MBX_INVALID_ADDRESS|Invalid mailbox address/);
    await expect(mailbox.status('definitely not a url')).rejects.toThrowError(/not a parseable URL/);
  });
});

describe('bus.getStatus 的 exists / lastActivityTime（总线层同一套语义）', () => {
  it('未知 topic：exists false、lastActivityTime null；订阅或发布之后翻真', () => {
    const bus = new MemoryEventBus();
    const topic = 'mem://bus-level/inbox';

    expect(bus.getStatus(topic)).toEqual({
      exists: false,
      unreadCount: 0,
      inFlightCount: 0,
      overdueInFlightCount: 0,
      oldestOverdueMs: 0,
      parkedCount: 0,
      oldestParkedMs: 0,
      lastActivityTime: null,
      subscriberCount: 0,
    });

    const unsubscribe = bus.subscribe(topic, () => {});
    expect(bus.getStatus(topic)).toMatchObject({ exists: true, subscriberCount: 1, lastActivityTime: expect.any(String) });

    unsubscribe();
    expect(bus.knows(topic)).toBe(true); // 订阅表清空后仍留着 lastActivity 痕迹，地址仍算「存在」
    expect(bus.getStatus(topic)).toMatchObject({ exists: true, subscriberCount: 0 });
  });

  it('knows() 与 listTopics() 反映总线认得的地址（排序、去重）', () => {
    const bus = new MemoryEventBus();
    const b = 'mem://list-b/inbox';
    const a = 'mem://list-a/inbox';

    bus.publish(b, { id: 'b-1', to: new URL(b), from: new URL('mem://s@e/u'), body: {} } as MailMessage);
    bus.subscribe(a, () => {});

    expect(bus.knows(a)).toBe(true);
    expect(bus.knows('mem://list-never/inbox')).toBe(false);
    expect(bus.listTopics()).toEqual([a, b]);

    bus.clear();
    expect(bus.listTopics()).toEqual([a]); // 只剩订阅留下的痕迹
  });
});

/**
 * issue#4 要求的配套能力：`status()` 无参 = 全量 topic 快照。
 */
describe('Mailbox#status()（无参）/ snapshot()：全量快照', () => {
  it('列出所有 topic 的状态，按地址排序，只聚合核心具名字段', async () => {
    const mailbox = new Mailbox();
    mailbox.registerProvider(MemoryProvider.createIsolated());
    await mailbox.start();

    await mailbox.post({ from: 'mem:a@example.com/u', to: 'mem:snapshot-b@example.com/inbox', body: { n: 1 } });
    await mailbox.post({ from: 'mem:a@example.com/u', to: 'mem:snapshot-b@example.com/inbox', body: { n: 2 } });
    await mailbox.post({ from: 'mem:a@example.com/u', to: 'mem:snapshot-a@example.com/inbox', body: { n: 3 } });
    await mailbox.fetch('mem:snapshot-b@example.com/inbox', { manualAck: true });

    const snap = await mailbox.status();

    expect(snap.state).toBe('online');
    expect(snap.protocols).toEqual(['mem']);
    expect(snap.addressCount).toBe(2);
    expect(snap.unreadCount).toBe(2); // snapshot-a: 1 + snapshot-b: 2 - 1 (in-flight)
    expect(snap.inFlightCount).toBe(1);
    expect(snap.addresses.map((entry) => entry.address))
      .toEqual(['mem://snapshot-a@example.com/inbox', 'mem://snapshot-b@example.com/inbox']);
    expect(snap.addresses[0]).toMatchObject({ protocol: 'mem', state: 'online', exists: true, unreadCount: 1, inFlightCount: 0 });
    expect(snap.addresses[1]).toMatchObject({ state: 'online', exists: true, unreadCount: 1, inFlightCount: 1 });
    expect(snap.takenAt).toBeTypeOf('string');
  });

  it('空 mailbox（没有 provider、也没有任何 topic）给出可判读的快照', async () => {
    const mailbox = new Mailbox();
    const snap = await mailbox.status();

    expect(snap.state).toBe('unknown');
    expect(snap.protocols).toEqual([]);
    expect(snap.addressCount).toBe(0);
    expect(snap.addresses).toEqual([]);
    expect(snap.unsupportedProviders).toEqual([]);
  });

  it('注册了 provider 但没有任何 topic：快照是 online + 空列表（不是 unknown）', async () => {
    const mailbox = new Mailbox();
    mailbox.registerProvider(MemoryProvider.createIsolated());

    const snap = await mailbox.status();
    expect(snap.state).toBe('online');
    expect(snap.addressCount).toBe(0);
    expect(snap.addresses).toEqual([]);
  });

  it('不能枚举自身地址的 provider 记在 unsupportedProviders，快照降级为 degraded', async () => {
    class RemoteProvider extends MailboxProvider {
      private queued: MailMessage[] = [];

      constructor() {
        super('remote');
      }

      protected async _send(message: MailMessage): Promise<void> {
        this.queued.push(message);
      }

      protected _subscribe(): () => void {
        return () => {}
      }

      protected async _unsubscribe(): Promise<void> {}

      protected async _fetch(): Promise<MailMessage | null> {
        return this.queued.shift() ?? null;
      }
    }

    const mailbox = new Mailbox();
    mailbox.registerProvider(MemoryProvider.createIsolated());
    mailbox.registerProvider(new RemoteProvider());
    await mailbox.post({ from: 'mem:a@example.com/u', to: 'mem:snap-visible@example.com/inbox', body: {} });
    await mailbox.post({ from: 'remote:a@example.com/u', to: 'remote:snap-hidden@example.com/inbox', body: {} });

    const snap = await mailbox.status();

    expect(snap.protocols).toEqual(['mem', 'remote']);
    expect(snap.unsupportedProviders).toEqual(['remote']);
    expect(snap.state).toBe('degraded');
    expect(snap.addressCount).toBe(1); // 只有 mem 那份能看见
    expect(snap.addresses[0].protocol).toBe('mem');
  });

  it('snapshot() 与无参 status() 是同一份视图（两个入口，一套语义）', async () => {
    const mailbox = new Mailbox();
    mailbox.registerProvider(MemoryProvider.createIsolated());
    await mailbox.post({ from: 'mem:a@example.com/u', to: 'mem:snapshot-eq@example.com/inbox', body: {} });

    const viaStatus = await mailbox.status();
    const viaMethod = await mailbox.snapshot();

    expect({ ...viaMethod, takenAt: undefined }).toEqual({ ...viaStatus, takenAt: undefined });
  });

  it('快照只覆盖这个 Mailbox 的 provider：隔离 bus 之间互不可见', async () => {
    const a = new Mailbox();
    a.registerProvider(MemoryProvider.createIsolated());
    const b = new Mailbox();
    b.registerProvider(MemoryProvider.createIsolated());

    await a.post({ from: 'mem:a@example.com/u', to: 'mem:snapshot-isolation@example.com/inbox', body: {} });

    expect((await a.status()).addressCount).toBe(1);
    expect((await b.status()).addressCount).toBe(0);
    expect((await b.status()).state).toBe('online');
  });

  it('快照列出的每个地址都能原样再查一次（`listAddresses` 的唯一契约）', async () => {
    const mailbox = new Mailbox();
    const provider = MemoryProvider.createIsolated();
    mailbox.registerProvider(provider);
    const address = 'mem:snapshot-roundtrip@example.com/inbox/thread-1';
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: {} });

    const [entry] = (await mailbox.status()).addresses;
    const direct = await mailbox.status(entry.address);

    // 内核不规范化它：列出的就是 provider 自己认得的那个写法，喂回去也认得。
    expect(entry.address).toBe(provider.bus.listTopics()[0]);
    expect(provider.bus.knows(entry.address)).toBe(true);
    expect(direct.unreadCount).toBe(entry.unreadCount);
    expect(direct.state).toBe(entry.state);
  });
});
