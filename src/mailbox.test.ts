import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { Mailbox } from './mailbox';
import { MemoryProvider } from './providers/memory';
import { DEFAULT_ACK_TIMEOUT } from './lib';
import type { MailMessage, AckableMailMessage, IMailboxProvider } from './interfaces';

describe('Mailbox', () => {
  let mailbox: Mailbox;
  let memoryProvider: MemoryProvider;

  beforeEach(async () => {
    mailbox = new Mailbox();
    memoryProvider = new MemoryProvider();
    mailbox.registerProvider(memoryProvider);
    await mailbox.start();
  });

  afterEach(async () => {
    await mailbox.stop();
    vi.useRealTimers(); // Restore real timers after each test
  });

  it('should call init on all providers during start', async () => {
    const mockProvider: IMailboxProvider = {
      protocol: 'mock',
      init: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
      subscribe: vi.fn(),
      fetch: vi.fn(),
      generateId: () => 'id',
    };
    const newMailbox = new Mailbox();
    newMailbox.registerProvider(mockProvider);
    await newMailbox.start();
    expect(mockProvider.init).toHaveBeenCalled();
  });

  it('should call close on all providers during stop and cleanup subscriptions', async () => {
    const address = 'mem://test/stop-cleanup';
    const onReceive = vi.fn();
    const subscription = mailbox.subscribe(address, onReceive);
    expect(subscription.status).toBe('active');

    await mailbox.stop();
    expect(subscription.status).toBe('closed');

    // After stop, posting a message should not trigger the callback
    await mailbox.post({ from: 'mem://a', to: address, body: 'after stop' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(onReceive).not.toHaveBeenCalled();
  });

  it('should register a provider', () => {
    const newMailbox = new Mailbox();
    const provider = new MemoryProvider();
    newMailbox.registerProvider(provider);
    expect(newMailbox.providers.get('mem')).toBe(provider);
  });

  it('should throw an error if no provider is found for a protocol', async () => {
    const newMailbox = new Mailbox();
    const mail = {
      from: 'mem://test-from',
      to: 'unknown://test-to',
      body: 'hello',
    };
    await expect(newMailbox.post(mail)).rejects.toThrow('No provider for protocol: unknown:');
  });

  it('should post a message and receive it via subscribe', async () => {
    const toAddress = 'mem://user@service/inbox';
    const fromAddress = 'mem://user@client';
    const messageBody = { content: 'Hello, World!' };

    const onReceive = vi.fn();
    mailbox.subscribe(toAddress, onReceive);

    await mailbox.post({
      from: fromAddress,
      to: toAddress,
      body: messageBody,
    });

    // Need to wait a bit for the async post and event loop
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onReceive).toHaveBeenCalledOnce();
    const receivedMessage: MailMessage = onReceive.mock.calls[0][0];
    expect(receivedMessage.body).toEqual(messageBody);
    expect(receivedMessage.from.toString()).toBe(`${fromAddress}`);
    expect(receivedMessage.to.toString()).toBe(toAddress);
    expect(receivedMessage.headers).toHaveProperty('mbx-sent-at');
  });

  it('should allow unsubscribing from an address', async () => {
    const address = 'mem://test/unsubscribe';
    const onReceive = vi.fn();

    const subscription = mailbox.subscribe(address, onReceive);
    expect(subscription.status).toBe('active');

    await subscription.unsubscribe();
    expect(subscription.status).toBe('closed');

    await mailbox.post({ from: 'mem://a', to: address, body: 'should not be received' });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onReceive).not.toHaveBeenCalled();
  });

  it('should fetch a message with auto-ack', async () => {
    const address = 'mem://test/fetch-auto';
    const mail = { from: 'mem://a', to: address, body: 'fetch me' };
    await mailbox.post(mail);

    const received = await mailbox.fetch(address);
    expect(received).not.toBeNull();
    expect(received!.body).toBe('fetch me');

    // The message should be gone after fetch (auto-acked)
    const shouldBeNull = await mailbox.fetch(address);
    expect(shouldBeNull).toBeNull();
  });

  it('should fetch a message with manual-ack and ack it', async () => {
    const address = 'mem://test/fetch-manual-ack';
    const mail = { from: 'mem://a', to: address, body: 'manual ack me' };
    await mailbox.post(mail);

    const received = await mailbox.fetch(address, { manualAck: true }) as AckableMailMessage;
    expect(received).not.toBeNull();
    expect(received.body).toBe('manual ack me');
    expect(typeof received.ack).toBe('function');
    expect(typeof received.nack).toBe('function');

    await received.ack();

    // The message should be gone after ack
    const shouldBeNull = await mailbox.fetch(address, { manualAck: true });
    expect(shouldBeNull).toBeNull();
  });

  it('should hold a message in-flight when fetched with manual-ack until ack/nack', async () => {
    const address = 'mem://test/fetch-in-flight';
    const mail = { from: 'mem://a', to: address, body: 'hold me in flight' };
    await mailbox.post(mail);

    // Fetch the message with manualAck
    const received1 = await mailbox.fetch(address, { manualAck: true }) as AckableMailMessage;
    expect(received1).not.toBeNull();
    expect(received1.body).toBe('hold me in flight');

    // Attempt to fetch again immediately - it should not be available as it's in-flight
    const shouldBeNull = await mailbox.fetch(address, { manualAck: true });
    expect(shouldBeNull).toBeNull();

    // Now, ack the message
    await received1.ack();

    // After ack, it should still not be available
    const shouldStillBeNull = await mailbox.fetch(address, { manualAck: true });
    expect(shouldStillBeNull).toBeNull();
  });

  it('should fetch a message with manual-ack and nack(requeue=true) it', async () => {
    const address = 'mem://test/fetch-manual-nack-requeue';
    const mail = { from: 'mem://a', to: address, body: 'nack and requeue me' };
    await mailbox.post(mail);

    // First fetch
    const received1 = await mailbox.fetch(address, { manualAck: true }) as AckableMailMessage;
    expect(received1).not.toBeNull();
    expect(received1.body).toBe('nack and requeue me');

    // Nack and requeue
    await received1.nack(true);

    // The message should be available again
    const received2 = await mailbox.fetch(address, { manualAck: true }) as AckableMailMessage;
    expect(received2).not.toBeNull();
    expect(received2.id).toBe(received1.id); // Should be the same message

    // Clean up by acking it
    await received2.ack();
    const shouldBeNull = await mailbox.fetch(address, { manualAck: true });
    expect(shouldBeNull).toBeNull();
  });

  it('should fetch a message with manual-ack and nack(requeue=false) it', async () => {
    const address = 'mem://test/fetch-manual-nack-no-requeue';
    const mail = { from: 'mem://a', to: address, body: 'nack and forget me' };
    await mailbox.post(mail);

    // First fetch
    const received = await mailbox.fetch(address, { manualAck: true }) as AckableMailMessage;
    expect(received).not.toBeNull();

    // Nack without requeue
    await received.nack(false);

    // The message should be gone
    const shouldBeNull = await mailbox.fetch(address, { manualAck: true });
    expect(shouldBeNull).toBeNull();
  });

  it('should requeue a message if not acked within a timeout', async () => {
    vi.useFakeTimers();
    const address = 'mem://test/fetch-timeout';
    const ACK_TIMEOUT = 30000; // 30 seconds

    // 1. Post a message
    await mailbox.post({ from: 'mem://a', to: address, body: 'timeout me' });

    // 2. Fetch it, simulating a consumer that will crash (i.e., not ack)
    const received1 = (await mailbox.fetch(address, {
      manualAck: true,
      ackTimeout: ACK_TIMEOUT,
    })) as AckableMailMessage;
    expect(received1).not.toBeNull();

    // 3. Verify it's in-flight (not available for immediate fetch)
    const shouldBeNull = await mailbox.fetch(address, { manualAck: true });
    expect(shouldBeNull).toBeNull();

    // 4. Advance time past the timeout
    vi.advanceTimersByTime(ACK_TIMEOUT + 100);

    // 5. Try to fetch again. The provider should find the stale message and requeue it.
    const received2 = (await mailbox.fetch(address, {
      manualAck: true,
      ackTimeout: ACK_TIMEOUT,
    })) as AckableMailMessage;

    // 6. Assert that the message was recovered
    expect(received2).not.toBeNull();
    expect(received2.id).toBe(received1.id);

    // Clean up
    await received2.ack();
    // 这个其实没用，因为一旦出错，这就不会执行，所以我放到了 afterEach，强制每次测试后useRealTimers
    // vi.useRealTimers();
  });

  it('should correctly route messages based on user@host address', async () => {
    const user1Address = 'mem://user1@testhost';
    const user2Address = 'mem://user2@testhost';
    const fromAddress = 'mem://test-from';
    const messageBody = { content: 'This is for user1' };

    const user1OnReceive = vi.fn();
    const user2OnReceive = vi.fn();

    mailbox.subscribe(user1Address, user1OnReceive);
    mailbox.subscribe(user2Address, user2OnReceive);

    await mailbox.post({
      from: fromAddress,
      to: user1Address,
      body: messageBody,
    });

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 10));

    // Check that only user1 received the message
    expect(user1OnReceive).toHaveBeenCalledOnce();
    expect(user2OnReceive).not.toHaveBeenCalled();

    const receivedMessage: MailMessage = user1OnReceive.mock.calls[0][0];
    expect(receivedMessage.body).toEqual(messageBody);
    expect(receivedMessage.to.toString()).toBe(user1Address);
  });

  describe('Provider access', () => {
    it('should expose providers via getter', () => {
      expect(mailbox.providers).toBeInstanceOf(Map);
      expect(mailbox.providers.has('mem')).toBe(true);
      expect(mailbox.providers.get('mem')).toBe(memoryProvider);
    });

    it('should return a provider via getProvider', () => {
      // Test with and without colon
      expect(mailbox.getProvider('mem')).toBe(memoryProvider);
      expect(mailbox.getProvider('mem:')).toBe(memoryProvider);
    });

    it('should return undefined if provider not found and raiseErrorIfFailed is false', () => {
      expect(mailbox.getProvider('unknown')).toBeUndefined();
    });

    it('should throw error if provider not found and raiseErrorIfFailed is true', () => {
      expect(() => mailbox.getProvider('unknown', true)).toThrow('No provider for protocol: unknown');
    });
  });
});

describe('status', () => {
  let mailbox: Mailbox;
  let memoryProvider: MemoryProvider;

  beforeEach(async () => {
    mailbox = new Mailbox();
    memoryProvider = new MemoryProvider();
    mailbox.registerProvider(memoryProvider);
    await mailbox.start();
  });

  afterEach(async () => {
    await mailbox.stop();
  });

  it('should return status for MemoryProvider', async () => {
    const address = 'mem://test/status';

    // 1. Initial status
    const initialStatus = await mailbox.status(address);
    expect(initialStatus.state).toBe('online');
    expect(initialStatus.unreadCount).toBe(0);
    expect(initialStatus.subscriberCount).toBe(0);
    expect(initialStatus.lastActivityTime).toBeUndefined();

    // 2. Post a message and check status
    await mailbox.post({ from: 'mem://a', to: address, body: 'status check 1' });
    const afterPostStatus = await mailbox.status(address);
    expect(afterPostStatus.unreadCount).toBe(1);
    expect(afterPostStatus.lastActivityTime).toBeTypeOf('string');

    // 3. Subscribe and check status
    const subscription = mailbox.subscribe(address, () => {});
    const afterSubscribeStatus = await mailbox.status(address);
    expect(afterSubscribeStatus.subscriberCount).toBe(1);

    // 4. Fetch message and check status
    await mailbox.fetch(address);
    const afterFetchStatus = await mailbox.status(address);
    expect(afterFetchStatus.unreadCount).toBe(0);

    // 5. Unsubscribe and check status
    await subscription.unsubscribe();
    // Note: MemoryProvider doesn't track subscriber count decrease in this simple model,
    // but we can test that the core logic runs. The bus still holds the topic.
    const finalStatus = await mailbox.status(address);
    expect(finalStatus.subscriberCount).toBe(0); // This will pass because the listener is removed.
  });

  it('should return a default status for providers without status implementation', async () => {
    // 1. Create a mock provider without status()
    const mockProvider: IMailboxProvider = {
      protocol: 'mock',
      send: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      fetch: vi.fn().mockResolvedValue(null),
      generateId: () => crypto.randomUUID(),
    };

    // 2. Register it
    mailbox.registerProvider(mockProvider);

    // 3. Query its status
    const address = 'mock://test/status';
    const status = await mailbox.status(address);

    // 4. Assert the default response
    expect(status.state).toBe('unknown');
    expect(status.message).toBe("The 'mock' provider does not support status queries.");
  });
});

describe('MemoryProvider: 订阅与取回是二选一，不是双投递', () => {
  // 注意：MemoryEventBus 是进程内单例，topic 跨 Mailbox 实例共享，所以地址必须唯一。
  let mailbox: Mailbox;

  beforeEach(async () => {
    mailbox = new Mailbox();
    mailbox.registerProvider(new MemoryProvider());
    await mailbox.start();
  });

  afterEach(async () => {
    await mailbox.stop();
  });

  it('交给订阅者时不在队列里留下副本', async () => {
    const address = 'mem://sub-only@bus/inbox';
    const onReceive = vi.fn();
    mailbox.subscribe(address, onReceive);

    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onReceive).toHaveBeenCalledTimes(1);
    // 旧实现：交给订阅者的同时又入队，订阅者从不取 → unreadCount 永久增长
    const status = await mailbox.status(address);
    expect(status.unreadCount).toBe(0);
    expect(await mailbox.fetch(address)).toBeNull();
  });

  it('does not redeliver an already-delivered message to the next subscriber', async () => {
    const address = 'mem://sub-then-fetch@bus/inbox';
    const first = vi.fn();
    const subscription = mailbox.subscribe(address, first);

    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(first).toHaveBeenCalledTimes(1);

    await subscription.unsubscribe();

    // 旧实现：这条已处理的消息还在队列里，下一个消费者一 fetch 就再执行一遍副作用
    expect(await mailbox.fetch(address)).toBeNull();
  });

  it('没有订阅者时仍然入队，可被 fetch 取回', async () => {
    const address = 'mem://fetch-only@bus/inbox';

    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 2 } });

    const first = await mailbox.fetch(address);
    const second = await mailbox.fetch(address);
    expect(first?.body).toEqual({ n: 1 });
    expect(second?.body).toEqual({ n: 2 });
    expect(await mailbox.fetch(address)).toBeNull();
  });

  it('每个订阅者只收到一份', async () => {
    const address = 'mem://two-subscribers@bus/inbox';
    const a = vi.fn();
    const b = vi.fn();
    mailbox.subscribe(address, a);
    mailbox.subscribe(address, b);

    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect((await mailbox.status(address)).unreadCount).toBe(0);
  });

  it('最后一个订阅者退订后重新回到队列', async () => {
    // 守护 `listeners.length > 0` 这个条件：只判断 topics.has(topic) 的写法会让
    // 退订后的 topic 永远走订阅分支（空监听器列表），消息被静默丢弃。
    const address = 'mem://unsub-then-fetch@bus/inbox';
    const subscription = mailbox.subscribe(address, vi.fn());
    await subscription.unsubscribe();

    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });

    const received = await mailbox.fetch(address);
    expect(received).not.toBeNull();
    expect(received!.body).toEqual({ n: 1 });
    expect((await mailbox.status(address)).subscriberCount).toBe(0);
  });

  it('decides delivery mode per message, not per topic', async () => {
    // 订阅前发布的消息留在队列里，订阅后发布的消息只走订阅：
    // 同一个 topic 上两种模式按“发送那一刻有没有订阅者”逐条决定。
    const address = 'mem://mixed-mode@bus/inbox';

    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });

    const onReceive = vi.fn();
    mailbox.subscribe(address, onReceive);
    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 2 } });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onReceive).toHaveBeenCalledTimes(1);
    expect(onReceive.mock.calls[0][0].body).toEqual({ n: 2 });

    const queued = await mailbox.fetch(address);
    expect(queued?.body).toEqual({ n: 1 });
    expect(await mailbox.fetch(address)).toBeNull();
  });

  it('一个订阅回调抛错不影响其他订阅者', async () => {
    // 订阅者抛错由 MailboxProvider 的 wrappedOnReceive 兜底：post() 不应 reject，
    // 其余订阅者仍要收到消息。（注意：抛错的那份目前不会回到队列，见审核报告。）
    const address = 'mem://throwing-listener@bus/inbox';
    mailbox.subscribe(address, () => {
      throw new Error('handler boom');
    });
    const healthy = vi.fn();
    mailbox.subscribe(address, healthy);

    await expect(
      mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } }),
    ).resolves.toBeTruthy();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('delivers across Mailbox instances without leaving a queued copy', async () => {
    // MemoryEventBus 是进程内单例：另一个 Mailbox 实例发布的消息同样只走订阅。
    const address = 'mem://cross-instance@bus/inbox';
    const other = new Mailbox();
    other.registerProvider(new MemoryProvider());
    await other.start();

    const onReceive = vi.fn();
    mailbox.subscribe(address, onReceive);

    await other.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onReceive).toHaveBeenCalledTimes(1);
    expect(await mailbox.fetch(address)).toBeNull();

    await other.stop();
  });
});

describe('MemoryProvider: 投递失败与 in-flight 可见性', () => {
  let mailbox: Mailbox;

  beforeEach(async () => {
    mailbox = new Mailbox();
    mailbox.registerProvider(new MemoryProvider());
    await mailbox.start();
  });

  afterEach(async () => {
    await mailbox.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('订阅可重试失败会退回队列，而不是丢失', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const address = 'mem://retriable-failure@bus/inbox';

    mailbox.subscribe(address, () => {
      const error = new Error('temporary outage') as Error & { isRetriable?: boolean };
      error.isRetriable = true;
      throw error;
    });

    const sent = await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await new Promise(resolve => setTimeout(resolve, 10));

    // 旧行为：unreadCount 为 0，消息在无人处理的情况下凭空消失
    expect((await mailbox.status(address)).unreadCount).toBe(1);
    expect(errorSpy).toHaveBeenCalled();

    const recovered = await mailbox.fetch(address);
    expect(recovered?.id).toBe(sent.id);
    expect(recovered?.body).toEqual({ n: 1 });
  });

  it('不可重试的订阅失败被丢弃', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const address = 'mem://fatal-failure@bus/inbox';

    mailbox.subscribe(address, () => {
      throw new Error('malformed payload');
    });

    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await new Promise(resolve => setTimeout(resolve, 10));

    // 不可重试的错误按死信处理：不回到队列，避免无限重试同一条坏消息
    expect((await mailbox.status(address)).unreadCount).toBe(0);
    expect(await mailbox.fetch(address)).toBeNull();
  });

  it('reports in-flight messages in status until they are acked', async () => {
    const address = 'mem://inflight-visible@bus/inbox';
    await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });

    const initial = await mailbox.status(address);
    expect(initial.unreadCount).toBe(1);
    expect(initial.inFlightCount).toBe(0);

    const received = (await mailbox.fetch(address, { manualAck: true })) as AckableMailMessage;

    // 旧行为：unreadCount 与 inFlightCount 都是 0，卡住的消息完全不可观测
    const during = await mailbox.status(address);
    expect(during.unreadCount).toBe(0);
    expect(during.inFlightCount).toBe(1);

    await received.ack();
    expect((await mailbox.status(address)).inFlightCount).toBe(0);
  });

  it('recovers a manual-ack message whose consumer never acked', async () => {
    vi.useFakeTimers();
    const address = 'mem://inflight-recovered@bus/inbox';

    const sent = await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    // 消费者“崩溃”：取走后不 ack，也没指定 ackTimeout
    const lost = await mailbox.fetch(address, { manualAck: true });
    expect(lost).not.toBeNull();

    await vi.advanceTimersByTimeAsync(DEFAULT_ACK_TIMEOUT + 1);

    // 旧行为：永远取不回来（unreadCount 0，in-flight 永久泄漏）
    const recovered = (await mailbox.fetch(address, { manualAck: true })) as AckableMailMessage;
    expect(recovered).not.toBeNull();
    expect(recovered.id).toBe(sent.id);

    await recovered.ack();
    expect(await mailbox.fetch(address, { manualAck: true })).toBeNull();
  });
});

const retriableError = (message = 'temporary outage'): Error => {
  const error = new Error(message) as Error & { isRetriable?: boolean };
  error.isRetriable = true;
  return error;
};

const settle = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

describe('MemoryProvider: 回队去重与订阅重试（opt-in）', () => {
  let mailbox: Mailbox;

  beforeEach(async () => {
    mailbox = new Mailbox();
    mailbox.registerProvider(new MemoryProvider());
    await mailbox.start();
  });

  afterEach(async () => {
    await mailbox.stop();
    vi.restoreAllMocks();
  });

  it('多个订阅者各自失败时，队列里只留一份副本', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const address = 'mem://dedup-multi-sub@bus/inbox';
    const failing = () => {
      throw retriableError();
    };
    mailbox.subscribe(address, failing);
    mailbox.subscribe(address, failing);

    const sent = await mailbox.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await settle();

    // 旧行为：每个失败的订阅者各回队一份 → unreadCount 为 2，同一条消息被 fetch 两次
    expect((await mailbox.status(address)).unreadCount).toBe(1);
    expect((await mailbox.fetch(address))?.id).toBe(sent.id);
    expect(await mailbox.fetch(address)).toBeNull();
  });

  it('开启重试后，只重投给失败的那个订阅者', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const retrying = new Mailbox();
    retrying.registerProvider(new MemoryProvider({ maxAttempts: 3, baseDelay: 5 }));
    await retrying.start();

    const address = 'mem://retry-targeted@bus/inbox';
    let flakyCalls = 0;
    let healthyCalls = 0;

    retrying.subscribe(address, () => {
      healthyCalls++;
    });
    retrying.subscribe(address, () => {
      flakyCalls++;
      if (flakyCalls < 3) {
        throw retriableError();
      }
    });

    await retrying.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await settle(80);

    expect(flakyCalls).toBe(3);
    // 已经成功的订阅者不会被重试广播再跑一次（否则副作用执行两次）
    expect(healthyCalls).toBe(1);
    expect((await retrying.status(address)).unreadCount).toBe(0);

    await retrying.stop();
  });

  it('重试次数耗尽后退回队列，交给 fetch 兜底', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const retrying = new Mailbox();
    retrying.registerProvider(new MemoryProvider({ maxAttempts: 2, baseDelay: 5 }));
    await retrying.start();

    const address = 'mem://retry-exhausted@bus/inbox';
    let calls = 0;
    retrying.subscribe(address, () => {
      calls++;
      throw retriableError();
    });

    const sent = await retrying.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await settle(80);

    expect(calls).toBe(2);
    expect((await retrying.status(address)).unreadCount).toBe(1);
    expect((await retrying.fetch(address))?.id).toBe(sent.id);

    await retrying.stop();
  });

  it('不可重试的错误不进入重试', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const retrying = new Mailbox();
    retrying.registerProvider(new MemoryProvider({ maxAttempts: 3, baseDelay: 5 }));
    await retrying.start();

    const address = 'mem://retry-fatal@bus/inbox';
    const handler = vi.fn(() => {
      throw new Error('malformed payload');
    });
    retrying.subscribe(address, handler);

    await retrying.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await settle(80);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((await retrying.status(address)).unreadCount).toBe(0);

    await retrying.stop();
  });

  it('待重投期间退订：不再调用回调，消息退回队列', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const retrying = new Mailbox();
    retrying.registerProvider(new MemoryProvider({ maxAttempts: 5, baseDelay: 50 }));
    await retrying.start();

    const address = 'mem://retry-unsubscribed@bus/inbox';
    const handler = vi.fn(() => {
      throw retriableError();
    });
    const sub = retrying.subscribe(address, handler);

    const sent = await retrying.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await settle(10);
    await sub.unsubscribe();
    await settle(120);

    expect(handler).toHaveBeenCalledTimes(1);
    // 重投被取消，但消息不能静默消失
    expect((await retrying.status(address)).unreadCount).toBe(1);
    expect((await retrying.fetch(address))?.id).toBe(sent.id);

    await retrying.stop();
  });

  it('setRetryPolicy 可以事后开启重试，耗尽时触发 _onRetryExhausted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exhausted: { id: string; attempts: number }[] = [];

    class TrackedProvider extends MemoryProvider {
      protected _onRetryExhausted(message: MailMessage, attempts: number): void {
        exhausted.push({ id: message.id, attempts });
      }
    }

    const retrying = new Mailbox();
    const provider = new TrackedProvider();
    retrying.registerProvider(provider);
    await retrying.start();

    const address = 'mem://retry-hook@bus/inbox';
    let calls = 0;
    retrying.subscribe(address, () => {
      calls++;
      throw retriableError();
    });

    // 默认不重试；事后开启（与 README 里的示例同一入口）
    provider.setRetryPolicy({ maxAttempts: 2, baseDelay: 5 });

    await retrying.post({ from: 'mem://sender@bus/out', to: address, body: { n: 1 } });
    await settle(80);

    expect(calls).toBe(2);
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0].attempts).toBe(2);
    // 耗尽后消息仍在队列里，由 fetch 兜底
    expect((await retrying.status(address)).unreadCount).toBe(1);

    await retrying.stop();
  });
});
