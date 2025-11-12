import { MailboxProvider } from './MailboxProvider';
import {
  MailMessage,
  AckableMailMessage,
  MailboxStatus,
} from '../interfaces';

type Listener = (message: MailMessage) => void | Promise<void>;

// A simple in-memory event bus to simulate message passing between different instances.
class MemoryEventBus {
  private static instance: MemoryEventBus;
  private topics: Map<string, Listener[]> = new Map();
  private queue: Map<string, MailMessage[]> = new Map(); // For fetch/pull model
  // For messages being processed, with a timestamp for stale checks
  private inFlight: Map<string, { message: MailMessage; timestamp: number }> =
    new Map();
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
    if (!this.queue.has(topic)) {
      this.queue.set(topic, []);
    }
    this.queue.get(topic)!.push(message);
  }

  /**
   * Fetches and removes a message from the queue (for auto-acknowledgment).
   * @param topic The topic to fetch a message from.
   * @returns The message, or undefined if the queue is empty.
   */
  public fetchAndForget(topic: string): MailMessage | undefined {
    const messages = this.queue.get(topic);
    if (messages && messages.length > 0) {
      this.lastActivity.set(topic, new Date().toISOString());
    }
    return messages?.shift();
  }

  /**
   * Requeues messages that have been in-flight for longer than the specified timeout.
   * @param topic The topic to check for stale messages.
   * @param timeout The timeout in milliseconds.
   */
  private requeueStale(topic: string, timeout: number): void {
    const now = Date.now();
    for (const [
      messageId,
      { message, timestamp },
    ] of this.inFlight.entries()) {
      // Check if the message belongs to the topic we are fetching from and is stale
      if (getCanonicalMailboxAddressIdentifier(message.to) === topic && now - timestamp > timeout) {
        this.inFlight.delete(messageId);
        this.requeue(topic, message);
      }
    }
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
  ): MailMessage | undefined {
    // Before fetching, check for and requeue any stale messages.
    if (options?.staleTimeout) {
      this.requeueStale(topic, options.staleTimeout);
    }

    const messages = this.queue.get(topic);
    if (!messages || messages.length === 0) {
      return undefined;
    }
    this.lastActivity.set(topic, new Date().toISOString());
    const message = messages.shift()!;
    this.inFlight.set(message.id, { message, timestamp: Date.now() });
    return message;
  }

  /**
   * Acknowledges a message, confirming it has been processed and removing it
   * from the in-flight state.
   * @param messageId The ID of the message to acknowledge.
   */
  public ack(messageId: string): void {
    this.inFlight.delete(messageId);
  }

  /**
   * Negatively acknowledges a message, removing it from the in-flight state
   * and optionally requeueing it.
   * @param messageId The ID of the message to nack.
   * @param topic The topic the message belongs to.
   * @param requeue If true, the message is added back to the front of the queue.
   */
  public nack(messageId: string, topic: string, requeue: boolean): void {
    const flight = this.inFlight.get(messageId);
    if (flight) {
      this.inFlight.delete(messageId);
      if (requeue) {
        this.requeue(topic, flight.message);
      }
    }
  }

  /**
   * Adds a message back to the front of the queue.
   * @param topic The topic to requeue the message to.
   * @param message The message to requeue.
   */
  public requeue(topic: string, message: MailMessage): void {
    if (!this.queue.has(topic)) {
      this.queue.set(topic, []);
    }
    this.queue.get(topic)!.unshift(message); // Add back to the front
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
    const queue = this.queue.get(topic) || [];
    const listeners = this.topics.get(topic) || [];
    return {
      unreadCount: queue.length,
      lastActivityTime: this.lastActivity.get(topic),
      subscriberCount: listeners.length,
    };
  }
}

/**
 * Generates a canonical string identifier for a mailbox address.
 * This function normalizes the input URL by stripping sensitive information (like password)
 * and irrelevant parts (like search parameters and hash fragments). This ensures that
 * different URL representations of the same conceptual mailbox address resolve to
 * the same unique identifier within the messaging system.
 *
 * @param address The URL object representing the mailbox address.
 * @returns A canonical string identifier for the mailbox address.
 */
function getCanonicalMailboxAddressIdentifier(address: URL): string {
  const userInfo = address.username ? `${address.username}@` : '';
  return `${address.protocol}//${userInfo}${address.host}${address.pathname}`;
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
  ): Promise<MailMessage | AckableMailMessage | null> {
    const topic = getCanonicalMailboxAddressIdentifier(address);

    if (!options?.manualAck) {
      const message = this.bus.fetchAndForget(topic);
      return message || null;
    }

    const message = this.bus.fetchForAck(topic, {
      staleTimeout: options?.ackTimeout,
    });
    if (!message) {
      return null;
    }

    return {
      ...message,
      ack: async () => {
        this.bus.ack(message.id);
      },
      nack: async (requeue = false) => {
        this.bus.nack(message.id, topic, requeue);
      },
    };
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
    // Requeuing a pushed message isn't directly applicable,
    // but we can add it back to the fetch queue if needed.
    if (requeue) {
      const topic = getCanonicalMailboxAddressIdentifier(message.to);
      this.bus.requeue(topic, message);
    }
    // Otherwise, the message is simply dropped.
  }
}