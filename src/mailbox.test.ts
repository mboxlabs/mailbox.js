import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mailbox } from './mailbox';
import { MemoryProvider } from './providers/memory';
import type { MailMessage, AckableMailMessage, IMailboxProvider } from './interfaces';

describe('Mailbox', () => {
  let mailbox: Mailbox;
  let memoryProvider: MemoryProvider;

  beforeEach(() => {
    mailbox = new Mailbox();
    memoryProvider = new MemoryProvider();
    mailbox.registerProvider(memoryProvider);
  });

  afterEach(() => {
    vi.useRealTimers(); // Restore real timers after each test
  });

  it('should register a provider', () => {
    const newMailbox = new Mailbox();
    const provider = new MemoryProvider();
    newMailbox.registerProvider(provider);
    // @ts-expect-error - accessing private property for test
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
});

describe('status', () => {
  let mailbox: Mailbox;
  let memoryProvider: MemoryProvider;

  beforeEach(() => {
    mailbox = new Mailbox();
    memoryProvider = new MemoryProvider();
    mailbox.registerProvider(memoryProvider);
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
