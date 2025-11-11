import {
  IMailboxProvider,
  MailMessage,
  Subscription,
  AckableMailMessage,
  MailboxStatus,
} from '../interfaces';

/**
 * Represents a subscription record managed internally by the MailboxProvider.
 * It holds the necessary data to manage the subscription's lifecycle.
 */
interface ManagedSubscription {
  id: string;
  address: URL;
  wrappedOnReceive: (message: MailMessage) => void | Promise<void>;
  // Holds the underlying handle returned by the concrete provider's _subscribe method,
  // which is needed for unsubscribing.
  unsubscribeHandle?: any;
}

export abstract class MailboxProvider implements IMailboxProvider {
  public readonly protocol: string;
  protected readonly subscriptions: Map<string, ManagedSubscription> = new Map();

  constructor(protocol: string) {
    if (!protocol) {
      throw new Error('Provider protocol cannot be empty.');
    }
    this.protocol = protocol;
  }

  // --- Public API (implements IMailboxProvider) ---

  /**
   * [Template Method] Sends a mail message.
   * This method handles common logic (like adding a timestamp) and then
   * calls the concrete `_send` method for protocol-specific delivery.
   */
  public async send(message: MailMessage): Promise<void> {
    const messageToSend = {
      ...message,
      headers: {
        ...message.headers,
        'x-sent-at': new Date().toISOString(),
      },
    };
    return this._send(messageToSend);
  }

  /**
   * [Template Method] Subscribes to an address.
   * This method manages the creation and lifecycle of the subscription object,
   * including wrapping the callback for implicit ACK and centralized error handling.
   */
  public subscribe(
    address: URL,
    onReceive: (message: MailMessage) => void | Promise<void>
  ): Subscription {
    const subId = crypto.randomUUID();

    // Wrap the onReceive callback to implement implicit ACK and unified error handling.
    const wrappedOnReceive = async (message: MailMessage): Promise<void> => {
      try {
        await onReceive(message);
        // On successful execution, implicitly acknowledge the message.
        await this._ack(message);
      } catch (error) {
        // Handle the error according to the defined strategy.
        this._handleReceiveError(error, message);
      }
    };

    const managedSub: ManagedSubscription = {
      id: subId,
      address,
      wrappedOnReceive,
    };

    // Call the concrete provider's implementation to start listening.
    managedSub.unsubscribeHandle = this._subscribe(address, wrappedOnReceive);
    this.subscriptions.set(subId, managedSub);

    // Return a standard Subscription object to the caller.
    return this._createSubscriptionObject(subId, address);
  }

  /**
   * [Template Method] Fetches a message.
   * Delegates directly to the concrete provider's implementation.
   */
  public fetch(address: URL, options: { manualAck: true }): Promise<AckableMailMessage | null>;
  public fetch(address: URL, options?: { manualAck?: false }): Promise<MailMessage | null>;
  public fetch(
    address: URL,
    options?: { manualAck?: boolean }
  ): Promise<MailMessage | AckableMailMessage | null> {
    return this._fetch(address, options);
  }

  /**
   * [Template Method] Queries the status of an address.
   * If the concrete provider implements `_status`, it will be called;
   * otherwise, a default "unknown" status is returned.
   */
  public async status(address: URL): Promise<MailboxStatus> {
    if (this._status) {
      return this._status(address);
    }
    return {
      state: 'unknown',
      message: `The '${this.protocol}' provider does not support status queries.`,
    };
  }

  // --- Protected Abstract Methods (to be implemented by subclasses) ---

  /**
   * [Subclass Responsibility] Performs the actual sending logic.
   */
  protected abstract _send(message: MailMessage): Promise<void>;

  /**
   * [Subclass Responsibility] Performs the actual subscription logic.
   * @returns A handle that can be used later to unsubscribe (e.g., a listener function, a subscription ID).
   */
  protected abstract _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => Promise<void>
  ): any;

  /**
   * [Subclass Responsibility] Performs the actual un-subscription logic.
   */
  protected abstract _unsubscribe(subscriptionId: string, unsubscribeHandle: any): Promise<void>;

  /**
   * [Subclass Responsibility] Performs the actual message fetching logic.
   */
  protected abstract _fetch(
    address: URL,
    options?: { manualAck?: boolean }
  ): Promise<MailMessage | AckableMailMessage | null>;

  /**
   * [Subclass Responsibility - Optional] Provides implicit ACK capability for the `subscribe` mode.
   * For providers that don't support ACK (like in-memory), this can be an empty async function.
   */
  protected abstract _ack(message: MailMessage): Promise<void>;

  /**
   * [Subclass Responsibility - Optional] Provides NACK capability.
   */
  protected abstract _nack(message: MailMessage, requeue: boolean): Promise<void>;

  /**
   * [Subclass Responsibility - Optional] Performs the actual status query logic.
   */
  protected _status?(address: URL): Promise<MailboxStatus>;

  // --- Protected Helper Methods (for internal use) ---

  private _createSubscriptionObject(subId: string, address: URL): Subscription {
    const provider = this; // Capture the MailboxProvider instance's `this` context.
    return {
      id: subId,
      address: address,
      get status() {
        // Use the captured `provider` context.
        return provider.subscriptions.has(subId) ? 'active' : 'closed';
      },
      unsubscribe: async (): Promise<void> => {
        // Use the captured `provider` context.
        const sub = provider.subscriptions.get(subId);
        if (sub) {
          await provider._unsubscribe(sub.id, sub.unsubscribeHandle);
          provider.subscriptions.delete(subId);
        }
      },
    };
  }

  protected _handleReceiveError(error: any, message: MailMessage): void {
    console.error(`[${this.protocol}] Error processing message ${message.id}:`, error);

    const isRetriable = this._isErrorRetriable(error);

    // Crucial: NACK the message first to prevent reprocessing, then handle other tasks.
    this._nack(message, isRetriable)
      .catch(nackError => {
        console.error(`[${this.protocol}] CRITICAL: Failed to NACK message ${message.id}. Risk of message duplication.`, nackError);
      });
  }

  private _isErrorRetriable(error: any): boolean {
    if (error) {
      if (error.isRetriable === true) return true;
      if (error.code && [503, 504, 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) {
        return true;
      }
    }
    return false;
  }
}
