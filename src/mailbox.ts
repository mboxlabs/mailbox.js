import { IMailboxProvider, MailMessage, OutgoingMail, Subscription, AckableMailMessage, MailboxStatus } from './interfaces';

export interface MailBoxFetchOptions {
  manualAck?: boolean;
  [name: string]: any;
}

interface ManualAckedMailBoxFetchOptions extends MailBoxFetchOptions {
  manualAck: true;
}

interface AutoAckedMailBoxFetchOptions extends MailBoxFetchOptions {
  manualAck?: false;
}

export class Mailbox {
  private _providers: Map<string, IMailboxProvider> = new Map();

  /**
   * 获取所有已注册的 Provider。返回只读 Map 以确保安全性。
   */
  public get providers(): ReadonlyMap<string, IMailboxProvider> {
    return this._providers;
  }

  /**
   * 根据协议名获取指定的 Provider。
   * @param protocol 协议名（例如 "memory" 或 "memory:"）
   * @param raiseErrorIfFailed 如果为 true，且找不到 Provider 时抛出错误。默认为 false。
   */
  public getProvider(protocol: string, raiseErrorIfFailed: true): IMailboxProvider;
  public getProvider(protocol: string, raiseErrorIfFailed?: boolean): IMailboxProvider | undefined;
  public getProvider(protocol: string, raiseErrorIfFailed: boolean = false): IMailboxProvider | undefined {
    const key = protocol.endsWith(':') ? protocol.slice(0, -1) : protocol;
    const provider = this._providers.get(key);
    if (!provider && raiseErrorIfFailed) {
      throw new Error(`No provider for protocol: ${protocol}`);
    }
    return provider;
  }

  /**
   * 启动所有注册的 Provider。
   * 建议在应用初始化阶段调用此方法，以确保所有通信通道准备就绪。
   */
  public async start(): Promise<void> {
    const providers = Array.from(this._providers.values());
    await Promise.all(providers.map(p => p.init?.()));
  }

  /**
   * 关闭所有注册的 Provider，并释放资源。
   * 建议在应用关闭阶段调用此方法。
   */
  public async stop(): Promise<void> {
    const providers = Array.from(this._providers.values());
    await Promise.all(providers.map(p => p.close?.()));
  }

  public registerProvider(provider: IMailboxProvider): void {
    this._providers.set(provider.protocol, provider);
  }

  public async post(mail: OutgoingMail) {
    const toUrl = new URL(mail.to);
    const fromUrl = new URL(mail.from);
    const provider = this.getProvider(toUrl.protocol, true);

    const message: MailMessage = {
      id: mail.id ?? provider.generateId(),
      from: fromUrl,
      to: toUrl,
      body: mail.body,
      headers: mail.headers || {},
      meta: mail.meta || {},
    };

    return await provider.send(message);
  }

  public subscribe(address: string | URL, onReceive: (message: MailMessage) => void): Subscription {
    const addrUrl = new URL(address);
    const provider = this.getProvider(addrUrl.protocol, true);

    return provider.subscribe(addrUrl, onReceive);
  }

  public async fetch(address: string | URL, options: ManualAckedMailBoxFetchOptions): Promise<AckableMailMessage | null>;
  public async fetch(address: string | URL, options?: AutoAckedMailBoxFetchOptions): Promise<MailMessage | null>;
  public async fetch(address: string | URL, options?: MailBoxFetchOptions): Promise<MailMessage | AckableMailMessage | null> {
    const addrUrl = new URL(address);
    const provider = this.getProvider(addrUrl.protocol, true);
    return provider.fetch(addrUrl, options);
  }

  /**
   * 查询指定地址的状态信息。
   * @param address 要查询的地址。
   * @returns 返回该地址的邮箱状态。
   */
  public async status(address: string | URL): Promise<MailboxStatus> {
    const addrUrl = new URL(address);
    const provider = this.getProvider(addrUrl.protocol, true);

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
