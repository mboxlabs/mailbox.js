import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MailMessageQueue, MailMessageAckable, DEFAULT_ACK_TIMEOUT } from './MessageQueue';

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
  // const msg3: TestMessage = { id: 'msg-3', payload: 'message 3' };

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

  describe('requeue', () => {
    it('should put a message back at the head of the queue', () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2);
      const first = queue.dequeue(topic1, { manualAck: true }) as MailMessageAckable<TestMessage>;
      expect(first.id).toBe(msg1.id);

      first.nack(true);

      expect(queue.getStatus(topic1).unreadCount).toBe(2);
      expect(queue.dequeue(topic1)!.id).toBe(msg1.id);
    });

    it('should not enqueue a duplicate copy of a message already in the queue', () => {
      // 同一 id 重复回队只保留一份：否则 N 个订阅者各自失败会在队列里留下 N 份副本。
      queue.enqueue(topic1, msg1);
      queue.requeue(topic1, msg1);
      queue.requeue(topic1, msg1);

      expect(queue.getStatus(topic1).unreadCount).toBe(1);
    });

    it('should not enqueue a copy of a message that is currently in-flight', () => {
      // 回队给一个正在被 fetch 处理的消息会同时投递两份。
      queue.enqueue(topic1, msg1);
      queue.dequeue(topic1, { manualAck: true });

      queue.requeue(topic1, msg1);

      expect(queue.getStatus(topic1).unreadCount).toBe(0);
      expect(queue.getStatus(topic1).inFlightCount).toBe(1);
    });

    it('should requeue a message that is neither queued nor in-flight', () => {
      // 订阅路径失败时消息不在队列里，回队必须生效。
      queue.requeue(topic1, msg1);

      expect(queue.getStatus(topic1).unreadCount).toBe(1);
      expect(queue.dequeue(topic1)!.id).toBe(msg1.id);
    });

    it('should requeue the same id again after it was dequeued', () => {
      // 去重不能把「已处理完」也当成重复，否则重试永远进不了队列。
      queue.enqueue(topic1, msg1);
      const ackable = queue.dequeue(topic1, { manualAck: true }) as MailMessageAckable<TestMessage>;
      ackable.nack(true);

      expect(queue.getStatus(topic1).unreadCount).toBe(1);
      expect(queue.dequeue(topic1, { manualAck: true })!.id).toBe(msg1.id);
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
  });

  describe('getStatus in-flight accounting', () => {
    const ACK_TIMEOUT = 10000;

    it('should report in-flight messages separately from the queue', async () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2);
      expect(queue.getStatus(topic1)).toEqual({ unreadCount: 2, inFlightCount: 0 });

      const ackableMsg1 = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as MailMessageAckable<TestMessage>;
      expect(queue.getStatus(topic1)).toEqual({ unreadCount: 1, inFlightCount: 1 });

      const ackableMsg2 = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as MailMessageAckable<TestMessage>;
      expect(queue.getStatus(topic1)).toEqual({ unreadCount: 0, inFlightCount: 2 });

      // ack 与 nack(false) 都会把消息从 in-flight 中除名
      await ackableMsg1.ack();
      expect(queue.getStatus(topic1).inFlightCount).toBe(1);
      await ackableMsg2.nack(false);
      expect(queue.getStatus(topic1)).toEqual({ unreadCount: 0, inFlightCount: 0 });
    });

    it('should count in-flight per topic', () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic2, msg2);

      queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT });

      expect(queue.getStatus(topic1).inFlightCount).toBe(1);
      expect(queue.getStatus(topic2).inFlightCount).toBe(0);
    });

  });

  describe('stale requeue and the default ack timeout', () => {
    const ACK_TIMEOUT = 10000;

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

    it('should requeue a never-acked message even without an explicit ackTimeout', () => {
      // 不传 ackTimeout 不能等价于“永不超时”：消费者崩溃后消息会卡在 in-flight，
      // 既取不回来也不在状态里可见，等于静默丢失。
      queue.enqueue(topic1, msg1);

      const ackableMsg = queue.dequeue(topic1, { manualAck: true }) as MailMessageAckable<TestMessage>;
      expect(ackableMsg.id).toBe(msg1.id);
      expect(queue.dequeue(topic1, { manualAck: true })).toBeNull();

      vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT + 1);

      const recovered = queue.dequeue(topic1, { manualAck: true });
      expect(recovered).not.toBeNull();
      expect(recovered!.id).toBe(msg1.id);
    });

    it('should keep a message in-flight when the stale check is disabled with 0 or null', () => {
      // 显式关闭超时的出口（三端一致：0 / null = 关闭）：常驻 in-flight，直到 ack/nack。
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic2, msg2);
      queue.dequeue(topic1, { manualAck: true, ackTimeout: 0 });
      queue.dequeue(topic2, { manualAck: true, ackTimeout: null });

      vi.advanceTimersByTime(DEFAULT_ACK_TIMEOUT * 10);

      expect(queue.dequeue(topic1, { manualAck: true, ackTimeout: 0 })).toBeNull();
      expect(queue.dequeue(topic2, { manualAck: true, ackTimeout: null })).toBeNull();
      expect(queue.getStatus(topic1).inFlightCount).toBe(1);
      expect(queue.getStatus(topic2).inFlightCount).toBe(1);
    });
  });
});
