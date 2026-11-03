import { describe, it, expect } from 'vitest';
import {
  describeDeliveryError,
  deliveryKey,
  isDeliveryResult,
  MAX_DELIVERY_ERROR_LENGTH,
  messageIdOfDelivery,
  shouldRequeueAfterBroadcast,
  subscriptionIdOfDelivery,
  toDeliveryResults,
  type DeliveryResult,
} from './delivery';

const delivery = (overrides: Partial<DeliveryResult> = {}): DeliveryResult => ({
  deliveryId: 'sub1\u0000msg1',
  subscriptionId: 'sub1',
  messageId: 'msg1',
  ok: false,
  reason: 'retriable',
  ...overrides,
});

describe('deliveryKey：投递身份 = 订阅者 + 消息', () => {
  it('可以拆回两部分', () => {
    const key = deliveryKey('sub1', 'msg1');
    expect(subscriptionIdOfDelivery(key)).toBe('sub1');
    expect(messageIdOfDelivery(key)).toBe('msg1');
  });

  it('不同订阅者对同一条消息是两个身份', () => {
    expect(deliveryKey('a', 'm')).not.toBe(deliveryKey('b', 'm'));
  });
});

describe('shouldRequeueAfterBroadcast：只有无人成功才回队', () => {
  it('没有投递 → 不回队', () => {
    expect(shouldRequeueAfterBroadcast([])).toBe(false);
  });

  it('有投递成功 → 不回队（部分失败不重复投递）', () => {
    expect(
      shouldRequeueAfterBroadcast([
        delivery({ ok: true, reason: undefined }),
        delivery({ reason: 'retriable' }),
      ]),
    ).toBe(false);
  });

  it('全部失败且至少一次可重试 → 回队（fetch 兜底）', () => {
    expect(
      shouldRequeueAfterBroadcast([delivery({ reason: 'retriable' }), delivery({ reason: 'fatal' })]),
    ).toBe(true);
  });

  it('取消的重投等同可重试', () => {
    expect(shouldRequeueAfterBroadcast([delivery({ reason: 'cancelled' })])).toBe(true);
  });

  it('全部不可重试 → 死信，不回队', () => {
    expect(
      shouldRequeueAfterBroadcast([delivery({ reason: 'fatal' }), delivery({ reason: 'fatal' })]),
    ).toBe(false);
  });
});

describe('toDeliveryResults：第三方监听器的结算值归一化', () => {
  it('透传 DeliveryResult', () => {
    const result = delivery({ reason: 'fatal' });
    expect(toDeliveryResults([{ status: 'fulfilled', value: result }])).toEqual([result]);
    expect(isDeliveryResult(result)).toBe(true);
    expect(isDeliveryResult(undefined)).toBe(false);
  });

  it('非 DeliveryResult 的 fulfilled 视作成功', () => {
    const [normalized] = toDeliveryResults([{ status: 'fulfilled', value: undefined }]);
    expect(normalized.ok).toBe(true);
  });

  it('rejected 视作可重试失败（宁可多兜一次）', () => {
    const [normalized] = toDeliveryResults([{ status: 'rejected', reason: new Error('boom') }]);
    expect(normalized.ok).toBe(false);
    expect(normalized.reason).toBe('retriable');
  });

  it('[语义] rejected 一个循环引用的普通对象不得打断归一化', () => {
    // 以前：这里的 JSON.stringify 直接抛 TypeError → barrier 的处置整块被跳过
    // → nack(requeue) / 死信钩子都不发（消息静默丢失）。
    const [normalized] = toDeliveryResults([{ status: 'rejected', reason: circularError() }]);
    expect(normalized.ok).toBe(false);
    expect(normalized.reason).toBe('retriable');
    expect(normalized.error).toContain('E_DOWN');
  });
});

/** 循环引用 + 没有 `message` 的普通对象：`JSON.stringify` 的典型炸点。 */
function circularError(): any {
  const error: any = { code: 'E_DOWN' };
  error.self = error;
  return error;
}

/**
 * `describeDeliveryError` 跑在**结算路径**上（`_settleDelivery` / `toDeliveryResults`）：
 * 它一抛，就是「结算被半途取消」—— pending 已摘、`settle()` 不发、barrier 永挂，
 * nack / 死信钩子 / 缺 barrier 兜底全部不执行。所以它必须是**全函数**：任何被抛出的
 * 值都退化成可读摘要，绝不抛。三端（TS / Python / Rust）同一约定。
 */
describe('describeDeliveryError：任意抛出的值都必须归成摘要（全函数，绝不抛）', () => {
  it('[语义] 循环引用的普通对象：不抛，保留 code，并标记循环', () => {
    const summary = describeDeliveryError(circularError());
    expect(summary).toContain('E_DOWN');
    expect(summary).toMatch(/Circular/);
  });

  it('[语义] 刁钻输入全体不抛，且都得到非空、已截断的摘要', () => {
    const cyclicArray: any[] = [];
    cyclicArray.push(cyclicArray);

    const throwingProxy = new Proxy({} as Record<string, unknown>, {
      get: () => {
        throw new TypeError('trap');
      },
      ownKeys: () => {
        throw new TypeError('trap');
      },
      getOwnPropertyDescriptor: () => {
        throw new TypeError('trap');
      },
    });

    const mutuallyCircular = (() => {
      const a: any = {};
      const b: any = { a };
      a.b = b;
      return a;
    })();

    const errorWithThrowingName = new Error('boom');
    Object.defineProperty(errorWithThrowingName, 'name', {
      get: () => {
        throw new RangeError('bad name');
      },
    });

    const errorWithThrowingMessage = new Error('boom');
    Object.defineProperty(errorWithThrowingMessage, 'message', {
      get: () => {
        throw new RangeError('bad message');
      },
    });

    function downstreamHandler(): void {}

    const hostile: [string, unknown][] = [
      ['circular object', circularError()],
      ['circular array', cyclicArray],
      ['mutually circular objects', mutuallyCircular],
      ['BigInt field', { code: 'X', big: 10n }],
      ['BigInt itself', 42n],
      ['toJSON throws', { code: 500, toJSON: () => { throw new RangeError('nope'); } }],
      ['toJSON returns undefined', { code: 500, toJSON: () => undefined }],
      ['throwing Proxy', throwingProxy],
      ['code is a throwing Proxy', { code: throwingProxy }],
      ['message getter throws', { get message(): string { throw new RangeError('bad getter'); } }],
      ['Error.name getter throws', errorWithThrowingName],
      ['Error.message getter throws', errorWithThrowingMessage],
      ['Error.code toString throws', Object.assign(new Error('boom'), {
        code: { toString: () => { throw new TypeError('bad code'); } },
      })],
      ['null prototype object', Object.assign(Object.create(null), { message: 'from null proto' })],
      ['Symbol', Symbol('down')],
      ['function with code', Object.assign(downstreamHandler, { code: 'E_DOWN' })],
      ['nested function', { handler: downstreamHandler, code: 'E_DOWN' }],
      ['empty object', {}],
      ['array', [1, 2, 3]],
      ['nested bigint', { detail: { big: 7n } }],
    ];

    const failures: string[] = [];
    for (const [label, value] of hostile) {
      try {
        const summary = describeDeliveryError(value);
        if (typeof summary !== 'string' || summary.length === 0) {
          failures.push(`${label}: 摘要为空或不是字符串`);
        } else if (summary.length > MAX_DELIVERY_ERROR_LENGTH) {
          failures.push(`${label}: 摘要未截断 (${summary.length})`);
        }
      } catch (error) {
        failures.push(`${label}: THREW ${(error as Error).name}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('[语义] 普通值的摘要不变（不回退成 [object Object]）', () => {
    expect(describeDeliveryError(new Error('boom'))).toBe('Error: boom');
    expect(describeDeliveryError(Object.assign(new Error('up'), { code: 503 }))).toBe('Error: up (code=503)');
    expect(describeDeliveryError('plain text')).toBe('plain text');
    expect(describeDeliveryError({ code: 500 })).toBe('{"code":500} (code=500)');
    expect(describeDeliveryError({ message: 'has message', code: 'E_DOWN' })).toBe('has message (code=E_DOWN)');
    // `message` 为空串时不能把死信记录里的 `error` 留成空：退回结构摘要。
    expect(describeDeliveryError({ message: '' })).toBe('{"message":""}');
    expect(describeDeliveryError({ message: '', code: 500 })).toBe('{"message":"","code":500} (code=500)');
    expect(describeDeliveryError(undefined)).toBe('undefined');
    expect(describeDeliveryError(null)).toBe('null');
    expect(describeDeliveryError(42)).toBe('42');
  });

  it('[语义] 嵌套里的循环引用：不抛，且可读字段仍保留', () => {
    const error: any = { code: 'E_DOWN', detail: { name: 'upstream' } };
    error.detail.back = error;
    const summary = describeDeliveryError(error);
    expect(summary).toContain('E_DOWN');
    expect(summary).toContain('upstream');
  });

  it('[语义] 摘要仍被截断到 MAX_DELIVERY_ERROR_LENGTH', () => {
    const summary = describeDeliveryError({ message: 'x'.repeat(MAX_DELIVERY_ERROR_LENGTH * 3) });
    expect(summary).toHaveLength(MAX_DELIVERY_ERROR_LENGTH);
    expect(summary.endsWith('\u2026')).toBe(true);
  });

  it('[事实] 对象里嵌套的函数 / 循环引用用占位标记，不退化成 [object Object]', () => {
    const summary = describeDeliveryError(circularError());
    expect(summary).not.toBe('[object Object]');
    expect(summary).toContain('{');

    function handler(): void {}
    expect(describeDeliveryError({ handler })).toBe('{"handler":"[Function handler]"}');
  });
});
