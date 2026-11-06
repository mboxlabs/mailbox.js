/**
 * issue#3 —— `MemoryEventBus` 的实例边界与状态清理。
 *
 * 要锁住两件事：
 * 1. **默认行为不变**：不带参数构造的 `MemoryProvider` 仍然共享进程级 bus（"模拟服务端"语义），
 *    `stop()` 默认仍然不清队列。已有用户依赖这两点，所以这里连"共享带来的串台"也断言下来，
 *    而不是只断言隔离路径。
 * 2. **可隔离、可清理**：需要隔离时有明确入口（私有 bus / scope / 注入 bus），需要清理时有
 *    `MessageQueue#clear()` → `MemoryEventBus#clear()` → `MemoryProvider#clear()` →
 *    `Mailbox#clear()` / `stop({ purge: true })` 这条完整链路。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mailbox } from '../mailbox';
import { MailboxProvider } from './MailboxProvider';
import { DEFAULT_MEMORY_SCOPE, MemoryEventBus, MemoryProvider } from './memory';
import type { IMailboxProvider, MailMessage } from '../interfaces';

const SENDER = 'mem://sender@example.com/outbox';

let seq = 0;
/** 即便跑在共享 bus 上，用例之间也不能互相看到对方的 topic。 */
const addrOf = (name: string): string => `mem://iso${seq++}-${name}@bus/inbox`;

const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const retriable = (message = 'upstream down'): Error =>
  Object.assign(new Error(message), { isRetriable: true });

function newMailbox(provider: IMailboxProvider): Mailbox {
  const mailbox = new Mailbox();
  mailbox.registerProvider(provider);
  return mailbox;
}

/** 直接喂给 `MemoryEventBus` 的裸消息（跳过 provider 层）。 */
const busMsg = (id: string, topic: string): MailMessage => ({
  id,
  from: new URL('mem://probe@example.com/out'),
  to: new URL(topic),
  body: { id },
});

/** 只统计 issue#3 相关的那条告警，避免被无关噪音放过 / 误判。 */
const reuseWarnings = (calls: unknown[][]): unknown[][] =>
  calls.filter((args) => String(args[0]).includes('shared by more than one Mailbox'));

describe('issue#3: MemoryEventBus 实例边界与状态清理', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('MemoryEventBus：实例与 scope 注册表', () => {
    it('getInstance() 不带参数返回同一实例，scope 就是 DEFAULT_MEMORY_SCOPE', () => {
      const shared = MemoryEventBus.getInstance();

      expect(shared).toBe(MemoryEventBus.getInstance());
      expect(DEFAULT_MEMORY_SCOPE).toBe('');
      expect(shared.scope).toBe(DEFAULT_MEMORY_SCOPE);
      expect(MemoryEventBus.getInstance('')).toBe(shared); // 显式空串 = 默认那份
    });

    it('getInstance(scope)：同 scope 同一实例，不同 scope 互不相同，且都不等于默认实例', () => {
      const a1 = MemoryEventBus.getInstance('suite-a');
      const a2 = MemoryEventBus.getInstance('suite-a');
      const b = MemoryEventBus.getInstance('suite-b');

      expect(a1).toBe(a2);
      expect(a1).not.toBe(b);
      expect(a1).not.toBe(MemoryEventBus.getInstance());
      expect(a1.scope).toBe('suite-a');
      expect(b.scope).toBe('suite-b');
    });

    it('new MemoryEventBus() 可直接构造，且不会登记进 scope 注册表', () => {
      const own = new MemoryEventBus();
      const other = new MemoryEventBus();
      const labeled = new MemoryEventBus('labeled');

      expect(own).not.toBe(other);
      expect(own).not.toBe(MemoryEventBus.getInstance()); // 手工实例 ≠ 默认单例
      expect(own.scope).toBe(DEFAULT_MEMORY_SCOPE);
      expect(labeled.scope).toBe('labeled');
      expect(MemoryEventBus.getInstance('labeled')).not.toBe(labeled); // 注册表里另起一份
    });

    it('不同 bus 实例之间：订阅、队列、in-flight、活动时间全互不可见', async () => {
      const x = new MemoryEventBus();
      const y = new MemoryEventBus();
      const topic = 'mem://same-topic-both-buses/inbox'; // 同名 topic，故意撞

      let xHits = 0;
      await x.subscribe(topic, () => {
        xHits++;
      });

      const deliveries = x.publish(topic, busMsg('x-1', topic));
      expect(deliveries).toHaveLength(1); // x 上有订阅者：走广播
      await Promise.all(deliveries!);
      expect(xHits).toBe(1);

      // y 上没人订阅同一个 topic：publish 只能入队，绝不会被 x 的订阅者接走
      expect(y.publish(topic, busMsg('y-1', topic))).toBeNull();
      expect(y.getStatus(topic)).toMatchObject({ unreadCount: 1, inFlightCount: 0, subscriberCount: 0 });
      expect(x.getStatus(topic)).toMatchObject({ unreadCount: 0, inFlightCount: 0, subscriberCount: 1 });

      // 取消息也不会跨 bus
      expect(y.fetchAndForget(topic)?.id).toBe('y-1');
      expect(x.fetchAndForget(topic)).toBeUndefined();

      // in-flight 也是各自一份
      y.publish(topic, busMsg('y-2', topic));
      expect(y.fetchForAck(topic, { leaseTimeout: 1000 })?.id).toBe('y-2');
      expect(y.getStatus(topic).inFlightCount).toBe(1);
      expect(x.getStatus(topic).inFlightCount).toBe(0);

      // lastActivity 各自一份：y 没碰过的 topic 在 y 上是空的
      x.publish('mem://only-on-x/inbox', busMsg('x-2', 'mem://only-on-x/inbox'));
      expect(x.getStatus('mem://only-on-x/inbox').lastActivityTime).toBeTypeOf('string');
      expect(y.getStatus('mem://only-on-x/inbox').lastActivityTime).toBeNull();
    });

    it('同一个 bus 实例上的两个 provider 仍然互通（共享"服务端"能力没被拆掉）', async () => {
      const bus = new MemoryEventBus();
      const addr = addrOf('shared-bus');
      const A = newMailbox(new MemoryProvider(null, bus));
      const B = newMailbox(new MemoryProvider(null, bus));
      await A.start();
      await B.start();

      let hits = 0;
      await B.subscribe(addr, () => {
        hits++;
      });
      await A.post({ from: SENDER, to: addr, body: { n: 1 } });
      await settle();

      expect(hits).toBe(1);
      expect((await A.status(addr))['mem.subscriberCount']).toBe(1); // 订阅表是这份 bus 共有的
    });
  });

  describe('MemoryProvider：隔离入口', () => {
    it('默认构造仍然共用进程级单例 bus，跨 Mailbox 投递照旧可达（向后兼容）', async () => {
      const addr = addrOf('default-shared');
      const a = new MemoryProvider();
      const b = new MemoryProvider();
      expect(a.bus).toBe(MemoryEventBus.getInstance());
      expect(a.bus).toBe(b.bus);

      const A = newMailbox(a);
      const B = newMailbox(b);
      await A.start();
      await B.start();

      let hits = 0;
      await B.subscribe(addr, () => {
        hits++;
      });
      await A.post({ from: SENDER, to: addr, body: { n: 1 } });
      await settle();

      expect(hits).toBe(1);
    });

    it('默认 bus 上队列也是共享的：B 能 fetch 走 A 的消息（把既有代价断言下来）', async () => {
      const addr = addrOf('default-steal');
      const A = newMailbox(new MemoryProvider());
      const B = newMailbox(new MemoryProvider());
      await A.start();
      await B.start();

      await A.post({ from: SENDER, to: addr, body: { from: 'A' } });

      expect((await B.fetch(addr))?.body).toEqual({ from: 'A' }); // 共享 bus 的既有语义
      expect((await A.status(addr)).unreadCount).toBe(0);
    });

    it('createIsolated()：广播不串台、队列不串台、订阅数也不串台', async () => {
      const addr = addrOf('isolated-broadcast');
      const A = newMailbox(MemoryProvider.createIsolated());
      const B = newMailbox(MemoryProvider.createIsolated());
      await A.start();
      await B.start();

      let bHits = 0;
      await B.subscribe(addr, () => {
        bHits++;
      });

      await A.post({ from: SENDER, to: addr, body: { n: 1 } });
      await settle();

      expect(bHits).toBe(0);
      expect((await B.status(addr)).unreadCount).toBe(0);
      expect((await B.status(addr))['mem.subscriberCount']).toBe(1); // B 自己的订阅还在
      expect((await A.status(addr))['mem.subscriberCount']).toBe(0); // A 看不见 B 的订阅
    });

    it('createIsolated()：B 既 fetch 不到 A 的消息，也不影响 A 取回它', async () => {
      const addr = addrOf('isolated-queue');
      const A = newMailbox(MemoryProvider.createIsolated());
      const B = newMailbox(MemoryProvider.createIsolated());
      await A.start();
      await B.start();

      await A.post({ from: SENDER, to: addr, body: { from: 'A' } });

      expect(await B.fetch(addr)).toBeNull();
      expect((await B.status(addr)).unreadCount).toBe(0);
      const mine = await A.fetch(addr);
      expect(mine?.body).toEqual({ from: 'A' });
    });

    it('createIsolated()：每次调用都是新 bus，且都不是默认那份', () => {
      const a = MemoryProvider.createIsolated();
      const b = MemoryProvider.createIsolated();

      expect(a.bus).not.toBe(b.bus);
      expect(a.bus).not.toBe(MemoryEventBus.getInstance());
      expect(a.bus.scope).toBe(DEFAULT_MEMORY_SCOPE); // 私有 bus 不属于任何 scope
    });

    it('createIsolated()：A.stop() 不影响 B 的订阅与投递', async () => {
      const addr = addrOf('isolated-stop');
      const A = newMailbox(MemoryProvider.createIsolated());
      const B = newMailbox(MemoryProvider.createIsolated());
      await A.start();
      await B.start();

      let bHits = 0;
      await B.subscribe(addr, () => {
        bHits++;
      });

      await A.stop();
      await B.post({ from: SENDER, to: addr, body: { n: 1 } });
      await settle();

      expect(bHits).toBe(1);
    });

    it('createIsolated(retry)：重试策略照常生效，重试耗尽后消息只回自己那份 bus', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const addr = addrOf('isolated-retry');
      const provider = MemoryProvider.createIsolated({ maxAttempts: 3, baseDelay: 1 });
      const A = newMailbox(provider);
      const B = newMailbox(MemoryProvider.createIsolated());
      await A.start();
      await B.start();

      let calls = 0;
      await A.subscribe(addr, () => {
        calls++;
        throw retriable();
      });

      await A.post({ from: SENDER, to: addr, body: { n: 1 } });
      await settle(80);

      expect(calls).toBe(3); // maxAttempts=3：三次尝试后放弃
      expect((await A.status(addr)).unreadCount).toBe(1); // 回自己的队列，由 fetch 兜底
      expect((await B.status(addr)).unreadCount).toBe(0); // 别的实例看不到
      errorSpy.mockRestore();
    });

    it('订阅失败的回队只落在自己的 bus（与 issue#1/#2 的兜底语义联动）', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const addr = addrOf('isolated-requeue');
      const A = newMailbox(MemoryProvider.createIsolated());
      const B = newMailbox(MemoryProvider.createIsolated());
      await A.start();
      await B.start();

      await A.subscribe(addr, () => {
        throw retriable();
      });
      await A.post({ from: SENDER, to: addr, body: { n: 1 } });
      await settle();

      expect((await A.fetch(addr))?.body).toEqual({ n: 1 }); // A 自己能取回
      expect((await B.status(addr)).unreadCount).toBe(0);
      errorSpy.mockRestore();
    });

    it('forScope()：同 scope 互通，异 scope 隔离，且都独立于默认 bus', async () => {
      const scope = `suite-${seq++}`;
      const otherScope = `suite-${seq++}-other`;
      const addr = addrOf('scoped');

      const providerA = MemoryProvider.forScope(scope);
      const providerB = MemoryProvider.forScope(scope);
      const A = newMailbox(providerA);
      const B = newMailbox(providerB);
      const Elsewhere = newMailbox(MemoryProvider.forScope(otherScope));
      const Default = newMailbox(new MemoryProvider());
      await A.start();
      await B.start();
      await Elsewhere.start();
      await Default.start();

      expect(providerA.bus).toBe(providerB.bus);
      expect(providerA.bus).toBe(MemoryEventBus.getInstance(scope));
      expect(providerA.bus).not.toBe(MemoryEventBus.getInstance());
      expect(providerA.bus.scope).toBe(scope);

      let hits = 0;
      await B.subscribe(addr, () => {
        hits++;
      });
      await A.post({ from: SENDER, to: addr, body: { n: 1 } });
      await settle();

      expect(hits).toBe(1);
      expect((await Elsewhere.status(addr)).unreadCount).toBe(0);
      expect((await Elsewhere.status(addr))['mem.subscriberCount']).toBe(0);
      expect((await Default.status(addr)).unreadCount).toBe(0);
    });

    it('构造函数注入 bus：provider.bus 就是注入的那份；不注入则回落默认单例', () => {
      const bus = new MemoryEventBus();

      expect(new MemoryProvider(null, bus).bus).toBe(bus);
      expect(new MemoryProvider({ maxAttempts: 2, baseDelay: 1 }, bus).bus).toBe(bus);
      expect(new MemoryProvider().bus).toBe(MemoryEventBus.getInstance());
      expect(new MemoryProvider(null).bus).toBe(MemoryEventBus.getInstance());
      expect(new MemoryProvider(undefined, undefined).bus).toBe(MemoryEventBus.getInstance());
    });
  });

  describe('清理：MemoryQueue → MemoryEventBus → provider → Mailbox', () => {
    it('bus.clear(topic) 只清该 topic 的消息（含 in-flight），订阅表原封不动', async () => {
      const bus = new MemoryEventBus();
      const provider = new MemoryProvider(null, bus);
      const mailbox = newMailbox(provider);
      await mailbox.start();

      const kept = addrOf('bus-clear-kept');
      const dropped = addrOf('bus-clear-dropped');
      await mailbox.post({ from: SENDER, to: kept, body: { n: 1 } });
      await mailbox.post({ from: SENDER, to: dropped, body: { n: 1 } });
      await mailbox.post({ from: SENDER, to: dropped, body: { n: 2 } });

      await mailbox.fetch(dropped, { manualAck: true });
      expect((await mailbox.status(dropped)).inFlightCount).toBe(1);

      expect(bus.clear(dropped)).toBe(2); // 1 条等待 + 1 条 in-flight
      expect((await mailbox.status(dropped)).unreadCount).toBe(0);
      expect((await mailbox.status(dropped)).inFlightCount).toBe(0);
      expect((await mailbox.status(kept)).unreadCount).toBe(1);
      expect((await mailbox.status(dropped)).lastActivityTime).toBeNull();
      expect((await mailbox.status(dropped)).state).toBe('unknown'); // 消息与活动记录都没了：这个地址在 bus 上不再存在
      expect((await mailbox.status(dropped)).exists).toBe(false);
      expect((await mailbox.status(dropped))['mem.subscriberCount']).toBe(0);
    });

    it('bus.clear() 之后，被清理的 in-flight 消息迟到 ack / nack(requeue) 都不会复活它', async () => {
      const bus = new MemoryEventBus();
      const topic = 'mem://late-settlement/inbox';
      bus.publish(topic, busMsg('late-1', topic));

      const inflight = bus.fetchForAck(topic, { leaseTimeout: 1000 });
      expect(inflight?.id).toBe('late-1');
      const key = bus.locate('late-1')[0]!.key; // 份号：在飞时查得
      expect(bus.clear(topic)).toBe(1);

      inflight!.ack();
      inflight!.nack(true); // 消费侧的迟到 nack
      // 发送侧的迟到 nack：拿份号动手（发送方的名字已经不能用来结算）
      expect(bus.nack(key, true)).toBe(false);

      expect(bus.getStatus(topic)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
      expect(bus.fetchAndForget(topic)).toBeUndefined();
    });

    it('bus.clear() 清掉全部 topic 的消息与活动时间，并幂等', async () => {
      const bus = new MemoryEventBus();
      const a = 'mem://clear-all-a/inbox';
      const b = 'mem://clear-all-b/inbox';

      bus.publish(a, busMsg('a-1', a));
      bus.publish(b, busMsg('b-1', b));
      bus.publish(b, busMsg('b-2', b));
      bus.fetchForAck(b, { leaseTimeout: 1000 });

      expect(bus.clear()).toBe(3); // 2 条等待 + 1 条 in-flight
      expect(bus.getStatus(a)).toMatchObject({ exists: false, unreadCount: 0, inFlightCount: 0, lastActivityTime: null });
      expect(bus.getStatus(b)).toMatchObject({ exists: false, unreadCount: 0, inFlightCount: 0, lastActivityTime: null });
      expect(bus.clear()).toBe(0);
      expect(bus.clear('never-seen')).toBe(0);
    });

    it('clear 只清消息不拆订阅：清理后新消息照常投递给原订阅者', async () => {
      const bus = new MemoryEventBus();
      const topic = 'mem://clear-keeps-listener/inbox';

      let hits = 0;
      bus.subscribe(topic, () => {
        hits++;
      });
      bus.publish(topic, busMsg('before', topic)); // 有订阅者 → 广播
      await settle();
      expect(hits).toBe(1);

      expect(bus.clear(topic)).toBe(0);
      expect(bus.getStatus(topic).subscriberCount).toBe(1); // 订阅表未被拆

      bus.publish(topic, busMsg('after', topic));
      await settle();
      expect(hits).toBe(2);
    });

    it('MemoryProvider#clear() 只清自己那份 bus', async () => {
      const addr = addrOf('provider-clear');
      const A = newMailbox(MemoryProvider.createIsolated());
      const B = newMailbox(MemoryProvider.createIsolated());
      await A.start();
      await B.start();

      await A.post({ from: SENDER, to: addr, body: { n: 1 } });
      await B.post({ from: SENDER, to: addr, body: { n: 2 } });

      await A.clear();

      expect((await A.status(addr)).unreadCount).toBe(0);
      expect((await B.status(addr)).unreadCount).toBe(1);
    });

    it('Mailbox#clear() 对每个 provider 各调一次 clear()；没实现 clear 的 provider 被跳过', async () => {
      const memProvider = new MemoryProvider();
      const memClear = vi.spyOn(memProvider, 'clear');
      const otherClear = vi.fn().mockResolvedValue(undefined);
      const withoutClear: IMailboxProvider = {
        protocol: 'noclear',
        send: vi.fn(),
        subscribe: vi.fn(),
        fetch: vi.fn(),
        generateId: () => 'id',
      };

      const mailbox = new Mailbox();
      mailbox.registerProvider(memProvider);
      mailbox.registerProvider({
        protocol: 'other',
        clear: otherClear,
        send: vi.fn(),
        subscribe: vi.fn(),
        fetch: vi.fn(),
        generateId: () => 'id',
      });
      mailbox.registerProvider(withoutClear);

      await expect(mailbox.clear()).resolves.toBeUndefined();
      expect(memClear).toHaveBeenCalledTimes(1);
      expect(otherClear).toHaveBeenCalledTimes(1);
    });

    it('没有 provider、或重复调用 clear() 都不报错（幂等）', async () => {
      const mailbox = newMailbox(MemoryProvider.createIsolated());
      await mailbox.start();
      await mailbox.post({ from: SENDER, to: addrOf('clear-idempotent'), body: { n: 1 } });

      await expect(mailbox.clear()).resolves.toBeUndefined();
      await expect(mailbox.clear()).resolves.toBeUndefined();
      expect(await new Mailbox().clear()).toBeUndefined(); // 空 Mailbox
    });

    it('Mailbox#clear() 保留订阅：clear 之后旧订阅照常收到新消息', async () => {
      const mailbox = newMailbox(MemoryProvider.createIsolated());
      await mailbox.start();

      const queued = addrOf('keep-sub-queue');
      const live = addrOf('keep-sub-live');

      let hits = 0;
      const sub = await mailbox.subscribe(live, () => {
        hits++;
      });

      await mailbox.post({ from: SENDER, to: queued, body: { n: 1 } });
      expect((await mailbox.status(queued)).unreadCount).toBe(1);

      await mailbox.clear();

      expect((await mailbox.status(queued)).unreadCount).toBe(0);
      expect(sub.status).toBe('active');

      await mailbox.post({ from: SENDER, to: live, body: { n: 2 } });
      await settle();
      expect(hits).toBe(1);
    });

    it('stop() 默认不清队列；stop({ purge: false }) 与 stop() 一致（老行为）', async () => {
      const scope = `legacy-${seq++}`;
      const addr = addrOf('stop-keeps-queue');

      for (const options of [undefined, { purge: false }] as const) {
        const first = newMailbox(MemoryProvider.forScope(scope));
        await first.start();
        await first.post({ from: SENDER, to: addr, body: { n: 1 } });
        await first.stop(options);

        const second = newMailbox(MemoryProvider.forScope(scope));
        await second.start();
        expect((await second.status(addr)).unreadCount).toBe(1);
        await second.clear(); // 收尾，别把残留留给下一个用例
      }
    });

    it('stop({ purge: true })：先拆订阅，再清空队列（含 in-flight）', async () => {
      const mailbox = newMailbox(MemoryProvider.createIsolated());
      await mailbox.start();

      const live = addrOf('stop-purge-live');
      const queued = addrOf('stop-purge-queue');

      const sub = await mailbox.subscribe(live, () => {});
      await mailbox.post({ from: SENDER, to: live, body: { n: 0 } }); // 有订阅者：走广播，不入队
      await settle();
      expect((await mailbox.status(live)).unreadCount).toBe(0);

      await mailbox.post({ from: SENDER, to: queued, body: { n: 1 } });
      await mailbox.post({ from: SENDER, to: queued, body: { n: 2 } });
      await mailbox.fetch(queued, { manualAck: true });
      expect((await mailbox.status(queued)).unreadCount).toBe(1);
      expect((await mailbox.status(queued)).inFlightCount).toBe(1);

      await mailbox.stop({ purge: true });

      expect(sub.status).toBe('closed');
      expect((await mailbox.status(queued)).unreadCount).toBe(0);
      expect((await mailbox.status(queued)).inFlightCount).toBe(0);
      expect((await mailbox.status(live)).unreadCount).toBe(0);
    });

    it('共享 bus 上 clear() 是进程级的：同 scope 的 A.clear() 会清掉 B 的队列（文档化代价）', async () => {
      const scope = `shared-purge-${seq++}`;
      const addr = addrOf('shared-purge');
      const A = newMailbox(MemoryProvider.forScope(scope));
      const B = newMailbox(MemoryProvider.forScope(scope));
      await A.start();
      await B.start();

      await B.post({ from: SENDER, to: addr, body: { n: 1 } });
      await A.clear();

      expect((await B.status(addr)).unreadCount).toBe(0);
    });

    it('provider 没实现 clear() 时 stop({ purge: true }) 不报错；基类 clear() 是 no-op', async () => {
      class NoPurgeProvider extends MailboxProvider {
        protected async _send(): Promise<void> {}
        protected _subscribe(): () => void {
          return () => {};
        }
        protected async _unsubscribe(): Promise<void> {}
        protected async _fetch() {
          return null;
        }
      }

      const provider = new NoPurgeProvider('nopurge');
      await expect(provider.clear()).resolves.toBeUndefined(); // 基类默认实现

      const mailbox = newMailbox(provider);
      await mailbox.start();
      await expect(mailbox.clear()).resolves.toBeUndefined();
      await expect(mailbox.stop({ purge: true })).resolves.toBeUndefined();
    });
  });

  describe('同一个 provider 实例被多个 Mailbox 复用', () => {
    it('复用会拆掉另一个 Mailbox 的订阅；行为不变但必须告警，且只告警一次', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const shared = new MemoryProvider();

      const A = newMailbox(shared);
      const B = newMailbox(shared);
      const C = newMailbox(shared); // 第三个复用者也不能再吵一遍
      await A.start();
      await B.start();
      await C.start();

      const addr = addrOf('shared-provider-reuse');
      let bHits = 0;
      await B.subscribe(addr, () => {
        bHits++;
      });

      await A.stop(); // 只停 A
      await B.post({ from: SENDER, to: addr, body: { n: 1 } });
      await settle();

      // 订阅表挂在 provider 上，`A.stop()` 拆掉的就是它的全部订阅。
      expect(bHits).toBe(0);
      expect(reuseWarnings(warn.mock.calls)).toHaveLength(1);
    });

    it('同一个 Mailbox 内重复注册、或各 Mailbox 各自持有时都不该告警', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const provider = new MemoryProvider();
      const mailbox = new Mailbox();
      mailbox.registerProvider(provider);
      mailbox.registerProvider(provider);
      mailbox.registerProvider(provider);

      const A = newMailbox(new MemoryProvider());
      const B = newMailbox(new MemoryProvider());
      await A.start();
      await B.start();
      await A.stop();
      await B.stop();

      expect(reuseWarnings(warn.mock.calls)).toHaveLength(0);
    });

    it('用来识别复用的标记不污染 provider：symbol 键、不可枚举', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const provider = new MemoryProvider();
      new Mailbox().registerProvider(provider);
      new Mailbox().registerProvider(provider);

      const symbols = Object.getOwnPropertySymbols(provider);
      expect(symbols).toHaveLength(1);
      expect(
        symbols.filter((symbol) => Object.getOwnPropertyDescriptor(provider, symbol)?.enumerable),
      ).toHaveLength(0);
      expect(JSON.stringify(provider)).not.toContain('owner');
      expect(reuseWarnings(warn.mock.calls)).toHaveLength(1);
    });
  });
});
