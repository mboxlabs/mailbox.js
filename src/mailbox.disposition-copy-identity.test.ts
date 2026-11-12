/**
 * 「内核交给 provider 的 `message` 是副本」这条契约的防线。
 * 规范正文：`wiki/delivery-semantics.md` §7.3；移植清单：`wiki/mailbox-arch.md` §3.1.2 第 6/7 项。
 *
 * 为什么必须钉住：广播是 N 次投递，内核不能把次数写回共享的那一条消息，所以每次尝试都换一份
 * 浅拷贝（带 `mbx-attempt` / `mbx-round`）。于是**对象同一性在 provider 眼里是不稳定的**：
 * `_ack` / `_nack` 收到的都不是 `_send` 那份。按对象记账的 provider（`Map<MailMessage, handle>` /
 * `WeakMap` / `set.has(message)`）查不到 handle 时不会抛错，只会静默不 ack ⇒ 真实 broker 在
 * visibility timeout 后无限重投。这条失效基类无法告警，只能靠契约 + 测试把它写明白。
 *
 * 这里断言的是「实际拿到了什么」，不是「应该有计数」：
 *   1. `_ack` 收到的是**当次尝试**的副本——与订阅回调那次拿到的是同一个对象，但**不是** `_send` 那份；
 *   2. `_nack` 收到的是**最后一次尝试**的副本（趟数是真的），同样不是 `_send` 那份；
 *   3. 浅拷贝的边界：`headers` 是新对象，`body` / `meta` / `from` / `to` 仍是同一引用；
 *   4. 例外照实钉住：广播 barrier **没记到副本**时会退回不带计数的 `_send` 那份 ⇒ provider 读计数
 *      必须容 `undefined`，不能假设头一定在。
 *
 * 命名标记：
 *   [语义] 契约不变量，破坏它们就是回归。
 *   [事实] 锁住实现里真实存在的兜底出口（不是设计愿望）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mailbox } from './mailbox';
import { MailboxProvider } from './providers/MailboxProvider';
import { QueueTestProvider } from '../test/support/queue-test-provider';
import { MBX_ATTEMPT_HEADER, MBX_MAX_ATTEMPTS_HEADER, MBX_ROUND_HEADER } from './lib/delivery';
import type { MailMessage } from './interfaces';
import type { DeliveryResult } from './lib/delivery';

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retriable = () => Object.assign(new Error('upstream down'), { isRetriable: true });

let seq = 0;
const addrOf = (name: string): string => `q://t${seq++}-${name}@broker/inbox`;

const countersOf = (message?: MailMessage | null) => ({
  attempt: message?.headers?.[MBX_ATTEMPT_HEADER],
  max: message?.headers?.[MBX_MAX_ATTEMPTS_HEADER],
  round: message?.headers?.[MBX_ROUND_HEADER],
});

describe('交给 provider 的 message 是副本：对象同一性不可依赖', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('[语义] `_ack` 收到的是当次尝试的副本：与回调那次同一对象，但不是 `_send` 那份', async () => {
    const provider = new QueueTestProvider();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = addrOf('ack-copy');

    let seenByCallback: MailMessage | undefined;
    await mailbox.subscribe(address, (message) => {
      seenByCallback = message;
    });
    const posted = await mailbox.post({
      from: 'q://s@broker/u',
      to: address,
      body: { n: 1 },
      meta: { tag: 'shared' },
    });
    await tick(80);

    expect(provider.acked).toHaveLength(1);
    const acked = provider.acked[0];

    // `post()` 返回的就是 `_send` 收到的那份——它在整个投递链里都不是 `_ack` 的那一份。
    expect(posted).toBe(provider.sent);
    expect(acked).not.toBe(provider.sent);
    // 同一次尝试里，回调 / `_ack` / `_nack` 拿的是同一个对象。
    expect(acked).toBe(seenByCallback);
    // 副本带计数：没开重试也至少有「本轮第 1 趟 / 第 1 轮」。
    expect(countersOf(acked)).toEqual({ attempt: '1', max: undefined, round: '1' });
    expect(countersOf(provider.sent)).toEqual({ attempt: undefined, max: undefined, round: undefined });

    // 浅拷贝边界：headers 是新对象（改副本不回落到 `_send`），其余引用仍共享。
    expect(acked.headers).not.toBe(provider.sent!.headers);
    expect(acked.body).toBe(provider.sent!.body);
    expect(acked.meta).toBe(provider.sent!.meta);
    expect(acked.from).toBe(provider.sent!.from);
    expect(acked.to).toBe(provider.sent!.to);

    await mailbox.stop({ purge: true });
  });

  it('[语义] 每次尝试是新副本；`_nack` 收到最后一次尝试的那份（趟数是真的）', async () => {
    const provider = new QueueTestProvider({ maxAttempts: 3, baseDelay: 1 });
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    const address = addrOf('nack-copy');

    await mailbox.subscribe(address, (message) => {
      provider.handedTo.push(message);
      throw retriable();
    });
    await mailbox.post({ from: 'q://s@broker/u', to: address, body: { n: 1 } });
    await tick(200);

    expect(provider.handedTo).toHaveLength(3);
    // 三份互不相同：按对象记账的 provider 到第三次就查不到自己第一次存的 handle 了。
    expect(new Set(provider.handedTo).size).toBe(3);

    expect(provider.nacked).toHaveLength(1);
    const disposition = provider.nacked[0].message;
    expect(provider.nacked[0].requeue).toBe(true);
    expect(disposition).not.toBe(provider.sent);
    expect(disposition).toBe(provider.handedTo[2]);
    expect(countersOf(disposition)).toEqual({ attempt: '3', max: '3', round: '1' });

    await mailbox.stop({ purge: true });
  });

  it('[事实] barrier 没记到副本时退回不带计数的 `_send` 那份：provider 读计数必须容 undefined', async () => {
    /**
     * 广播型 provider 接了 barrier，但投递**没走**基类入口（`_startDelivery` /
     * `_deliverToLocalSubscription`）——第三方 provider 里很容易写成这样。基类的
     * `settledCopies` 于是空着，处置信号退回 `_send` 那份：同一性反过来，计数也全缺。
     * 这条不是设计愿望，是实现里真实存在的出口（同 id 并发广播的后一个 barrier、
     * `MAX_SETTLED_COPIES` 淘汰同样走到这里），所以照实钉住而不是假装它不会发生。
     */
    class BarrierWithoutDeliveryBookkeeping extends MailboxProvider {
      protected readonly broadcastDeliveries = true;
      sent: MailMessage | undefined;
      readonly nacked: MailMessage[] = [];

      constructor() {
        super('bc');
      }

      protected async _send(message: MailMessage): Promise<void> {
        this.sent = message;
        this._trackBroadcastSettlement(message, [
          Promise.resolve<DeliveryResult>({
            deliveryId: 'ghost\u00001',
            subscriptionId: 'ghost',
            messageId: message.id,
            ok: false,
            reason: 'retriable',
            attempts: 1,
          }),
        ]);
      }

      protected _subscribe(_address: URL, _onReceive: any): any {
        return null;
      }

      protected async _unsubscribe(): Promise<void> {}

      protected async _fetch(): Promise<MailMessage | null> {
        return null;
      }

      protected async _nack(message: MailMessage): Promise<void> {
        this.nacked.push(message);
      }
    }

    const provider = new BarrierWithoutDeliveryBookkeeping();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    await mailbox.post({ from: 'bc://s@x/u', to: 'bc://t@x/inbox', body: 1 });
    await tick(30);

    expect(provider.nacked).toHaveLength(1);
    expect(provider.nacked[0]).toBe(provider.sent); // 退回共享对象：这次「是」原对象
    expect(countersOf(provider.nacked[0])).toEqual({ attempt: undefined, max: undefined, round: undefined });

    await mailbox.stop({ purge: true });
  });
});
