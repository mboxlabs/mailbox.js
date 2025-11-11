import { IMailboxProvider, MailMessage, OutgoingMail, Subscription, AckableMailMessage, MailboxStatus } from './interfaces';

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
      id: mail.id ?? provider.generateId(),
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

  /**
   * 查询指定地址的状态信息。
   * @param address 要查询的地址。
   * @returns 返回该地址的邮箱状态。
   */
  public async status(address: string | URL): Promise<MailboxStatus> {
    const addrUrl = new URL(address);
    const provider = this.providers.get(addrUrl.protocol.slice(0, -1));
    if (!provider) {
      throw new Error(`No provider for protocol: ${addrUrl.protocol}`);
    }

    if (!provider.status) {
      // 如果 Provider 没有实现 status 方法，返回一个默认的未知状态。
      return {
        state: 'unknown',
        message: `The '${provider.protocol}' provider does not support status queries.`
      };
    }

    return provider.status(addrUrl);
  }
}
