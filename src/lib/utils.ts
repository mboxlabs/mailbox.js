import { InvalidFetchOptionsError, InvalidMailboxAddressError } from '../error'

/**
 * `mem:` 形状的折叠结果：`protocol//user@host/pathname`。
 *
 * 单独拆出来只为一件事：让「拒绝 query / hash」的错误信息能报出**真正的**合并目标
 * （早先的文案漏了 `user@`，于是「会被并进哪个地址」这句话本身就不准）。
 */
function foldMailboxAddress(address: URL): string {
  const userInfo = address.username ? `${address.username}@` : ''
  return `${address.protocol}//${userInfo}${address.host}${address.pathname}`
}

/**
 * 校验一个地址在规范化时不会**静默丢掉**信息——**这是 scheme 可以采用的策略，不是内核规则**。
 *
 * 背景：{@link getCanonicalMailboxAddressIdentifier} 把地址折成
 * `protocol//user@host/pathname`，query / hash 会被丢掉。于是
 * `mem:inbox@host/thread?thread=1` 与 `mem:inbox@host/thread` 塌成同一条队列
 * （issue#4：「看起来能用、实际共用一条队列」）。`mem:` 这个 scheme 对此选的策略是
 * **拒绝**：邮箱语义必须留在 path 里。
 *
 * 但这条规则**不该由内核统一强加**（D5）：换一种折叠方式（比如 query 参与寻址、或整套
 * href 都是键），query 就完全可以合法。内核只保证「同一个 provider 的每个入口给出同一个
 * 判定」；策略在哪定义、怎么声明，见 {@link MailboxAddressGrammar}。
 *
 * 因此这里只剩一个 provider 侧 helper：**要采用「拒绝 query / hash」这条 scheme 策略的实现
 * 在自己的入口调它**（`MemoryProvider` 就是这么做的）。
 *
 * @deprecated 内核不再调用它（`src/mailbox.ts` 一次都不用）。它随
 * {@link getCanonicalMailboxAddressIdentifier} 一起属于 `mem:` 形状的折叠规则；
 * 2.0.0 会从核心导出面移除，provider 需要就自带一份。
 *
 * @param address 待校验的地址。
 * @param context 出错信息里带上的调用点名字（例如 `'peekParked()'`），便于定位。
 * @throws {InvalidMailboxAddressError} 地址带 query 或 hash 时抛出。
 */
export function assertLosslessMailboxAddress(address: URL, context = 'mailbox address'): void {
  const dropped: string[] = []

  if (address.search) {
    dropped.push(`query "${address.search}"`)
  } else if (address.href.includes('?')) {
    dropped.push('an empty query ("?")') // `mem:host/inbox?` —— search 是空串，但意图仍然是「带 query」
  }

  if (address.hash) {
    dropped.push(`hash "${address.hash}"`)
  } else if (address.href.includes('#')) {
    dropped.push('an empty hash ("#")')
  }

  if (dropped.length > 0) {
    throw new InvalidMailboxAddressError(
      address.href,
      `Invalid mailbox address "${address.href}" in ${context}: ` +
      `${dropped.join(' and ')} would be dropped by address canonicalization, silently merging this address ` +
      `with "${foldMailboxAddress(address)}". ` +
      'Mailbox semantics must live in the path (e.g. "mem:host/inbox/thread-1"), not in the query or hash.',
    )
  }
}

/**
 * 把地址解析成 URL。**内核对地址只做这一件事**（D5）。
 *
 * 内核不折叠字段、不判等、不禁止 query / fragment：那些都是 scheme 的语法知识，由该 scheme
 * 的 provider 声明（{@link MailboxAddressGrammar}）并实现。内核能保证的是**一致性**：
 * 同一个地址串在 `post` / `subscribe` / `fetch` / `status` / `recover` 每个入口都按同样的方式
 * 解析、喂给同一个 provider——不会出现「只在一个入口合法」。
 *
 * 地址内部是否合法（`mem:` 就拒绝 query / hash，因为它的折叠会丢掉它们）由 provider 在
 * 自己的入口判，错误照样从 `post()` 传回调用方。
 *
 * @param input 地址字符串或 URL 对象。
 * @param context 出错信息里带上的调用点名字。
 * @returns 解析后的 URL。
 * @throws {InvalidMailboxAddressError} 连 URL 都解析不了（这跟地址语法无关）。
 */
export function parseMailboxAddress(input: string | URL, context = 'mailbox address'): URL {
  let address: URL
  try {
    address = input instanceof URL ? input : new URL(input)
  } catch (error) {
    throw new InvalidMailboxAddressError(
      String(input),
      `Invalid mailbox address "${String(input)}" in ${context}: not a parseable URL.`,
      { cause: error },
    )
  }

  return address
}

/**
 * Generates a canonical string identifier for a mailbox address.
 * This function normalizes the input URL by stripping sensitive information (like password)
 * and irrelevant parts (like hash fragments).
 *
 * **它不是内核的寻址规则**（D5）：内核不用它，也不用 `canonicalId` 判等或排序。它只是
 * `mem:` 这类 scheme 的**内部键写法**——「`mem:a@h/i` 与 `mem://a@h/i` 是同一个信箱」是
 * `mem:` 的语法声明，不是 URL 的通用规则。别的 scheme 完全可以拿整套 href 当键、或让 query
 * 参与寻址（那时这个函数会把它判成同一个信箱，正是错的）。
 *
 * 曾有的坑：折叠会丢掉 query / hash，于是带它们的地址**静默**并入另一条队列（issue#4）；
 * `mem:` 的对策是在折叠前先拒绝（见 {@link assertLosslessMailboxAddress}）。换成别的 scheme，
 * 对策就得由那个 scheme 自己写。
 *
 * @deprecated 公开契约里不该有它（`MailboxAddressSnapshot.canonicalId` 已移除）。
 * `MemoryProvider` 内部仍用它给队列取键；第三方 provider 需要同款折叠就自带一份。
 * 2.0.0 会从核心导出面移除——`mailbox-input` 那类调用方届时改用自己的 helper。
 *
 * @param address The URL object representing the mailbox address.
 * @returns A canonical string identifier for the mailbox address.
 * @throws {InvalidMailboxAddressError} 地址带 query / hash（它们无法在这个折叠里保留）。
 */
export function getCanonicalMailboxAddressIdentifier(address: URL): string {
  assertLosslessMailboxAddress(address, 'address canonicalization')
  return foldMailboxAddress(address)
}

/**
 * 校验并归一 `peek` 的 `limit`。
 *
 * `undefined` / `Infinity` 表示「整个队列」；其余必须是**非负整数**。
 * 负数、`NaN`、小数都会让「取几条」变成含糊语义，直接拒绝。
 *
 * @param limit 调用方传入的 limit。
 * @returns 归一后的 limit；`undefined` 表示不限条数。
 * @throws {InvalidFetchOptionsError} 取值非法。
 */
export function normalizePeekLimit(limit: number | undefined): number | undefined {
  if (limit === undefined || limit === Number.POSITIVE_INFINITY) {
    return undefined
  }
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
    throw new InvalidFetchOptionsError(
      `Invalid \`limit\` for read-only peek: expected a non-negative integer (or Infinity for the whole queue), got ${String(limit)}.`,
    )
  }
  return limit
}

/**
 * 能深拷贝就深拷贝，不能就原样返回引用（`structuredClone` 遇到函数 / 类实例 / `URL` 会抛）。
 */
function cloneIfPossible<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value
  }
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

/**
 * 给只读快照（peek）做一份消息副本。
 *
 * 副本是必需的：直接把队列里的对象交给调用方，调用方改一下字段就等于改了队列内容，
 * 「只读」就成了空话。拷贝强度写清楚，不做「假装深拷贝」：
 *
 * - 信封（`id` / `from` / `to` / `headers` / `meta` 等顶层字段）**总是**新对象，
 *   `from` / `to` 是新的 `URL` 实例；
 * - `body` / `headers` / `meta` 尽量深拷贝（`structuredClone`）；
 *   body 里带函数、类实例等克隆不了的东西时，只能共享引用（不抛错）——
 *   peek 保证的是「不出队、不建 in-flight、信封不被回写」，不是「body 绝对隔离」。
 *
 * @param message 队列中保存的消息。
 * @returns 与 `message` 不是同一个引用的副本。
 */
export function copyForPeek<T>(message: T): T {
  if (typeof message !== 'object' || message === null) {
    return message
  }

  const source = message as unknown as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    copy[key] = value instanceof URL ? new URL(value.href) : cloneIfPossible(value)
  }
  return copy as unknown as T
}
