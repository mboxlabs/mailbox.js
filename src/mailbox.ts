// @isdk/mailbox/src/mailbox.ts
import { IMailboxProvider, MailMessage, OutgoingMail, Subscription, AckableMailMessage } from './interfaces';

export class Mailbox {
  private providers: Map<string, IMailboxProvider> = new Map();

  public registerProvider(provider: IMailboxProvider): void {
    this.providers.set(provider.protocol, provider);
  }

  public async post(mail: OutgoingMail): Promise<void> {
    const toUrl = new URL(mail.to);
    const fromUrl = new URL(mail.from);
    const provider = this.providers.get(toUrl.protocol.slice(0, -1));
    if (!provider) throw new Error(`No provider for protocol: ${toUrl.protocol}`);

    const message: MailMessage = {
      id: crypto.randomUUID(),
      from: fromUrl,
      to: toUrl,
      body: mail.body,
      headers: mail.headers || {},
    };

    await provider.send(message);
  }

  public subscribe(address: string | URL, onReceive: (message: MailMessage) => void): Subscription {
    const addrUrl = new URL(address);
    const provider = this.providers.get(addrUrl.protocol.slice(0, -1));
    if (!provider) throw new Error(`No provider for protocol: ${addrUrl.protocol}`);

    return provider.subscribe(addrUrl, onReceive);
  }

  public async fetch(address: string | URL, options: { manualAck: true }): Promise<AckableMailMessage | null>;
  public async fetch(address: string | URL, options?: { manualAck?: false }): Promise<MailMessage | null>;
  public async fetch(address: string | URL, options?: { manualAck?: boolean }): Promise<MailMessage | AckableMailMessage | null> {
    const addrUrl = new URL(address);
    const provider = this.providers.get(addrUrl.protocol.slice(0, -1));
    if (!provider) throw new Error(`No provider for protocol: ${addrUrl.protocol}`);
    return provider.fetch(addrUrl, options);
  }
}
