import { describe, it, expect } from 'vitest';
import { copyForPeek, normalizePeekLimit, parseMailboxAddress } from './utils';
import { InvalidFetchOptionsError, InvalidMailboxAddressError } from '../error';

/**
 * 内核中立的那三件小事：地址解析、`fetch` 选项、peek 副本。
 *
 * `mem:` 的折叠与 query / hash 拒绝不在这里（那是 scheme 的政策，见 `lib/scheme-address.test.ts`）——
 * D5 的分界线就是这条：**内核只做 URL 解析**，语法与 topic 键归 provider。
 */

describe('parseMailboxAddress：内核只看 URL，地址语法归 scheme（D5）', () => {
  it('query / fragment 不在内核这一层被禁止——那是 scheme 的策略', () => {
    // 内核若统一禁止，就等于把 `mem:` 的折叠规则当成 URL 的通用规则：
    // 一个「query 参与寻址」的 scheme（`q:a?thread=1` ≠ `q:a`）就没有合法的 query 可用。
    const withQuery = parseMailboxAddress('q:inbox?thread=1', 'post()')
    expect(withQuery.search).toBe('?thread=1')
    expect(withQuery.href).toBe('q:inbox?thread=1')

    const withHash = parseMailboxAddress('q:inbox#frag', 'subscribe()')
    expect(withHash.hash).toBe('#frag')

    // 内核也不折叠字段：这两个地址在 kernel 眼里就是两个 href（是否等价由 provider 决定）。
    expect(parseMailboxAddress('q:a?thread=1').href).not.toBe(parseMailboxAddress('q:a').href)
  })

  it('内核只做 URL 解析：解析不了的地址报成地址错误', () => {
    expect(() => parseMailboxAddress('not an address', 'status()')).toThrowError(
      InvalidMailboxAddressError,
    )
  })

  it('接受字符串与 URL：内核**保留写法**，不替 scheme 折叠（D5）', () => {
    // `mem:` 与 `mem://` 两种写法在内核里是两个不同的 URL——把它们折成同一个 topic 是那个 scheme
    // 的折叠政策（`mailbox-memory` 的 `lib/scheme-address.ts`），不是 URL 层的规则。
    expect(parseMailboxAddress('mem:a@example.com/inbox').href).toBe('mem:a@example.com/inbox');
    expect(parseMailboxAddress('mem:a@example.com/inbox').href)
      .not.toBe(parseMailboxAddress(new URL('mem://a@example.com/inbox')).href);
  });

  it('无法解析的输入报成地址错误，并保留原始 cause', () => {
    try {
      parseMailboxAddress('not a mailbox address', 'subscribe()')
      expect.unreachable('不可解析的地址应该抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMailboxAddressError);
      expect((error as InvalidMailboxAddressError).message).toContain('in subscribe()');
      expect((error as InvalidMailboxAddressError).address).toBe('not a mailbox address');
      expect((error as InvalidMailboxAddressError).cause).toBeInstanceOf(Error);
    }
  });
});

describe('peek 选项与副本', () => {
  it('normalizePeekLimit：省略与 Infinity 表示「整个队列」', () => {
    expect(normalizePeekLimit(undefined)).toBeUndefined();
    expect(normalizePeekLimit(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizePeekLimit(0)).toBe(0);
  });

  it('normalizePeekLimit：负数、小数、NaN 都是调用方的 bug', () => {
    for (const bad of [-1, -Infinity, 2.5, Number.NaN]) {
      expect(() => normalizePeekLimit(bad)).toThrowError(InvalidFetchOptionsError);
    }
    try {
      normalizePeekLimit(-3)
    } catch (error) {
      expect((error as InvalidFetchOptionsError).code).toBe('MBX_INVALID_FETCH_OPTIONS');
    }
  });

  it('copyForPeek：信封与可克隆的 body 都是新引用', () => {
    const message = {
      id: 'm-1',
      from: new URL('mem://a@example.com/u'),
      to: new URL('mem://b@example.com/inbox'),
      body: { deep: { n: 1 }, list: [1, 2, 3] },
      headers: { 'req-id': 'r-1' },
      meta: { tag: 'x' },
    };

    const copy = copyForPeek(message);

    expect(copy).not.toBe(message);
    expect(copy.from).not.toBe(message.from);
    expect(copy.from.href).toBe(message.from.href);
    expect(copy.to).not.toBe(message.to);
    expect(copy.body).not.toBe(message.body);
    expect(copy.body.deep).not.toBe(message.body.deep);
    expect(copy.body).toEqual(message.body);
    expect(copy.headers).not.toBe(message.headers);
    expect(copy.meta).not.toBe(message.meta);
  });

  it('copyForPeek：body 里有克隆不了的东西时退回共享引用，不抛错', () => {
    class Widget {
      constructor(public n: number) {}
    }
    const message = { id: 'm-2', body: { widget: new Widget(1), fn: () => 1 } };

    const copy = copyForPeek(message);

    expect(copy).not.toBe(message);
    expect(copy.body).toBe(message.body); // 文档化：信封隔离，嵌套字段共享引用
  });
});
