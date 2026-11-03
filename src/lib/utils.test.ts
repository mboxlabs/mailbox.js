import { describe, it, expect } from 'vitest';
import {
  assertLosslessMailboxAddress,
  copyForPeek,
  getCanonicalMailboxAddressIdentifier,
  normalizePeekLimit,
  parseMailboxAddress,
} from './utils';
import { InvalidFetchOptionsError, InvalidMailboxAddressError } from '../error';

/**
 * issue#4：规范化会静默丢掉 query / hash，两个逻辑地址塌成同一个 topic。
 * 修法是「在入口拒绝」：地址语义必须留在 path 里。
 */
describe('地址规范化与无损校验', () => {
  it('canonical id 由 protocol // user@host path 组成（不带 query / hash，抹掉密码）', () => {
    expect(getCanonicalMailboxAddressIdentifier(new URL('mem://bob@example.com:8080/inbox')))
      .toBe('mem://bob@example.com:8080/inbox');
    expect(getCanonicalMailboxAddressIdentifier(new URL('mem://bob:secret@example.com/inbox')))
      .toBe('mem://bob@example.com/inbox');
  });

  it('opaque 形式（mem:user@host/path）与 hierarchical 形式（mem://user@host/path）落到同一个 topic', () => {
    expect(getCanonicalMailboxAddressIdentifier(new URL('mem:alice@example.com/inbox')))
      .toBe(getCanonicalMailboxAddressIdentifier(new URL('mem://alice@example.com/inbox')));
  });

  it('canonical id 是幂等的：再解析一次得到同一个 id', () => {
    const once = getCanonicalMailboxAddressIdentifier(new URL('mem://alice@example.com/inbox/thread-1'));
    expect(getCanonicalMailboxAddressIdentifier(new URL(once))).toBe(once);
  });

  it('带 query 的地址不再被“顺手裁掉”：抛错而不是和裸地址共用队列', () => {
    expect(() => getCanonicalMailboxAddressIdentifier(new URL('mem:q@example.com/inbox?thread=1')))
      .toThrowError(InvalidMailboxAddressError);
    expect(() => getCanonicalMailboxAddressIdentifier(new URL('mem:q@example.com/inbox?thread=1')))
      .toThrow(/would be dropped by address canonicalization/);

    // 塌缩的直接后果：query 版与裸地址版 canonical id 相同 —— 必须无法发生
    const bare = getCanonicalMailboxAddressIdentifier(new URL('mem:q@example.com/inbox'));
    let queryId: string | undefined
    try {
      queryId = getCanonicalMailboxAddressIdentifier(new URL('mem:q@example.com/inbox?thread=1'))
    } catch {
      queryId = undefined
    }
    expect(queryId).toBeUndefined();
    expect(bare).toBe('mem://q@example.com/inbox');
  });

  it('带 hash 的地址同样被拒绝，错误信息点名被丢掉的部件', () => {
    expect(() => assertLosslessMailboxAddress(new URL('mem:h@example.com/inbox#frag'), 'status()'))
      .toThrow(/hash "#frag" would be dropped/);
    expect(() => assertLosslessMailboxAddress(new URL('mem:h@example.com/inbox#frag'), 'status()'))
      .toThrow(/in status\(\)/);
  });

  it('query 与 hash 同时存在时都在错误信息里', () => {
    expect(() => assertLosslessMailboxAddress(new URL('mem:a@example.com/i?x=1#f')))
      .toThrow(/query "\?x=1" and hash "#f"/);
  });

  it('空 query / 空 hash 也算「带 query / hash」的写法，一并拒绝（意图相同，同样会被丢掉）', () => {
    expect(() => assertLosslessMailboxAddress(new URL('mem:a@example.com/i?'))).toThrow(/empty query \("\?"\)/);
    expect(() => assertLosslessMailboxAddress(new URL('mem:a@example.com/i#'))).toThrow(/empty hash \("#"\)/);
  });

  it('百分号编码的 ? / # 是 path 的一部分，合法', () => {
    expect(() => assertLosslessMailboxAddress(new URL('mem:a@example.com/inbox%3Fthread%3D1%23frag')))
      .not.toThrow();
    expect(getCanonicalMailboxAddressIdentifier(new URL('mem:a@example.com/inbox%3Fthread%3D1')))
      .toBe('mem://a@example.com/inbox%3Fthread%3D1');
  });

  it('错误对象带地址与错误码，调用方可以按 code 分支而不是匹配文案', () => {
    try {
      parseMailboxAddress('mem:q@example.com/inbox?thread=1', 'post()')
      expect.unreachable('带 query 的地址应该被拒绝')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMailboxAddressError);
      expect((error as InvalidMailboxAddressError).code).toBe('MBX_INVALID_ADDRESS');
      expect((error as InvalidMailboxAddressError).address).toBe('mem:q@example.com/inbox?thread=1');
      expect((error as InvalidMailboxAddressError).name).toBe('InvalidMailboxAddressError');
    }
  });
});

describe('parseMailboxAddress', () => {
  it('接受字符串与 URL，返回等价的 URL', () => {
    // URL 保留写法（opaque 形式不会被改写成 hierarchical），topic 归一在 canonical id 那一步完成
    expect(parseMailboxAddress('mem:a@example.com/inbox').href).toBe('mem:a@example.com/inbox');
    expect(getCanonicalMailboxAddressIdentifier(parseMailboxAddress('mem:a@example.com/inbox')))
      .toBe(getCanonicalMailboxAddressIdentifier(parseMailboxAddress(new URL('mem://a@example.com/inbox'))));
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
