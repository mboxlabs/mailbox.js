import { MailboxProvider } from './MailboxProvider';
import {
  MailMessage,
  AckableMailMessage,
  MailboxStatus,
} from '../interfaces';

type Listener = (message: MailMessage) => void | Promise<void>;

// A simple in-memory event bus to simulate message passing between different instances.
// This remains largely unchanged as it represents the "transport medium".
class MemoryEventBus {
  private static instance: MemoryEventBus;
  private topics: Map<string, Listener[]> = new Map();
  private queue: Map<string, MailMessage[]> = new Map(); // For fetch/pull model
  private lastActivity: Map<string, string> = new Map(); // For status

  private constructor() {}

  public static getInstance(): MemoryEventBus {
    if (!MemoryEventBus.instance) {
      MemoryEventBus.instance = new MemoryEventBus();
    }
    return MemoryEventBus.instance;
  }

  // For subscribe/push model
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

  // For send/post
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

  // For fetch/pull model
  public dequeue(topic: string): MailMessage | undefined {
    const messages = this.queue.get(topic);
    if (messages && messages.length > 0) {
      this.lastActivity.set(topic, new Date().toISOString());
    }
    return messages?.shift();
  }

  public requeue(topic: string, message: MailMessage): void {
    if (!this.queue.has(topic)) {
      this.queue.set(topic, []);
    }
    this.queue.get(topic)!.unshift(message); // Add back to the front
  }

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


function getTopic(address: URL): string {
  const userInfo = address.username ? `${address.username}@` : '';
  return `${address.protocol}//${userInfo}${address.host}${address.pathname}`;
}

export class MemoryProvider extends MailboxProvider {
  private bus = MemoryEventBus.getInstance();

  constructor() {
    super('mem');
  }

  protected async _send(message: MailMessage): Promise<void> {
    const topic = getTopic(message.to);
    this.bus.publish(topic, message);
  }

  protected _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => Promise<void>,
  ): any {
    const topic = getTopic(address);
    // The returned unsubscribe function is the "unsubscribeHandle"
    return this.bus.subscribe(topic, onReceive);
  }

  protected async _unsubscribe(
    subscriptionId: string,
    unsubscribeHandle: any,
  ): Promise<void> {
    if (typeof unsubscribeHandle === 'function') {
      unsubscribeHandle();
    }
  }

  protected async _fetch(
    address: URL,
    options?: { manualAck?: boolean },
  ): Promise<MailMessage | AckableMailMessage | null> {
    const topic = getTopic(address);
    const message = this.bus.dequeue(topic);

    if (!message) {
      return null;
    }

    if (options?.manualAck) {
      return {
        ...message,
        ack: async () => {
          // Dequeue already removed it, so this is a no-op.
        },
        nack: async (requeue = false) => {
          if (requeue) {
            this.bus.requeue(topic, message);
          }
        },
      };
    }

    return message;
  }

  protected async _status(address: URL): Promise<MailboxStatus> {
    const topic = getTopic(address);
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
      const topic = getTopic(message.to);
      this.bus.requeue(topic, message);
    }
    // Otherwise, the message is simply dropped.
  }
}