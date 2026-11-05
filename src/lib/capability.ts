import type { IMailboxProvider } from '../interfaces'

/**
 * 能力名（capability id）。**内核只认这个名字，不认方法存在性。**
 *
 * 名字是稳定的公开契约：provider 声明它、诊断面读它、上层策略用它选路、
 * conformance runner 拿它决定该跑哪些用例。加新能力 = 加一个字符串，不改类型。
 */
export const Capability = {
  /** `status(address)` 能给出真实答复（而不是「问不到」）。 */
  Status: 'status',
  /** `fetch({ peek: true })` 是只读的（不会把消息取走）。 */
  Peek: 'peek',
  /** provider 能列出自己认得的地址（消息确实在本地）。 */
  ListAddresses: 'listAddresses',
  /** provider 有「租约」概念，能把到期未回的在飞信收回队列。 */
  RecoverLeases: 'recoverLeases',
  /** provider 能丢弃自己持有的积压消息（`clear()`）。 */
  Clear: 'clear',
  /** provider 接了处置钩子 `_settle(message, where)`（新的处置入口）。 */
  Settle: 'settle',
  /**
   * provider 有「**停放**」这一态：判死、不再交付、但没被丢弃，能在状态里数出来、能读出来。
   *
   * 声明它 = 「`ack('discard')` 之后有一条记录留在那里可查」。没有这个能力，
   * `discard` 就是纯丢弃、零痕迹——那也合法，只是别指望查得到。
   */
  Parked: 'parked',
  /**
   * provider 会把判死的投递按**自己协议**归档（`mem:` 是死信 topic；SMTP 是 bounce…）。
   *
   * 这条必须跟着配置走：`MemoryProvider` 只在 `enableDeadLetterQueue()` 之后声明它。
   * 声明与开关漂移 = 声明说谎（`cap-01` / `cap-02` 钉的就是这个）。
   */
  DeadLetter: 'dead-letter',
  /**
   * 处置词汇的扩展名：`disposition:<where>`。
   *
   * `handled` / `unhandled` / `discard` 是内核词汇，不用声明；provider 想接受别的处置值
   * （人类端点的 `answered`、`expired`……）就必须显式声明它，否则内核在把处置交下去之前
   * 就报错。声明 = 「我认这个值，而且我知道怎么处理」。
   */
  disposition: (where: string): string => `disposition:${where}`,
} as const

/**
 * 能力声明的形状（D6）。
 *
 * **能力是运行期可变的数据 + 谓词，不是类型化字段。** 为什么不是 `canPeek: boolean` 这类字段：
 * provider 的能力会被运行期改变——包装 / 注入（AoP）、配置开关（`enableDeadLetterQueue()`）、
 * 按地址而异（本地队列型能枚举，代理型不能）。类型化字段表达不了「谁注入了谁更新」，
 * 而字段与实现漂移后编译器也不会报错。
 *
 * 规矩只有一条：**未声明 = 没有这个操作**；谁给 provider 注入能力，谁就更新它的声明。
 */
export interface CapabilityDeclaration {
  /** 可变的能力集合。读它 = 看这个 provider 现在能做什么；改它 = 声明变了。 */
  readonly supports: Set<string>
  /**
   * 这个 provider 现在能不能做 `operation`。
   *
   * `address` 是给按地址而异的实现留的口（同一 provider 的不同 scheme / 不同信箱能力不同）。
   * 默认实现就是 `supports.has(operation)`。
   */
  can(operation: string, address?: URL): boolean
}

/** provider 自己声明过能力吗（继承 `MailboxProvider` 基类的都声明了）。 */
export function isCapabilityDeclaration(
  provider: IMailboxProvider
): provider is IMailboxProvider & CapabilityDeclaration {
  const candidate = provider as IMailboxProvider &
    Partial<CapabilityDeclaration>
  return (
    typeof candidate.can === 'function' && candidate.supports instanceof Set
  )
}

/**
 * 这个 provider 现在能做什么（**读**的唯一入口）。
 *
 * - 自己声明过能力的（基类子类）⇒ 照它的声明答；
 * - 直接实现 `IMailboxProvider` 的第三方（v1.0.0 就允许）⇒ 按已实现的方法推导一份视图。
 *   推导只作为兼容兜底存在：它把「实现了这个方法」当成「声明了这个能力」。
 *   包装 / 注入过 provider 的代码必须自己变成 {@link CapabilityDeclaration}，否则声明会和
 *   注入后的实现漂移——而漂移不会报错，只会让内核做出 provider 其实做不到的事。
 */
export function capabilitiesOf(provider: IMailboxProvider): Set<string> {
  if (isCapabilityDeclaration(provider)) {
    return provider.supports
  }
  const derived = new Set<string>()
  if (typeof provider.status === 'function') derived.add(Capability.Status)
  if (typeof provider.listAddresses === 'function')
    derived.add(Capability.ListAddresses)
  if (typeof provider.recoverLeases === 'function')
    derived.add(Capability.RecoverLeases)
  if (typeof provider.clear === 'function') derived.add(Capability.Clear)
  // `peek` 不是接口方法（它是 `_peek` 这个 provider 内部钩子），接口层看不出来：
  // 没声明就按「不支持只读」答，比把消息取走安全。
  return derived
}

/**
 * 内核判据：这个 provider 能不能做 `operation`。
 *
 * 用来替换所有「`typeof provider.x === 'function'`」式的探测——那种探测把「碰巧有这个方法」
 * 当成「支持这个操作」，包装过的 provider、按配置关掉的能力都答错。
 */
export function providerCan(
  provider: IMailboxProvider,
  operation: string,
  address?: URL
): boolean {
  if (isCapabilityDeclaration(provider)) {
    return provider.can(operation, address)
  }
  return capabilitiesOf(provider).has(operation)
}
