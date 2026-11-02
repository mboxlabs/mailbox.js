import { MailboxProvider } from './MailboxProvider';
import {
  MailMessage,
  MailboxStatus,
} from '../interfaces';
import { MailMessageQueue, MailMessageAckable } from '../lib/MessageQueue';
import { RetryPolicy } from '../lib/retry';
import { DeliveryResult } from '../lib/delivery';
import { getCanonicalMailboxAddressIdentifier } from '../lib/utils';

type Listener = (message: MailMessage) => void | Promise<DeliveryResult | void>;

// A simple in-memory event bus to simulate message passing between different instances.
class MemoryEventBus {
  private static instance: MemoryEventBus;
  private topics: Map<string, Listener[]> = new Map();
  private messageQueue = new MailMessageQueue<MailMessage>();
  private lastActivity: Map<string, string> = new Map(); // For status

  private constructor() {}

  /**
   * Gets the singleton instance of the MemoryEventBus.
   * @returns The singleton MemoryEventBus instance.
   */
  public static getInstance(): MemoryEventBus {
    if (!MemoryEventBus.instance) {
      MemoryEventBus.instance = new MemoryEventBus();
    }
    return MemoryEventBus.instance;
  }

  /**
   * Subscribes a listener to a specific topic.
   * @param topic The topic (canonical address) to subscribe to.
   * @param listener The callback function to execute when a message is received.
   * @returns A function that, when called, unsubscribes the listener.
   */
  public subscribe(topic: string, listener: Listener): () => void {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, []);
    }
    this.topics.get(topic)!.push(listener);
    this.lastActivity.set(topic, new Date().toISOString());
    return () => {
      const listeners = this.topics.get(topic);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  /**
   * 发布一条消息：有订阅者时交给订阅回调，否则入队等待 fetch 取回。
   *
   * @param topic The topic to publish the message to.
   * @param message The message to publish.
   * @returns 广播时返回每次投递的结算 promise（供发送侧做结算判定，见 `_send`）；
   *   入队时返回 `null`。注意广播仍是 fire-and-forget：这里不 await，`post()` 也不会
   *   等订阅回调跑完。
   */
  public publish(topic: string, message: MailMessage): Promise<DeliveryResult | void>[] | null {
    this.lastActivity.set(topic, new Date().toISOString());
    // 交给订阅者
    const listeners = this.topics.get(topic);
    if (listeners && listeners.length > 0) {
      // 一条消息只走一条路：有订阅者就只走订阅。
      // 以前两条路都走：订阅者从不 fetch，于是队列只涨不消（`status().unreadCount` 一直增长），
      // 而重新订阅后一次 `fetch` 会把已处理过的消息再投递一遍（副作用执行两次）。
      //
      // 每次投递的 promise 要留一份给发送侧：issue#2 —— 部分失败时「整条消息回不回队」
      // 必须等全部投递结算后才能判断，不能由先失败的那个订阅者说了算。
      return listeners.map((listener) => {
        try {
          return Promise.resolve(listener(message));
        } catch (error) {
          // 监听器同步抛错：归一成 rejected，交给 barrier 的 allSettled 处理，
          // 不能让它把整个 publish（进而把 `post()`）打断。
          return Promise.reject(error);
        }
      });
    }
    // 入队，等待 fetch 取回
    this.messageQueue.enqueue(topic, message);
    return null;
  }

  /**
   * Fetches and removes a message from the queue (for auto-acknowledgment).
   * @param topic The topic to fetch a message from.
   * @returns The message, or undefined if the queue is empty.
   */
  public fetchAndForget(topic: string): MailMessage | undefined {
    this.lastActivity.set(topic, new Date().toISOString()); // Keep last activity update
    return this.messageQueue.dequeue(topic) || undefined;
  }

  /**
   * Fetches a message for manual acknowledgment, moving it to the in-flight state.
   * Also checks for and requeues any stale messages before fetching.
   * @param topic The topic to fetch a message from.
   * @param options Options for the fetch operation, including staleTimeout.
   * @returns The message, or undefined if the queue is empty.
   */
  public fetchForAck(
    topic: string,
    options?: { staleTimeout?: number | null },
  ): MailMessageAckable<MailMessage> | undefined {
    this.lastActivity.set(topic, new Date().toISOString()); // Keep last activity update
    // 不将缺省超时压成 0：那会关掉 MessageQueue 的 stale 扫描，未 ack 的消息永久卡在 in-flight。
    return this.messageQueue.dequeue(topic, { manualAck: true, ackTimeout: options?.staleTimeout }) || undefined;
  }

  /**
   * Acknowledges a message, confirming it has been processed and removing it
   * from the in-flight state.
   * @param messageId The ID of the message to acknowledge.
   */
  public ack(messageId: string): void {
    this.messageQueue.ack(messageId);
  }

  /**
   * Negatively acknowledges a message, removing it from the in-flight state
   * and optionally requeueing it.
   * @param messageId The ID of the message to nack.
   * @param topic The topic the message belongs to.
   * @param requeue If true, the message is added back to the front of the queue.
   */
  public nack(messageId: string, topic: string, requeue: boolean): void {
    this.messageQueue.nack(messageId, topic, requeue);
  }

  /**
   * Puts a message back at the front of a topic's queue without going through the
   * in-flight state. Used when a subscriber callback fails with a retriable error.
   * @param topic The topic the message belongs to.
   * @param message The message to requeue.
   */
  public requeue(topic: string, message: MailMessage): void {
    this.lastActivity.set(topic, new Date().toISOString());
    this.messageQueue.requeue(topic, message);
  }

  /**
   * Gets the current status of a topic.
   * @param topic The topic to get the status for.
   * @returns An object containing status information.
   */
  public getStatus(topic: string): {
    unreadCount: number;
    inFlightCount: number;
    lastActivityTime?: string;
    subscriberCount: number;
  } {
    const { unreadCount, inFlightCount } = this.messageQueue.getStatus(topic);
    const listeners = this.topics.get(topic) || [];
    return {
      unreadCount,
      inFlightCount,
      lastActivityTime: this.lastActivity.get(topic),
      subscriberCount: listeners.length,
    };
  }
}



export class MemoryProvider extends MailboxProvider {
  private bus = MemoryEventBus.getInstance();

  /**
   * 订阅是广播：一条消息对每个订阅者各投递一次。失败处理因此走投递级记账，
   * 整条消息回不回队由 `_send` 里的结算 barrier 决定（issue#2）。
   */
  protected readonly broadcastDeliveries = true;

  /**
   * @param retry 可选的订阅重试策略。不传则保持默认：订阅失败只把消息退回队列，不自动重投。
   */
  constructor(retry?: RetryPolicy | null) {
    super('mem', retry);
  }

  /**
   * 发送并给广播挂上结算 barrier：等这条消息的全部投递（含重试链）落定后，才决定要不要
   * 把它退回队列（判定在基类的 `shouldRequeueAfterBroadcast`，issue#2）。
   */
  protected async _send(message: MailMessage): Promise<void> {
    const topic = getCanonicalMailboxAddressIdentifier(message.to);
    const deliveries = this.bus.publish(topic, message);
    if (!deliveries) {
      return; // 没有订阅者：消息入队，由 fetch / ack 那套语义负责
    }
    this._trackBroadcastSettlement(message, deliveries);
  }

  protected _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => Promise<DeliveryResult>,
  ): any {
    const topic = getCanonicalMailboxAddressIdentifier(address);
    // The returned unsubscribe function is the "unsubscribeHandle"
    return this.bus.subscribe(topic, onReceive);
  }

  protected async _unsubscribe(
    subscriptionId: string, // Not used by MemoryProvider, the handle is sufficient
    unsubscribeHandle: any,
  ): Promise<void> {
    if (typeof unsubscribeHandle === 'function') {
      unsubscribeHandle();
    }
  }

  protected async _fetch(
    address: URL,
    options?: { manualAck?: boolean; ackTimeout?: number | null },
  ): Promise<MailMessage | MailMessageAckable<MailMessage> | null> { // Updated return type
    const topic = getCanonicalMailboxAddressIdentifier(address);

    if (!options?.manualAck) {
      const message = this.bus.fetchAndForget(topic);
      return message || null;
    }

    const ackableMessage = this.bus.fetchForAck(topic, {
      staleTimeout: options?.ackTimeout,
    });
    return ackableMessage || null;
  }

  protected async _status(address: URL): Promise<MailboxStatus> {
    const topic = getCanonicalMailboxAddressIdentifier(address);
    const { unreadCount, inFlightCount, lastActivityTime, subscriberCount } =
      this.bus.getStatus(topic);

    return {
      state: 'online',
      unreadCount,
      // in-flight 消息已离开队列但尚未确认，单独报出来，否则 status 会把它们当作已处理完。
      inFlightCount,
      lastActivityTime,
      subscriberCount,
    };
  }

  /**
   * 订阅模式下广播结算后的处置入口（由 `_send` 的 barrier 调用一次，不在每个订阅者失败时调用）。
   *
   * 之前这里是空实现：订阅的消息不再入队后，可重试错误等于消息静默消失。
   * 现在 requeue=true（全部投递都失败）将消息退回 topic 队列头部，可被 `fetch` 取回且在
   * `unreadCount` 里可见；requeue=false（有订阅者成功，或失败不可重试）则按死信处理直接丢弃。
   */
  protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
    if (!requeue) {
      return;
    }
    const topic = getCanonicalMailboxAddressIdentifier(message.to);
    this.bus.requeue(topic, message);
  }
}