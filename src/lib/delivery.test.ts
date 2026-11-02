import { describe, it, expect } from 'vitest';
import {
  deliveryKey,
  isDeliveryResult,
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
});
