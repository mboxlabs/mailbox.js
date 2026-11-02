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

export interface MailBoxStopOptions {
  /**
   * 关掉订阅后再丢弃各 provider 的积压消息（含 in-flight）。
   * 默认 `false`：关闭通道不等于销毁数据。
   */
  purge?: boolean;
}

/**
 * 标记“这个 provider 实例当前属于哪个 Mailbox”，用于发现跨 Mailbox 复用。
 * 用 symbol 键，不污染用户对象的常规属性。
 */
const PROVIDER_OWNER = Symbol.for('mboxlabs.mailbox.provider.owner');

interface ProviderOwnerMark {
  owner: Mailbox;
  warned: boolean;
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
   *
   * 默认只拆订阅、不动积压消息：`stop()` 后同一个 provider（或共享同一份状态的另一个
   * `Mailbox`）重新 `start()`，队列里的残留消息照旧可见——这是 issue#3 里“测试隔离失效”的根源。
   * 确实要销毁状态时显式传 `{ purge: true }`。
   */
  public async stop(options?: MailBoxStopOptions): Promise<void> {
    const providers = Array.from(this._providers.values());
    await Promise.all(providers.map(p => p.close?.()));

    if (options?.purge) {
      await this.clear();
    }
  }

  /**
   * 丢弃各 provider 持有的积压消息（含 in-flight），**不**拆订阅。
   *
   * 测试隔离、用例之间重置状态用它；没实现 `clear()` 的 provider 会被跳过。
   * 注意默认构造的 `MemoryProvider` 共用进程级单例总线——`clear()` 会清掉同一份
   * 总线上其它 `Mailbox` 的队列。只清自己那份，请用 `MemoryProvider.createIsolated()`
   * 或 `MemoryProvider.forScope(scope)`。
   */
  public async clear(): Promise<void> {
    await Promise.all(Array.from(this._providers.values()).map(async (provider) => {
      await provider.clear?.();
    }));
  }

  public registerProvider(provider: IMailboxProvider): void {
    markProviderOwnership(this, provider);
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

/**
 * 同一个 provider 实例被多个 `Mailbox` 复用时告警一次。
 *
 * 订阅表挂在 provider 上，不是挂在 Mailbox 上：`a.stop()` 会拆掉 `b` 在这个 provider 上的
 * 订阅。行为上无法替用户拆开（provider 自己不知道订阅是谁建的），至少让这个坑可见。
 * 每个 Mailbox 应该持有自己的 provider 实例（`MemoryProvider.createIsolated()`）。
 */
function markProviderOwnership(mailbox: Mailbox, provider: IMailboxProvider): void {
  const holder = provider as unknown as Record<symbol, ProviderOwnerMark | undefined>;
  const mark = holder[PROVIDER_OWNER];

  if (!mark) {
    Object.defineProperty(provider, PROVIDER_OWNER, {
      value: { owner: mailbox, warned: false } satisfies ProviderOwnerMark,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    return;
  }

  if (mark.owner === mailbox || mark.warned) {
    return; // 同一个 Mailbox 内重复注册是常规用法；已经告过就不重复噪。
  }

  mark.warned = true;
  console.warn(
    `[mailbox] The '${provider.protocol}' provider instance is shared by more than one Mailbox. ` +
    'Subscriptions live on the provider, so `stop()` / `close()` on either Mailbox unsubscribes the other one. ' +
    'Register a provider per Mailbox (e.g. `MemoryProvider.createIsolated()`) if they are meant to be independent.',
  );
}
