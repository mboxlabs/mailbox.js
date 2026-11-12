/**
 * `mem:` 的折叠政策（D5 / 拆包计划 §11）。随 `providers/memory.ts` 一起属于 `mailbox-memory`。
 *
 * issue#4：规范化会静默丢掉 query / hash，两个逻辑地址塌成同一个 topic。修法是「在入口拒绝」：
 * 地址语义必须留在 path 里。折叠规则只产 **provider 内部键**，不在核心导出面上（`lib/address-boundary.test.ts`
 * 钉住那一半）。
 */

import { describe, it, expect } from 'vitest';
import { assertLosslessMailboxAddress, getCanonicalMailboxAddressIdentifier } from './scheme-address';
import { InvalidMailboxAddressError } from '../error';

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
      // 这条策略属于 scheme（`mem:` 的折叠会丢 query），不属于内核：所以断言挂在 helper 上。
      assertLosslessMailboxAddress(new URL('mem:q@example.com/inbox?thread=1'), 'post()')
      expect.unreachable('带 query 的地址应该被拒绝')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMailboxAddressError);
      expect((error as InvalidMailboxAddressError).code).toBe('MBX_INVALID_ADDRESS');
      expect((error as InvalidMailboxAddressError).address).toBe('mem:q@example.com/inbox?thread=1');
      expect((error as InvalidMailboxAddressError).name).toBe('InvalidMailboxAddressError');
    }
  });
});
