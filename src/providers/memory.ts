import { MailboxProvider } from './MailboxProvider';
import {
  MailMessage,
  MailboxStatus,
} from '../interfaces';
import { MessageQueue, Ackable } from '../lib/MessageQueue';
import { getCanonicalMailboxAddressIdentifier } from '../lib/utils';

type Listener = (message: MailMessage) => void | Promise<void>;

// A simple in-memory event bus to simulate message passing between different instances.
class MemoryEventBus {
  private static instance: MemoryEventBus;
  private topics: Map<string, Listener[]> = new Map();
  private messageQueue = new MessageQueue<MailMessage>();
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
   * Publishes a message to a topic, delivering it to push-based subscribers
   * and adding it to the queue for pull-based consumers.
   * @param topic The topic to publish the message to.
   * @param message The message to publish.
   */
  public publish(topic: string, message: MailMessage): void {
    this.lastActivity.set(topic, new Date().toISOString());
    // For push subscribers
    const listeners = this.topics.get(topic);
    if (listeners) {
      listeners.forEach(listener => listener(message));
    }
    // For pull/fetch subscribers
    this.messageQueue.enqueue(topic, message);
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
    options?: { staleTimeout?: number },
  ): Ackable<MailMessage> | undefined {
    this.lastActivity.set(topic, new Date().toISOString()); // Keep last activity update
    return this.messageQueue.dequeue(topic, { manualAck: true, ackTimeout: options?.staleTimeout || 0 }) || undefined;
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
   * Gets the current status of a topic.
   * @param topic The topic to get the status for.
   * @returns An object containing status information.
   */
  public getStatus(topic: string): {
    unreadCount: number;
    lastActivityTime?: string;
    subscriberCount: number;
  } {
    const { unreadCount } = this.messageQueue.getStatus(topic);
    const listeners = this.topics.get(topic) || [];
    return {
      unreadCount,
      lastActivityTime: this.lastActivity.get(topic),
      subscriberCount: listeners.length,
    };
  }
}



export class MemoryProvider extends MailboxProvider {
  private bus = MemoryEventBus.getInstance();

  constructor() {
    super('mem');
  }

  protected async _send(message: MailMessage): Promise<void> {
    const topic = getCanonicalMailboxAddressIdentifier(message.to);
    this.bus.publish(topic, message);
  }

  protected _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => Promise<void>,
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
    options?: { manualAck?: boolean; ackTimeout?: number },
  ): Promise<MailMessage | Ackable<MailMessage> | null> { // Updated return type
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
    const { unreadCount, lastActivityTime, subscriberCount } =
      this.bus.getStatus(topic);

    return {
      state: 'online',
      unreadCount,
      lastActivityTime,
      subscriberCount,
    };
  }

  protected async _nack(message: MailMessage, requeue: boolean): Promise<void> {
    // For subscribed messages, nack typically means the message is dropped.
    // The MessageQueue handles requeuing for fetched messages.
    // No explicit action is needed here.
  }
}