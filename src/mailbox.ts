import {
  IMailboxProvider,
  MailMessage,
  MailboxAddressSnapshot,
  MailboxSnapshot,
  MailboxStatus,
  LeaseRecoveryReport,
  OutgoingMail,
  Subscription,
  AckableMailMessage,
  PeekFetchOptions,
  ManualAckFetchOptions,
  PlainFetchOptions,
  FetchOptions,
} from './interfaces';
import { parseMailboxAddress } from './lib/utils';
import { stripSenderForgedSystemHeaders } from './lib/delivery';
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
      // 发送方自带的系统头先剥掉（拷一份 headers：不把调用方那个对象挂在消息上，
      // 同一个字面量 post 两次会共享 headers）。「这一份信」的编号不在这里发——
      // 由 `MailboxProvider.send()` 在发送边界上发（`_send()` 只能从那里进，第三方 provider
      // 也不会漏）。这里只守发送边界：不把别人的控制头递下去。
      headers: stripSenderForgedSystemHeaders(mail.headers),
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
   * 显式回收：把该地址上**租约已到期**的信收回队列。
   *
   * 为什么需要它：在飞租约的回收本来是惰性的（无后台定时器，只有下一次 manualAck 取信才扫）。
   * 对正常轮询的消费者够用；但“最后一个消费者崩了”、“这个地址再没人 fetch”时，那封信就永远挂在
   * in-flight：`unreadCount` 0、`inFlightCount` 1、`overdueInFlightCount` 1，不会自愈。
   * `recover()` 就是留给运维脚本 / 定时任务 / 健康检查的那个入口（不靠往默认路径里塞定时器）。
   *
   * 只动**已到期**的租约：别人手里未到期的、以及 `ackTimeout: 0` / `null` 的常驻租约都不会被碰。
   * 幂等：紧接着再调一次通常 `reclaimed: 0`。provider 报错直接抛出，不静默吐掉。
   *
   * 没有租约概念的 provider 会回 `supported: false`——**别把 `reclaimed: 0` 读成“一切正常”**。
   *
   * @param address 要回收的地址；不带 = 遍历所有能枚举自身地址的 provider 的全部地址。
   */
  public async recover(address: string | URL): Promise<LeaseRecoveryReport>;
  public async recover(): Promise<LeaseRecoveryReport>;
  public async recover(address?: string | URL): Promise<LeaseRecoveryReport> {
    if (address !== undefined) {
      const addrUrl = parseMailboxAddress(address, 'recover()');
      const provider = this.getProvider(addrUrl.protocol, true);
      return {
        reclaimed: await recoverLeasesOf(provider, addrUrl),
        supported: typeof provider.recoverLeases === 'function',
      };
    }

    const byAddress: Record<string, number> = {};
    const unreachableProviders: string[] = [];
    let reclaimed = 0;

    for (const [protocol, provider] of this._providers) {
      // 没实现 `recoverLeases`（没有租约概念），或消息不在本地、枚举不到地址：这笔没做，
      // 也不能算成“没事”——列出来。
      if (typeof provider.recoverLeases !== 'function' || typeof provider.listAddresses !== 'function') {
        unreachableProviders.push(protocol);
        continue;
      }
      for (const canonicalId of await provider.listAddresses()) {
        const each = await recoverLeasesOf(provider, new URL(canonicalId));
        byAddress[canonicalId] = each;
        reclaimed += each;
      }
    }

    return {
      reclaimed,
      supported: unreachableProviders.length === 0,
      byAddress,
      unreachableProviders: unreachableProviders.sort(),
    };
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
    const overdueInFlightCount = addresses.reduce((total, entry) => total + (entry.overdueInFlightCount ?? 0), 0);
    const oldestOverdueMs = addresses.reduce((oldest, entry) => Math.max(oldest, entry.oldestOverdueMs ?? 0), 0);
    const parkedCount = addresses.reduce((total, entry) => total + (entry.parkedCount ?? 0), 0);
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
      overdueInFlightCount,
      parkedCount,
      oldestOverdueMs,
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
/** provider 没有租约概念时，回收就是“没做”（调用方靠 `supported` 区分“没做”与“做了但 0 份”）。 */
async function recoverLeasesOf(provider: IMailboxProvider, address: URL): Promise<number> {
  return typeof provider.recoverLeases === 'function' ? provider.recoverLeases(address) : 0;
}

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
