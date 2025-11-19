// src/lib/MessageQueue.ts

/**
 * Represents a message that can be manually acknowledged or negatively acknowledged.
 * @template T The type of the message payload.
 */
export type Ackable<T> = T & {
  /**
   * Acknowledges the message, confirming successful processing.
   */
  ack: () => Promise<void>;
  /**
   * Negatively acknowledges the message, indicating failure to process.
   * @param requeue If true, the message will be added back to the front of the queue. Defaults to false.
   */
  nack: (requeue?: boolean) => Promise<void>;
};

/**
 * A generic, in-memory message queue that supports topic-based queuing and manual acknowledgement.
 *
 * This class provides a reliable queuing mechanism for producer-consumer patterns where consumers
 * might fail and need to retry messages. It features:
 * - Topic-based separation of queues.
 * - FIFO (First-In, First-Out) message delivery.
 * - Auto-acknowledgement mode (fire-and-forget).
 * - Manual acknowledgement mode, which places messages "in-flight" until they are explicitly
 *   acknowledged (`ack`) or negatively acknowledged (`nack`).
 * - Timeout-based requeueing for stale in-flight messages to prevent message loss.
 *
 * @template T The type of messages in the queue. Must have an `id` property of type string.
 */
export class MessageQueue<T extends { id: string }> {
  private queues: Map<string, T[]> = new Map();
  // Stores in-flight messages with their original topic for reliable requeueing.
  private inFlight: Map<string, { message: T; timestamp: number; topic: string }> = new Map();

  /**
   * Adds a message to the end of a specific topic's queue.
   * @param topic The topic to which the message will be added.
   * @param message The message to enqueue.
   */
  public enqueue(topic: string, message: T): void {
    if (!this.queues.has(topic)) {
      this.queues.set(topic, []);
    }
    this.queues.get(topic)!.push(message);
  }

  /**
   * Dequeues a message from the front of a specific topic's queue.
   *
   * In auto-ack mode (`manualAck: false`), it removes and returns the message.
   * In manual-ack mode (`manualAck: true`), it moves the message to an "in-flight" state
   * and returns an `Ackable` message with `ack` and `nack` methods.
   * The method also triggers a check for stale messages if a timeout is provided.
   *
   * @param topic The topic from which to dequeue a message.
   * @param options Options for the dequeue operation.
   * @param options.manualAck If true, enables manual acknowledgement mode. Defaults to false.
   * @param options.ackTimeout In manual-ack mode, the time in milliseconds after which an
   *   unacknowledged message is considered stale and will be requeued on the next dequeue.
   * @returns An `Ackable` message in manual-ack mode, a regular message in auto-ack mode, or `null` if the queue is empty.
   */
  public dequeue(
    topic: string,
    options: { manualAck: true; ackTimeout: number }
  ): Ackable<T> | null;
  public dequeue(
    topic: string,
    options?: { manualAck?: false }
  ): T | null;
  public dequeue(
    topic: string,
    options?: { manualAck?: boolean; ackTimeout?: number }
  ): T | Ackable<T> | null {
    // Requeue stale messages if manualAck is enabled and timeout is provided
    if (options?.manualAck && options?.ackTimeout) {
      this.requeueStale(topic, options.ackTimeout);
    }

    const messages = this.queues.get(topic);
    if (!messages || messages.length === 0) {
      return null;
    }

    const message = messages.shift()!; // Consume a message from the queue in FIFO order.

    if (!options?.manualAck) {
      return message; // Auto-ack: simply return the message.
    }

    // Manual-ack: move message to in-flight and wrap with ack/nack functions.
    // Store the topic along with the message in inFlight
    this.inFlight.set(message.id, { message, timestamp: Date.now(), topic });

    return {
      ...message,
      ack: async () => {
        this.ack(message.id);
      },
      nack: async (requeue = false) => {
        this.nack(message.id, topic, requeue); // Pass topic to nack
      },
    };
  }

  /**
   * Acknowledges a message, permanently removing it from the in-flight state.
   * @param messageId The ID of the message to acknowledge.
   */
  public ack(messageId: string): void {
    this.inFlight.delete(messageId);
  }

  /**
   * Negatively acknowledges a message, removing it from the in-flight state.
   * If `requeue` is true, the message is added back to the front of its original queue.
   * @param messageId The ID of the message to nack.
   * @param topic The topic the message belongs to. This is used for requeueing.
   * @param requeue If true, the message is re-added to the front of the queue.
   */
  public nack(messageId: string, topic: string, requeue: boolean): void {
    const flight = this.inFlight.get(messageId);
    if (flight) {
      this.inFlight.delete(messageId);
      if (requeue) {
        // Use the topic stored in inFlight for reliability
        this.requeue(flight.topic, flight.message);
      }
    }
  }

  /**
   * Gets the current status of a topic's queue.
   * @param topic The topic to query.
   * @returns An object containing status information, like the number of unread messages.
   */
  public getStatus(topic: string): { unreadCount: number } {
    const queue = this.queues.get(topic) || [];
    return {
      unreadCount: queue.length,
    };
  }
  
  /**
   * Adds a message back to the front of its queue. Used for requeueing.
   * @param topic The topic of the queue.
   * @param message The message to requeue.
   */
  private requeue(topic: string, message: T): void {
    if (!this.queues.has(topic)) {
      this.queues.set(topic, []);
    }
    this.queues.get(topic)!.unshift(message); // Add back to the front
  }

  /**
   * Scans for and requeues in-flight messages for a specific topic that have exceeded their timeout.
   * This is a recovery mechanism to prevent message loss if a consumer fails.
   * @param topic The topic to check for stale messages.
   * @param timeout The timeout in milliseconds.
   */
  private requeueStale(topic: string, timeout: number): void {
    const now = Date.now();
    // Use Array.from to safely iterate while potentially modifying the map
    for (const [messageId, { message, timestamp, topic: messageTopic }] of Array.from(this.inFlight.entries())) {
      // Check if the message belongs to the topic we are checking and is stale
      if (messageTopic === topic && now - timestamp > timeout) {
        this.inFlight.delete(messageId);
        this.requeue(messageTopic, message);
      }
    }
  }
}
