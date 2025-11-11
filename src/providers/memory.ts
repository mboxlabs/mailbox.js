import {
  AckableMailMessage,
  IMailboxProvider,
  MailboxStatus,
  MailMessage,
  Subscription,
} from '../interfaces';

type Listener = (message: MailMessage) => void | Promise<void>;

// A simple in-memory event bus to simulate message passing between different instances.
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

export class MemoryProvider implements IMailboxProvider {
  public protocol = 'mem';
  private bus = MemoryEventBus.getInstance();

  async send(message: MailMessage): Promise<void> {
    const topic = getTopic(message.to);

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1));

    this.bus.publish(topic, {
      ...message,
      headers: {
        ...message.headers,
        'x-sent-at': new Date().toISOString(),
      },
    });
  }

  subscribe(
    address: URL,
    onReceive: (message: MailMessage) => void | Promise<void>,
  ): Subscription {
    const topic = getTopic(address);
    const id = crypto.randomUUID();

    const unsubscribe = this.bus.subscribe(topic, onReceive);

    const subscription: Subscription = {
      id,
      address,
      status: 'active',
      unsubscribe: async () => {
        unsubscribe();
        (subscription as { status: 'closed' }).status = 'closed';
      },
    };

    return subscription;
  }

  // Add overloads to the implementation to match the interface
  fetch(
    address: URL,
    options: { manualAck: true },
  ): Promise<AckableMailMessage | null>;
  fetch(
    address: URL,
    options?: { manualAck?: false },
  ): Promise<MailMessage | null>;
  async fetch(
    address: URL,
    options?: { manualAck?: boolean },
  ): Promise<MailMessage | AckableMailMessage | null> {
    const topic = getTopic(address);
    const message = this.bus.dequeue(topic);

    if (!message) {
      return null;
    }

    if (options?.manualAck) {
      const ackableMessage: AckableMailMessage = {
        ...message,
        ack: async () => {
          // In a real scenario, this would confirm the message removal.
          // In our memory queue, dequeue already removed it, so this is a no-op.
        },
        nack: async (requeue = false) => {
          if (requeue) {
            this.bus.requeue(topic, message);
          }
        },
      };
      return ackableMessage;
    }

    return message;
  }

  async status(address: URL): Promise<MailboxStatus> {
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
}