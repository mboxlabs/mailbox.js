import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MailMessageQueue, MailMessageAckable } from './MessageQueue';

// Define a simple message type for testing
interface TestMessage {
  id: string;
  payload: string;
}

describe('MessageQueue', () => {
  let queue: MailMessageQueue<TestMessage>;
  const topic1 = 'topic-1';
  const topic2 = 'topic-2';
  const msg1: TestMessage = { id: 'msg-1', payload: 'message 1' };
  const msg2: TestMessage = { id: 'msg-2', payload: 'message 2' };
  const msg3: TestMessage = { id: 'msg-3', payload: 'message 3' };

  beforeEach(() => {
    queue = new MailMessageQueue<TestMessage>();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('enqueue and getStatus', () => {
    it('should add a message to the correct topic queue', () => {
      queue.enqueue(topic1, msg1);
      expect(queue.getStatus(topic1).unreadCount).toBe(1);
      expect(queue.getStatus(topic2).unreadCount).toBe(0);
    });

    it('should add multiple messages to the queue', () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2);
      expect(queue.getStatus(topic1).unreadCount).toBe(2);
    });
  });

  describe('dequeue (auto-ack mode)', () => {
    it('should return null if the queue is empty', () => {
      const result = queue.dequeue(topic1);
      expect(result).toBeNull();
    });

    it('should return messages in FIFO order', () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2);

      const dequeued1 = queue.dequeue(topic1);
      const dequeued2 = queue.dequeue(topic1);

      expect(dequeued1).toEqual(msg1);
      expect(dequeued2).toEqual(msg2);
    });

    it('should remove the message from the queue', () => {
      queue.enqueue(topic1, msg1);
      queue.dequeue(topic1);
      expect(queue.getStatus(topic1).unreadCount).toBe(0);
    });

    it('should only dequeue from the specified topic', () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic2, msg2);

      const result = queue.dequeue(topic1);
      expect(result).toEqual(msg1);
      expect(queue.getStatus(topic1).unreadCount).toBe(0);
      expect(queue.getStatus(topic2).unreadCount).toBe(1);
    });
  });

  describe('dequeue (manual-ack mode)', () => {
    const ACK_TIMEOUT = 10000;

    it('should return an Ackable message', () => {
      queue.enqueue(topic1, msg1);
      const result = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT });

      expect(result).not.toBeNull();
      expect(result!.id).toBe(msg1.id);
      expect(typeof (result as MailMessageAckable<TestMessage>).ack).toBe('function');
      expect(typeof (result as MailMessageAckable<TestMessage>).nack).toBe('function');
    });

    it('should move the message to in-flight, making it unavailable for dequeue', () => {
      queue.enqueue(topic1, msg1);
      queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT });

      expect(queue.getStatus(topic1).unreadCount).toBe(0);
      const secondAttempt = queue.dequeue(topic1);
      expect(secondAttempt).toBeNull();
    });

    it('ack() should permanently remove the message', async () => {
      queue.enqueue(topic1, msg1);
      const ackableMsg = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as MailMessageAckable<TestMessage>;

      await ackableMsg.ack();

      // Trigger requeueStale to be sure it's not just in-flight
      vi.advanceTimersByTime(ACK_TIMEOUT + 1);
      const result = queue.dequeue(topic1);
      expect(result).toBeNull();
    });

    it('nack(false) should permanently remove the message', async () => {
      queue.enqueue(topic1, msg1);
      const ackableMsg = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as MailMessageAckable<TestMessage>;

      await ackableMsg.nack(false); // Do not requeue

      const result = queue.dequeue(topic1);
      expect(result).toBeNull();
    });

    it('nack(true) should add the message back to the front of the queue', async () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2); // msg2 is now at the end
      const ackableMsg = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as MailMessageAckable<TestMessage>; // Dequeues msg1
      expect(ackableMsg.id).toBe(msg1.id);

      await ackableMsg.nack(true); // Requeue msg1

      expect(queue.getStatus(topic1).unreadCount).toBe(2);

      const nextMsg = queue.dequeue(topic1); // Should be msg1 again
      expect(nextMsg!.id).toBe(msg1.id);

      const lastMsg = queue.dequeue(topic1); // Should be msg2
      expect(lastMsg!.id).toBe(msg2.id);
    });

    it('should requeue a stale message on next dequeue', () => {
      queue.enqueue(topic1, msg1);

      // Dequeue a message and let it go stale
      const ackableMsg = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as MailMessageAckable<TestMessage>;
      expect(ackableMsg).not.toBeNull();
      expect(queue.getStatus(topic1).unreadCount).toBe(0);

      // Advance time past the timeout
      vi.advanceTimersByTime(ACK_TIMEOUT + 1);

      // Next dequeue on the same topic should trigger requeueStale and return the original message
      const requeuedMsg = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT });
      expect(requeuedMsg).not.toBeNull();
      expect(requeuedMsg!.id).toBe(msg1.id);
      expect(queue.getStatus(topic1).unreadCount).toBe(0); // It's now in-flight again
    });

    it('should not requeue a stale message from a different topic', () => {
        queue.enqueue(topic1, msg1);
        queue.enqueue(topic2, msg2);

        // Dequeue from topic1 and let it go stale
        queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT });
        vi.advanceTimersByTime(ACK_TIMEOUT + 1);

        // Dequeue from topic2 - this should NOT trigger a requeue for topic1
        const resultFromTopic2 = queue.dequeue(topic2, { manualAck: true, ackTimeout: ACK_TIMEOUT });
        expect(resultFromTopic2!.id).toBe(msg2.id);

        // Topic1's queue should still be empty as requeueStale wasn't triggered for it
        expect(queue.getStatus(topic1).unreadCount).toBe(0);

        // Now, dequeue from topic1 to trigger its own stale check
        const resultFromTopic1 = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT });
        expect(resultFromTopic1!.id).toBe(msg1.id);
      });
  });
});
