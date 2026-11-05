import { describe, it, expect, beforeEach } from 'vitest';
import { Mailbox, MailboxProvider, MemoryProvider } from './index';
import { InvalidMailboxAddressError } from './error';
import type { MailMessage } from './interfaces';

/**
 * 地址这件事上的两层（issue#4 → D5）。
 *
 * issue#4 的坑是真的：折叠地址会把 query / hash 丢掉，于是
 * `mem:q@example.com/inbox?thread=1` 与 `mem:q@example.com/inbox` 塌成同一条队列——
 * 「看起来能用、实际共用一条队列」。当时的修法是**内核一律禁止** query / hash。
 *
 * 那条评论过界了（D5）：内核的折叠规则只对某一种折叠方式成立。换个 scheme——比如 query
 * 本身就参与寻址（`q:a?thread=1` 与 `q:a` 是两个信箱）——「禁止 query」就是把一个 scheme
 * 的语法冒充成所有人的语法。所以这里两层分开测：
 *
 * - **内核层**：地址是不透明 URL。内核只解析、只保证「所有入口同一个判定」；
 *   它不折叠、不判等、不禁止 query / fragment。
 * - **scheme 层**：`mem:` 声明自己的语法（`addressGrammar`）并在**每个**入口执行它：
 *   `mem:` ≡ `mem://`（容错写法）、query / fragment 直接拒绝。
 */

// ------------------------------------------------------------------ 内核层

/** 一个故意「让 query 参与寻址」的 scheme：内核不能拦它，也不能把它的地址折叠掉。 */
class QueryAddressingProvider extends MailboxProvider {
  /** href → 队列。键就是整套 href：这个 scheme 认为 query / fragment 都是地址的一部分。 */
  public readonly boxes = new Map<string, MailMessage[]>();

  constructor() {
    super('q');
  }

  public readonly addressGrammar = {
    scheme: 'q',
    authority: 'forbidden' as const,
    identity: '整套 href 就是身份：query / fragment 也参与寻址',
    query: 'addressing' as const,
    fragment: 'addressing' as const,
    equivalences: ['（无）这个 scheme 不做任何等价折叠'],
  };

  // 本例只看投递边界（`post`）与状态边界（`status`），订阅/取信不是这里的重点。
  protected _subscribe(): void {}
  protected async _unsubscribe(): Promise<void> {}
  protected async _fetch(): Promise<null> {
    return null;
  }

  protected async _send(message: MailMessage): Promise<void> {
    const key = message.to.href;
    const box = this.boxes.get(key) ?? [];
    box.push(message);
    this.boxes.set(key, box);
  }

  public async peekCount(address: string): Promise<number> {
    return (this.boxes.get(new URL(address).href) ?? []).length;
  }
}

describe('内核不碰地址内部（D5）：只解析 URL，不折叠、不判等、不禁止 query', () => {
  let mailbox: Mailbox;
  let provider: QueryAddressingProvider;

  beforeEach(async () => {
    provider = new QueryAddressingProvider();
    mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    await mailbox.start();
  });

  it('带 query 的地址合法：内核把它原样交给该 scheme 的 provider', async () => {
    await mailbox.post({ from: 'q:sender/u', to: 'q:inbox?thread=1', body: { n: 1 } });

    // 内核没有改写它：provider 收到的就是那串 href
    expect(await provider.peekCount('q:inbox?thread=1')).toBe(1);
  });

  it('query 不同 = 不同信箱：内核没有把 query 折掉', async () => {
    await mailbox.post({ from: 'q:sender/u', to: 'q:inbox?thread=1', body: { n: 1 } });
    await mailbox.post({ from: 'q:sender/u', to: 'q:inbox?thread=2', body: { n: 2 } });
    await mailbox.post({ from: 'q:sender/u', to: 'q:inbox', body: { n: 3 } });

    expect([
      await provider.peekCount('q:inbox?thread=1'),
      await provider.peekCount('q:inbox?thread=2'),
      await provider.peekCount('q:inbox'),
    ]).toEqual([1, 1, 1]);
  });

  it('内核也不禁止 fragment', async () => {
    await mailbox.post({ from: 'q:sender/u', to: 'q:inbox#frag', body: {} });
    expect(await provider.peekCount('q:inbox#frag')).toBe(1);
  });

  it('内核保证的是「一致性」：同一个地址串在每个入口都判同一个信箱', async () => {
    const address = 'q:consistent?thread=1';
    const seen: string[] = [];
    // 这个 provider 没实现 _subscribe / _fetch，所以入口只到 post / status：
    // 关键点不是它们成功，而是**不会只在一个入口合法**。
    await mailbox.post({ from: 'q:sender/u', to: address, body: {} });
    const status = await mailbox.status(address).catch((error: unknown) => {
      seen.push(`status threw ${(error as Error).name}`);
      return null;
    });
    if (status) {
      seen.push(`status ${status.state}`);
    }
    expect(seen).toEqual(['status unknown']); // 没声明 status 能力：显式 unknown，而不是「另一个地址」
  });
});

// ---------------------------------------------------------------- scheme 层

describe('`mem:` 声明并执行自己的地址语法（`addressGrammar`）', () => {
  let provider: MemoryProvider;

  beforeEach(() => {
    provider = MemoryProvider.createIsolated();
  });

  it('声明是可查的：authority 可选、query / fragment 拒绝、`mem:` ≡ `mem://`', () => {
    expect(provider.addressGrammar).toMatchObject({
      scheme: 'mem',
      authority: 'optional',
      query: 'rejected',
      fragment: 'rejected',
    });
    expect(provider.addressGrammar.equivalences.join(' ')).toContain('mem://');
  });

  it('声明与行为一致：declared rejected ⇒ 每个入口都拒，且错误点名会被合并进的地址', async () => {
    // 这正是 issue#4 的坑：折叠会丢掉 query / hash，两条业务流静默共用一条队列。
    // `mem:` 选的策略是拒绝（声明里写着 `query: 'rejected'`）。
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

    expect(provider.bus.getStatus('mem://q@example.com/inbox').exists).toBe(false);

    const error = await provider
      .send({
        id: 'direct-2',
        from: new URL('mem://x@example.com/u'),
        to: new URL('mem://q@example.com/inbox?thread=1'),
        body: {},
        headers: {},
        meta: {},
      })
      .then(() => null)
      .catch((e: unknown) => e as InvalidMailboxAddressError);
    // 错误要点名「会被并进哪个地址」（这正是 issue#4 的坑）；合并目标是折叠后的形式。
    expect(error?.message).toContain('mem://q@example.com/inbox?thread=1');
    expect(error?.message).toContain('merging this address with "mem://q@example.com/inbox"');
  });

  it('声明的等价规则真的成立：`mem:` 与 `mem://` 是同一个信箱', async () => {
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    await mailbox.start();

    await mailbox.post({ from: 'mem:x@example.com/u', to: 'mem:eq@example.com/inbox', body: { n: 1 } });
    expect((await mailbox.status('mem://eq@example.com/inbox')).unreadCount).toBe(1);
    expect((await mailbox.fetch('mem://eq@example.com/inbox'))?.body).toEqual({ n: 1 });
  });
});

describe('门面 + `mem:`：邮箱语义留在 path 里（issue#4 的实际后果）', () => {
  let mailbox: Mailbox;

  beforeEach(async () => {
    mailbox = new Mailbox();
    mailbox.registerProvider(MemoryProvider.createIsolated());
    await mailbox.start();
  });

  it('post() 到带 query 的地址：报错来自 `mem:`，且什么都没投递', async () => {
    await expect(
      mailbox.post({ from: 'mem:x@example.com/u', to: 'mem:q@example.com/inbox?thread=1', body: { n: 2 } }),
    ).rejects.toThrowError(InvalidMailboxAddressError);

    // 旧行为：不带 query 的 status 也会看到这封信（两条业务流共用一条队列）
    const status = await mailbox.status('mem:q@example.com/inbox');
    expect(status.exists).toBe(false);
    expect(status.unreadCount).toBe(0);
  });

  it('from 端同规则：两端不能一端合法一端静默', async () => {
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
    expect((await mailbox.status('mem:s@example.com/inbox'))['mem.subscriberCount']).toBe(0);
    expect((await mailbox.status('mem:s@example.com/inbox')).exists).toBe(false);
  });

  it('逻辑分区写在 path 里：两个分区各自一条队列、各自取回', async () => {
    const threadOne = 'mem:q@example.com/inbox/thread-1';
    const threadTwo = 'mem:q@example.com/inbox/thread-2';

    await mailbox.post({ from: 'mem:x@example.com/u', to: threadOne, body: { thread: 1 } });
    await mailbox.post({ from: 'mem:x@example.com/u', to: threadTwo, body: { thread: 2 } });

    expect((await mailbox.status(threadOne)).unreadCount).toBe(1);
    expect((await mailbox.status(threadTwo)).unreadCount).toBe(1);

    expect((await mailbox.fetch(threadOne))?.body).toEqual({ thread: 1 });
    expect((await mailbox.status(threadOne)).unreadCount).toBe(0);
    expect((await mailbox.status(threadTwo)).unreadCount).toBe(1);
    expect((await mailbox.fetch(threadTwo))?.body).toEqual({ thread: 2 });
  });
});
