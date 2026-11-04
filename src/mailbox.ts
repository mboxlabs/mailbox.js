import {
  IMailboxProvider,
  MailMessage,
  MailboxAddressSnapshot,
  MailboxSnapshot,
  MailboxStatus,
  OutgoingMail,
  Subscription,
  AckableMailMessage,
  PeekFetchOptions,
  ManualAckFetchOptions,
  PlainFetchOptions,
  FetchOptions,
} from './interfaces';
import { parseMailboxAddress } from './lib/utils';
import { MBX_SEND_ID_HEADER, stripSenderForgedSystemHeaders } from './lib/delivery';
import { NoProviderError } from './error';

/** `fetch()` 的全量选项（保留历史名字，实体见 {@link FetchOptions}）。 */
export type MailBoxFetchOptions = FetchOptions;
/** `fetch({ peek: true })` 的只读快照选项。 */
export type MailBoxPeekOptions = PeekFetchOptions;

type ManualAckedMailBoxFetchOptions = ManualAckFetchOptions;

type AutoAckedMailBoxFetchOptions = PlainFetchOptions;

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
      throw new NoProviderError(protocol);
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
    const toUrl = parseMailboxAddress(mail.to, 'post()');
    const fromUrl = parseMailboxAddress(mail.from, 'post() (from)');
    const provider = this.getProvider(toUrl.protocol, true);

    const message: MailMessage = {
      id: mail.id ?? provider.generateId(),
      from: fromUrl,
      to: toUrl,
      body: mail.body,
      // 发送方自带的系统头先剥掉，再发一个「这一份信」的编号：
      // - 剥：`mbx-round` / `mbx-attempt` / `mbx-send-id` / `mbx-dead-letter*` 这些都是系统说了算的，
      //   采信就等于让发送方能伪造自己的重试轮次、或让一份信顶替另一份；
      // - 发：`id` 是发送方给的名字，可以重复；队列记账要靠这个编号分清「哪一份」。
      //   用 `provider.generateId()`（全局唯一）而不是本地计数器：同一个总线上可能挂着
      //   多个 `Mailbox` 实例，计数器会撞号，撞了就是又回到「两份信一本账」。
      // 同时这里拷一份 headers：不把调用方那个对象挂在消息上（同一个字面量 post 两次会共享 headers）。
      headers: {
        ...stripSenderForgedSystemHeaders(mail.headers),
        [MBX_SEND_ID_HEADER]: provider.generateId(),
      },
      meta: mail.meta || {},
    };

    return await provider.send(message);
  }

  public subscribe(address: string | URL, onReceive: (message: MailMessage) => void): Subscription {
    const addrUrl = parseMailboxAddress(address, 'subscribe()');
    const provider = this.getProvider(addrUrl.protocol, true);

    return provider.subscribe(addrUrl, onReceive);
  }

  /**
   * 取信 / 只读快照。
   *
   * - 默认：取一封，隐式 ACK（出队即完成）。
   * - `{ manualAck: true }`：取一封，进 in-flight，直到 ack / nack 或超时重投。
   * - `{ peek: true, limit?: n }`：**只读**——返回副本数组（空队列是 `[]`），不出队、
   *   不建 in-flight、不刷活动时间。诊断与测试断言用这个，不要用「manualAck 但不 ack」凑。
   *
   * `peek` 与 `manualAck` 同时给出会直接报错（互相矛盾），provider 不支持只读时抛
   * `UnsupportedCapabilityError`——都不会被静默降级成普通取信。
   */
  public async fetch(address: string | URL, options: PeekFetchOptions): Promise<MailMessage[]>;
  public async fetch(address: string | URL, options: ManualAckedMailBoxFetchOptions): Promise<AckableMailMessage | null>;
  public async fetch(address: string | URL, options?: AutoAckedMailBoxFetchOptions): Promise<MailMessage | null>;
  public async fetch(address: string | URL, options?: MailBoxFetchOptions): Promise<MailMessage | AckableMailMessage | MailMessage[] | null> {
    const addrUrl = parseMailboxAddress(address, 'fetch()');
    const provider = this.getProvider(addrUrl.protocol, true);
    return provider.fetch(addrUrl, options);
  }

  /**
   * 查询指定地址的状态信息。
   *
   * 地址在 provider 里没有任何记录（没投过、没订阅过、没有活动）时，返回
   * `state: 'unknown'` + `exists: false`，而不是 `state: 'online'` + 0——诊断页要能区分
   * “这个地址不存在”和“这个地址空闲”。
   *
   * @param address 要查询的地址。
   * @returns 返回该地址的邮箱状态。
   */
  public async status(address: string | URL): Promise<MailboxStatus>;
  /**
   * 不带地址 = 全量快照：所有 provider、所有 topic 的一时刻诊断视图（见 {@link snapshot}）。
   */
  public async status(): Promise<MailboxSnapshot>;
  public async status(address?: string | URL): Promise<MailboxStatus | MailboxSnapshot> {
    if (address === undefined) {
      return this.snapshot();
    }

    const addrUrl = parseMailboxAddress(address, 'status()');
    const provider = this.getProvider(addrUrl.protocol, true);

    if (!provider.status) {
      // 如果 Provider 没有实现 status 方法，返回一个默认的未知状态。
      // 注意这里**不**设 `exists: false`：问不到不等于不存在。
      return {
        state: 'unknown',
        message: `The '${provider.protocol}' provider does not support status queries.`
      };
    }

    return provider.status(addrUrl);
  }

  /**
   * 全量快照：把所有能枚举自身地址的 provider 的 topic 状态汇成一个可断言的结构。
   *
   * 等价于无参的 `status()`，只是名字更直白（诊断页里 `mailbox.snapshot()` 比 `mailbox.status()`
   * 更好读）。不能枚举的 provider（消息不在本地，如 AMQP / SQS）会列在
   * `unsupportedProviders` 里，不会被误报成“队列为空”。
   */
  public async snapshot(): Promise<MailboxSnapshot> {
    const protocols = Array.from(this._providers.keys()).sort();
    const addresses: MailboxAddressSnapshot[] = [];
    const unsupportedProviders: string[] = [];

    for (const [protocol, provider] of this._providers) {
      if (typeof provider.listAddresses !== 'function') {
        unsupportedProviders.push(protocol);
        continue;
      }

      for (const canonicalId of await provider.listAddresses()) {
        addresses.push({
          canonicalId,
          protocol,
          ...(await statusOfCanonicalAddress(provider, canonicalId)),
        });
      }
    }

    addresses.sort((a, b) => (a.canonicalId < b.canonicalId ? -1 : a.canonicalId > b.canonicalId ? 1 : 0));

    const unreadCount = addresses.reduce((total, entry) => total + (entry.unreadCount ?? 0), 0);
    const inFlightCount = addresses.reduce((total, entry) => total + (entry.inFlightCount ?? 0), 0);
    const enumerated = protocols.length - unsupportedProviders.length;

    let state: MailboxSnapshot['state'];
    if (enumerated === 0) {
      state = 'unknown'; // 没有任何 provider 能枚举：这份快照什么都没说
    } else if (unsupportedProviders.length > 0 || addresses.some((entry) => entry.state !== 'online')) {
      state = 'degraded'; // 只看到一部分，或有地址本身就不在线
    } else {
      state = 'online';
    }

    return {
      state,
      protocols,
      addressCount: addresses.length,
      unreadCount,
      inFlightCount,
      addresses,
      unsupportedProviders: unsupportedProviders.sort(),
      takenAt: new Date().toISOString(),
    };
  }
}

/**
 * 快照里对单个地址的查询：canonical id 本身可以重新解析成 URL（它已经是
 * `protocol://user@host/path` 形式）。解析不了是 provider 的 bug，宁可报 unknown
 * 也不能让整个快照崩掉。
 */
async function statusOfCanonicalAddress(provider: IMailboxProvider, canonicalId: string): Promise<MailboxStatus> {
  if (!provider.status) {
    // 能枚举但不能报状态：至少把“这个地址存在”说出来。
    return { state: 'unknown', exists: true, message: `The '${provider.protocol}' provider does not support status queries.` };
  }

  try {
    return await provider.status(new URL(canonicalId));
  } catch (error) {
    return {
      state: 'unknown',
      exists: true,
      message: `The '${provider.protocol}' provider listed '${canonicalId}', but it could not be queried back.`,
      ...(error instanceof Error ? { cause: error.message } : {}),
    };
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
