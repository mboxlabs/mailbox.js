import { describe, it, expect, beforeEach } from 'vitest';
import { Mailbox, MemoryProvider } from './index';
import { InvalidMailboxAddressError } from './error';

/**
 * issue#4 第 2 点：`getCanonicalMailboxAddressIdentifier()` 只用
 * `protocol // user@host pathname`，`search` / `hash` 被丢掉 —— 于是
 * `mem:q@example.com/inbox?thread=1` 和 `mem:q@example.com/inbox` 是**同一个** topic。
 *
 * 采用的修法是 issue 里倾向的那一种：明确禁止。地址语义留在 path 里，
 * query / hash 不参与寻址，因此带它们的地址在**每个**入口都直接报错
 * （而不是「看起来能用、实际共用一条队列」）。
 */
describe('地址里的 query / hash 会被拒绝（不再静默塌成同一个 topic）', () => {
  let mailbox: Mailbox;
  let provider: MemoryProvider;

  beforeEach(async () => {
    provider = MemoryProvider.createIsolated();
    mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    await mailbox.start();
  });

  it('post() 到带 query 的地址：抛错，且什么都没投递', async () => {
    await expect(
      mailbox.post({ from: 'mem:x@example.com/u', to: 'mem:q@example.com/inbox?thread=1', body: { n: 2 } }),
    ).rejects.toThrowError(InvalidMailboxAddressError);

    // 旧行为：不带 query 的 status 也会看到这封信（两条业务流共用一条队列）
    const status = await mailbox.status('mem:q@example.com/inbox');
    expect(status.exists).toBe(false);
    expect(status.unreadCount).toBe(0);
  });

  it('post() 到带 hash 的地址：抛错', async () => {
    await expect(
      mailbox.post({ from: 'mem:x@example.com/u', to: 'mem:h@example.com/inbox#frag', body: { n: 1 } }),
    ).rejects.toThrow(/hash "#frag" would be dropped by address canonicalization/);
    expect((await mailbox.status('mem:h@example.com/inbox')).exists).toBe(false);
  });

  it('from 地址同样受约束（两端规则要一致）', async () => {
    await expect(
      mailbox.post({ from: 'mem:x@example.com/u?route=direct', to: 'mem:q@example.com/inbox', body: {} }),
    ).rejects.toThrowError(InvalidMailboxAddressError);
  });

  it('subscribe() / fetch() / status() 也拒绝：同一个地址不能只在一个入口合法', async () => {
    expect(() => mailbox.subscribe('mem:s@example.com/inbox?thread=1', () => {}))
      .toThrowError(InvalidMailboxAddressError);
    await expect(mailbox.fetch('mem:s@example.com/inbox?thread=1')).rejects.toThrowError(InvalidMailboxAddressError);
    await expect(mailbox.status('mem:s@example.com/inbox?thread=1')).rejects.toThrowError(InvalidMailboxAddressError);

    // 订阅侧曾经是最隐蔽的一半：订阅 `?thread=1` 实际订阅的是裸地址的队列
    expect((await mailbox.status('mem:s@example.com/inbox')).subscriberCount).toBe(0);
    expect((await mailbox.status('mem:s@example.com/inbox')).exists).toBe(false);
  });

  it('错误信息给出「会被合并进哪个地址」，一眼看出塌缩', async () => {
    const error = await mailbox.post({ from: 'mem:x@example.com/u', to: 'mem:q@example.com/inbox?thread=1', body: {} })
      .then(() => null)
      .catch((e: unknown) => e as InvalidMailboxAddressError);

    expect(error?.message).toContain('mem:q@example.com/inbox?thread=1');
    expect(error?.message).toContain('mem://q@example.com/inbox');
    expect(error?.message).toContain('in post()');
  });

  it('绕过 Mailbox 直接用 provider 也拦得住（canonicalization 自己就是防线）', async () => {
    await expect(provider.send({
      id: 'direct-1',
      from: new URL('mem://x@example.com/u'),
      to: new URL('mem://q@example.com/inbox?thread=1'),
      body: {},
      headers: {},
      meta: {},
    })).rejects.toThrowError(InvalidMailboxAddressError);

    await expect(provider.fetch(new URL('mem://q@example.com/inbox#frag')))
      .rejects.toThrowError(InvalidMailboxAddressError);

    expect(() => provider.subscribe(new URL('mem://q@example.com/inbox?thread=1'), () => {}))
      .toThrowError(InvalidMailboxAddressError);

    // 三个入口都没留下队列/订阅痕迹
    expect(provider.bus.getStatus('mem://q@example.com/inbox').exists).toBe(false);
  });

  it('逻辑分区写在 path 里：两个分区各自一条队列、各自取回', async () => {
    const threadOne = 'mem:q@example.com/inbox/thread-1';
    const threadTwo = 'mem:q@example.com/inbox/thread-2';

    await mailbox.post({ from: 'mem:x@example.com/u', to: threadOne, body: { thread: 1 } });
    await mailbox.post({ from: 'mem:x@example.com/u', to: threadTwo, body: { thread: 2 } });

    expect((await mailbox.status(threadOne)).unreadCount).toBe(1);
    expect((await mailbox.status(threadTwo)).unreadCount).toBe(1);

    // 取一个分区不会动到另一个分区
    expect((await mailbox.fetch(threadOne))?.body).toEqual({ thread: 1 });
    expect((await mailbox.status(threadOne)).unreadCount).toBe(0);
    expect((await mailbox.status(threadTwo)).unreadCount).toBe(1);
    expect((await mailbox.fetch(threadTwo))?.body).toEqual({ thread: 2 });
  });

  it('opaque 与 hierarchical 两种写法仍是同一个地址（既有等价性不能被拒掉）', async () => {
    await mailbox.post({ from: 'mem:x@example.com/u', to: 'mem:eq@example.com/inbox', body: { n: 1 } });
    expect((await mailbox.status('mem://eq@example.com/inbox')).unreadCount).toBe(1);
    expect((await mailbox.fetch('mem://eq@example.com/inbox'))?.body).toEqual({ n: 1 });
  });
});
