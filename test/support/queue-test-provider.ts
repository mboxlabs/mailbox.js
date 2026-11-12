/**
 * 队列型 provider 的测试基座（拆包计划 §3）。
 *
 * 为什么要有它：`mailbox-queue` 出核之后，那一仓的测试不能靠 `MemoryProvider` 跑——那样「队列的
 * 回归面」其实还是 `mem:` 总线的回归面，而 `@mboxlabs/input` 恰恰是**直接**拿队列（实测它调 9 个
 * 队列方法）。所以队列自己需要一层「核心基类 + 自家队列」的基座，覆盖租约 / 按份去重 / 停放 /
 * 轮次计数 / barrier 结算。
 *
 * 它不是新发明：这份就是 `src/mailbox.disposition-copy-identity.test.ts` 里那个内联
 * `IdentityProvider` 提出来复用（拆包计划 §3 末）。提取只做了两件事——挪位置、协议名可传；
 * 结算口径（按份号 `queue.locate(...)`，不按对象同一性）与投递入口（基类包好的
 * `_deliverToLocalSubscription`）原样保留，因为**第三方 broker 型 provider 就是这么写的**。
 *
 * 一个刻意的分工：`src/mailbox.delivery-settlement.test.ts` 里的 `RawBroadcastProvider` 不在这里，
 * 它的用途是「故意漏接 `_trackBroadcastSettlement`」，属于反面夹具，不是基座。
 */

import { MailMessageQueue } from '../../src/lib/MessageQueue';
import { MailboxProvider } from '../../src/providers/MailboxProvider';
import type { MailMessage } from '../../src/interfaces';
import type { RetryPolicy } from '../../src/lib/retry';

/**
 * 这个基座自己的 topic 键规则：`protocol//user@host/pathname`。
 *
 * 它是**夹具的键规则**，不是内核的寻址规则（D5）：换一个 scheme，键规则就换一个写法。
 */
export function canonicalTopicOf(address: URL | string): string {
  const url = typeof address === 'string' ? new URL(address) : address;
  const userInfo = url.username ? `${url.username}@` : '';
  return `${url.protocol}//${userInfo}${url.host}${url.pathname}`;
}

/**
 * 队列 / 传输型 provider（`broadcastDeliveries = false`，基类默认）：一次投递 = broker 的一次 ack。
 *
 * 每个环节**实际收到的对象**都存下来（`sent` / `acked` / `nacked`），用来对照同一性而不是对照文档
 * 措辞；`handedTo` 由测试自己的消费者回调往里塞，基座只负责留位置。
 */
export class QueueTestProvider extends MailboxProvider {
  readonly queue = new MailMessageQueue<MailMessage>();
  /** `_send` 收到的那份（= `send()` 的浅拷贝，带 `mbx-sent-at`；`post()` 返回的就是它） */
  sent: MailMessage | undefined;
  /** 每次尝试交给订阅回调的对象——由测试往里 push，基座只留容器 */
  readonly handedTo: MailMessage[] = [];
  /** 隐式 ack 收到的对象 */
  readonly acked: MailMessage[] = [];
  /** 处置信号收到的对象 */
  readonly nacked: { message: MailMessage; requeue: boolean }[] = [];

  constructor(retry?: RetryPolicy | null, protocol = 'q') {
    super(protocol, retry);
  }

  protected async _send(message: MailMessage): Promise<void> {
    this.sent = message;
    this.queue.enqueue(canonicalTopicOf(message.to), message);
    // broker 主动 push：走基类投递入口，才有副本与计数记账（第三方 provider 必须这样接）。
    for (const sub of Array.from(this.subscriptions.values())) {
      void this._deliverToLocalSubscription(sub.id, message);
    }
  }

  protected _subscribe(_address: URL, _onReceive: any): any {
    return null;
  }

  protected async _unsubscribe(): Promise<void> {}

  protected async _fetch(): Promise<MailMessage | null> {
    return null;
  }

  /** broker 式 provider 的结算口径：按份号（系统发的 `mbx-send-id`），不按发送方的名字。 */
  private flightKey(message: MailMessage): string {
    return this.queue.locate(message.id).find((c) => c.state === 'inFlight')?.key ?? message.id;
  }

  protected async _ack(message: MailMessage): Promise<void> {
    this.acked.push(message);
    this.queue.ack(this.flightKey(message));
  }

  protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
    this.nacked.push({ message, requeue });
    this.queue.nack(this.flightKey(message), requeue);
  }
}
