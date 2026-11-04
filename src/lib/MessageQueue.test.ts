import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MailMessageQueue, MailMessageAckable, SettlingAckable, DEFAULT_ACK_TIMEOUT } from './MessageQueue';

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
      const first = queue.dequeue(topic1, { manualAck: true }) as SettlingAckable<TestMessage>;
      expect(first.id).toBe(msg1.id);

      first.nack(true);

      expect(queue.getStatus(topic1).unreadCount).toBe(2);
      expect(queue.dequeue(topic1)!.id).toBe(msg1.id);
    });

    it('should not enqueue a duplicate copy of a message already in the queue', () => {
      // 同一份信重复回队只保留一份：否则 N 个订阅者各自失败会在队列里留下 N 份副本。
      queue.enqueue(topic1, msg1);
      queue.requeue(topic1, msg1);
      queue.requeue(topic1, msg1);

      expect(queue.getStatus(topic1).unreadCount).toBe(1);
    });

    it('should not enqueue a copy of a message that is currently in-flight', () => {
      // 就是这一份正在被 fetch 处理，再插一份就是重复投递。（同 id 的**另一份**信不受影响，
      // 那本账分开记，见 `MessageQueue.identity.test.ts`。）
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
      const ackable = queue.dequeue(topic1, { manualAck: true }) as SettlingAckable<TestMessage>;
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
      expect(typeof (result as SettlingAckable<TestMessage>).ack).toBe('function');
      expect(typeof (result as SettlingAckable<TestMessage>).nack).toBe('function');
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
      const ackableMsg = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as SettlingAckable<TestMessage>;

      await ackableMsg.ack();

      // Trigger requeueStale to be sure it's not just in-flight
      vi.advanceTimersByTime(ACK_TIMEOUT + 1);
      const result = queue.dequeue(topic1);
      expect(result).toBeNull();
    });

    it('nack(false) should permanently remove the message', async () => {
      queue.enqueue(topic1, msg1);
      const ackableMsg = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as SettlingAckable<TestMessage>;

      await ackableMsg.nack(false); // Do not requeue

      const result = queue.dequeue(topic1);
      expect(result).toBeNull();
    });

    it('nack(true) should add the message back to the front of the queue', async () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2); // msg2 is now at the end
      const ackableMsg = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as SettlingAckable<TestMessage>; // Dequeues msg1
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
      const ackableMsg = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as SettlingAckable<TestMessage>;
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
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 2, inFlightCount: 0 });

      const ackableMsg1 = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as SettlingAckable<TestMessage>;
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 1, inFlightCount: 1 });

      const ackableMsg2 = queue.dequeue(topic1, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as SettlingAckable<TestMessage>;
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 2 });

      // ack 与 nack(false) 都会把消息从 in-flight 中除名
      await ackableMsg1.ack();
      expect(queue.getStatus(topic1).inFlightCount).toBe(1);
      await ackableMsg2.nack(false);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
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

      const ackableMsg = queue.dequeue(topic1, { manualAck: true }) as SettlingAckable<TestMessage>;
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

  // issue#3：队列状态必须能被清掉，否则同一进程里的多个 Mailbox / 多个测试用例互相串台。
  describe('clear', () => {
    it('should drop only the given topic and report how many messages were dropped', () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2);
      queue.enqueue(topic2, msg2);

      expect(queue.clear(topic1)).toBe(2);

      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
      expect(queue.getStatus(topic2).unreadCount).toBe(1);
      expect(queue.dequeue(topic2)!.id).toBe(msg2.id);
    });

    it('should drop in-flight messages of the topic too, and they must not come back via nack(requeue)', async () => {
      // in-flight 也是队列状态的一部分：只清「等待中」的那半，测试跑完还是会看到残留消息。
      queue.enqueue(topic1, msg1);
      const inflight = queue.dequeue(topic1, { manualAck: true }) as SettlingAckable<TestMessage>;
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 1 });

      expect(queue.clear(topic1)).toBe(1);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
      expect(queue.has(msg1.id)).toBe(false);

      // 迟到的 ack / nack 不能再把已清理的消息放回队列（否则会“复活”成幽灵消息）。
      await inflight.ack();
      await inflight.nack(true);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
    });

    it('should drop every topic when called without arguments', () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic2, msg2);
      queue.dequeue(topic2, { manualAck: true });

      expect(queue.clear()).toBe(2); // topic1 的 1 条 + topic2 的 1 条 in-flight
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
      expect(queue.getStatus(topic2)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
    });

    it('should be idempotent and safe on an unknown topic', () => {
      queue.enqueue(topic1, msg1);
      expect(queue.clear(topic1)).toBe(1);
      expect(queue.clear(topic1)).toBe(0);
      expect(queue.clear('never-seen')).toBe(0);
      expect(queue.clear()).toBe(0);

      // 清空后队列还能照常使用
      queue.enqueue(topic1, msg1);
      expect(queue.dequeue(topic1)!.id).toBe(msg1.id);
    });
  });

  // issue#4：缺只读语义。之前只能 `fetch({ manualAck: true })` 不 ack，“看一眼”
  // 会把消息弄进 in-flight（默认 30s 后重投），干扰正常消费者的 unreadCount / inFlightCount。
  describe('peek（只读快照）', () => {
    it('返回头部消息副本，不出队、不建 in-flight', () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2);

      const snapshot = queue.peek(topic1);

      expect(snapshot.map((m) => m.id)).toEqual([msg1.id, msg2.id]);
      // 关键：快照完全不留痕迹
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 2, inFlightCount: 0 });
      expect(queue.has(msg1.id)).toBe(true);
    });

    it('空队列 / 不存在的 topic 都是空数组（不是 null）', () => {
      expect(queue.peek(topic1)).toEqual([]);
      expect(queue.peek('never-seen')).toEqual([]);
      expect(queue.peek('never-seen', 3)).toEqual([]);
    });

    it('返回的是副本：改它不会污染队列里的那一份', () => {
      queue.enqueue(topic1, { id: 'msg-1', payload: 'original' });

      const [copy] = queue.peek(topic1);
      copy.payload = 'mutated by the observer';
      (copy as TestMessage & { extra?: string }).extra = 'should not leak';

      expect(queue.peek(topic1)[0].payload).toBe('original');
      expect(queue.dequeue(topic1)).toEqual({ id: 'msg-1', payload: 'original' });
    });

    it('limit 只取头部 N 条；0 是空快照，Infinity 与省略都是整个队列', () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2);
      queue.enqueue(topic1, { id: 'msg-3', payload: 'message 3' });

      expect(queue.peek(topic1, 0)).toEqual([]);
      expect(queue.peek(topic1, 2).map((m) => m.id)).toEqual([msg1.id, msg2.id]);
      expect(queue.peek(topic1, 99).map((m) => m.id)).toEqual([msg1.id, msg2.id, 'msg-3']);
      expect(queue.peek(topic1, Number.POSITIVE_INFINITY).length).toBe(3);
      expect(queue.getStatus(topic1).unreadCount).toBe(3); // limit 不消耗消息
    });

    it('非法 limit 直接报错，不能静默退化成“取全部”', () => {
      queue.enqueue(topic1, msg1);

      for (const bad of [-1, -Infinity, 1.5, Number.NaN]) {
        expect(() => queue.peek(topic1, bad)).toThrow(/non-negative integer/);
      }
      expect(queue.getStatus(topic1).unreadCount).toBe(1);
    });

    it('不偷看 in-flight：已被取走、尚未 ack 的消息属于那个消费者', async () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, msg2);
      const inflight = queue.dequeue(topic1, { manualAck: true }) as SettlingAckable<TestMessage>;

      expect(queue.peek(topic1).map((m) => m.id)).toEqual([msg2.id]);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 1, inFlightCount: 1 });

      await inflight.nack(true);
      expect(queue.peek(topic1).map((m) => m.id)).toEqual([msg1.id, msg2.id]);
    });

    it('反复快照不推进 stale 扫描：不会把 in-flight 消息提前换回队列', async () => {
      queue.enqueue(topic1, msg1);
      const inflight = queue.dequeue(topic1, { manualAck: true, ackTimeout: 100 }) as SettlingAckable<TestMessage>;

      await vi.advanceTimersByTimeAsync(500); // 已超过 ackTimeout
      expect(queue.peek(topic1)).toEqual([]); // 只读操作不能触发 stale 重投
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 1 });

      await inflight.ack();
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
    });
  });

  describe('hasTopic / topics（地址存在性与枚举）', () => {
    it('hasTopic 在入队后为真，取走后为假，in-flight 期间仍为真', async () => {
      expect(queue.hasTopic(topic1)).toBe(false);

      queue.enqueue(topic1, msg1);
      expect(queue.hasTopic(topic1)).toBe(true);

      const inflight = queue.dequeue(topic1, { manualAck: true }) as SettlingAckable<TestMessage>;
      expect(queue.hasTopic(topic1)).toBe(true); // 只是离开队列，并未处理完

      await inflight.ack();
      expect(queue.hasTopic(topic1)).toBe(false);
    });

    it('topics() 只列出有消息（等待中或 in-flight）的 topic，且按字典序', () => {
      queue.enqueue(topic2, msg2);
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic1, { id: 'msg-3', payload: 'message 3' });
      expect(queue.topics()).toEqual([topic1, topic2]);

      queue.clear(topic1);
      expect(queue.topics()).toEqual([topic2]);

      queue.dequeue(topic2, { manualAck: true });
      expect(queue.topics()).toEqual([topic2]); // in-flight 也算这个 topic 还有痕迹
    });
  });

  /**
   * 一次 fetch = 一次处置。
   *
   * 上层（`MemoryProvider` 的死信接法）要靠「这次处置到底落没落」来决定要不要留死信记录，
   * 所以队列必须**报告**处置结果，而不是静默 no-op：
   *   - `true` = 这一次真的把消息从 in-flight 结算掉了；
   *   - `false` = 这条已经不在了（重复处置 / 已被 stale 重投 / 已被 clear 丢弃）。
   * 静默 no-op 会让上层以为「放弃发生了」，于是重复死信、或给已被别人处理的消息写死信。
   */
  describe('一次处置：ack / nack 的幂等与归属', () => {
    const ACK_TIMEOUT = 10_000;

    const inflightOf = (topic: string, message: TestMessage) =>
      queue.dequeue(topic, { manualAck: true, ackTimeout: ACK_TIMEOUT }) as SettlingAckable<TestMessage>;

    it('[语义] ack / nack 报告这次处置是否真的落定', async () => {
      queue.enqueue(topic1, msg1);
      const inflight = inflightOf(topic1, msg1);

      expect(await inflight.ack()).toBe(true);
    });

    it('[语义] 重复 nack(false) 返回 false，且不产生第二次效果', async () => {
      queue.enqueue(topic1, msg1);
      const inflight = inflightOf(topic1, msg1);

      expect(await inflight.nack(false)).toBe(true);
      expect(await inflight.nack(false)).toBe(false);
      expect(await inflight.nack(true)).toBe(false); // 已放弃：之后再喊回队也不作数

      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
    });

    it('[语义] nack(true) 之后再 nack(false) 不作数：回队的消息不会被判死刑', async () => {
      queue.enqueue(topic1, msg1);
      const inflight = inflightOf(topic1, msg1);

      expect(await inflight.nack(true)).toBe(true);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 1, inFlightCount: 0 });

      expect(await inflight.nack(false)).toBe(false);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 1, inFlightCount: 0 });
    });

    it('[语义] ack 之后的 nack 不作数：已确认的消息不会被退回队列，也不会被丢弃', async () => {
      queue.enqueue(topic1, msg1);
      const inflight = inflightOf(topic1, msg1);

      expect(await inflight.ack()).toBe(true);
      expect(await inflight.nack(true)).toBe(false);
      expect(await inflight.nack(false)).toBe(false);
      expect(await inflight.ack()).toBe(false);

      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
    });

    it('[语义] 处置只认自己那一次 fetch：stale 重投后的旧 handle 不能动新消费者的 in-flight', async () => {
      queue.enqueue(topic1, msg1);
      const stale = inflightOf(topic1, msg1);

      vi.advanceTimersByTime(ACK_TIMEOUT + 1);
      // 下一次 dequeue 触发 stale 扫描：同一条消息交给新的消费者
      const fresh = inflightOf(topic1, msg1);
      expect(fresh.id).toBe(msg1.id);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 1 });

      // 旧 handle 现在手里没有东西可结算：既不能把新消费者的 in-flight 抹掉，也不能再回队
      expect(await stale.nack(false)).toBe(false);
      expect(await stale.nack(true)).toBe(false);
      expect(await stale.ack()).toBe(false);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 1 });

      // 新消费者的处置照旧有效
      expect(await fresh.ack()).toBe(true);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
    });

    it('[语义] 被 clear() 丢弃的 in-flight：之后的 ack / nack 报告 false，不复活消息', async () => {
      queue.enqueue(topic1, msg1);
      const inflight = inflightOf(topic1, msg1);

      expect(queue.clear(topic1)).toBe(1);

      expect(await inflight.nack(false)).toBe(false);
      expect(await inflight.nack(true)).toBe(false);
      expect(await inflight.ack()).toBe(false);
      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
    });

    it('[事实] 队列的 ackable 仍是普通信封 + 两个处置方法（忽略返回值的用法不变）', async () => {
      queue.enqueue(topic1, msg1);
      const inflight = inflightOf(topic1, msg1);

      const envelope: Omit<MailMessageAckable<TestMessage>, 'ack' | 'nack'> = inflight;
      expect(envelope.id).toBe(msg1.id);

      await inflight.ack(); // 不读 boolean 的老写法仍然成立
      expect(queue.getStatus(topic1).inFlightCount).toBe(0);
    });

    it('[语义] 不带 handle 的结算只认份号；拿发送方的消息 id 不再命中', async () => {
      queue.enqueue(topic1, msg1);
      queue.enqueue(topic2, msg2);
      inflightOf(topic1, msg1);
      inflightOf(topic2, msg2);

      // 发送方的名字只能用来查，不能用来动手
      expect(queue.nack(msg1.id, false)).toBe(false);
      expect(queue.ack(msg2.id)).toBe(false);
      expect(queue.getStatus(topic1).inFlightCount).toBe(1);
      expect(queue.getStatus(topic2).inFlightCount).toBe(1);

      const key1 = queue.locate(msg1.id)[0]!.key
      const key2 = queue.locate(msg2.id)[0]!.key
      expect(queue.nack(key1, false)).toBe(true);
      expect(queue.nack(key1, false)).toBe(false);
      expect(queue.ack(key2)).toBe(true);
      expect(queue.ack(key2)).toBe(false);
      expect(queue.nack('never-was', false)).toBe(false);

      expect(queue.getStatus(topic1)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
      expect(queue.getStatus(topic2)).toMatchObject({ unreadCount: 0, inFlightCount: 0 });
    });

    it('[事实] 队列自带的 ackable 句柄也走同一套归属判定（重复 ack 不会误伤后来者）', async () => {
      queue.enqueue(topic1, msg1);
      const stale = inflightOf(topic1, msg1);
      vi.advanceTimersByTime(ACK_TIMEOUT + 1);
      inflightOf(topic1, msg1); // 重投给新消费者

      await stale.ack(); // 旧 handle 迟到
      expect(queue.getStatus(topic1).inFlightCount).toBe(1);
    });
  });
});
