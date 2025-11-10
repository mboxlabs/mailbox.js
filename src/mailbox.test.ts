import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mailbox } from './mailbox';
import { MemoryProvider } from './providers/memory';
import type { MailMessage, AckableMailMessage } from './interfaces';

describe('Mailbox', () => {
  let mailbox: Mailbox;
  let memoryProvider: MemoryProvider;

  beforeEach(() => {
    mailbox = new Mailbox();
    memoryProvider = new MemoryProvider();
    mailbox.registerProvider(memoryProvider);
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
    expect(receivedMessage.headers).toHaveProperty('x-sent-at');
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
