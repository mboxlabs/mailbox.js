import { InvalidFetchOptionsError, InvalidMailboxAddressError } from '../error'

/**
 * 校验一个地址在规范化时不会**静默丢掉**信息。
 *
 * `mem:inbox@host/thread?thread=1` 和 `mem:inbox@host/thread` 是两个逻辑地址，但它们的
 * canonical id 相同（见 {@link getCanonicalMailboxAddressIdentifier}）—— query / hash 会被丢掉。
 * 与其让两条互不相干的业务流共用同一条队列（issue#4：「看起来能用、实际共用一条队列」），
 * 不如在入口就拒绝：**邮箱语义必须留在 path 里**，query / hash 不参与寻址。
 *
 * 三端（TS / Python / Rust）都用同一条规则，参数名保持一致。
 *
 * @param address 待校验的地址。
 * @param context 出错信息里带上的调用点名字（例如 `'post()'`），便于定位。
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
      `with "${address.protocol}//${address.host}${address.pathname}". ` +
      'Mailbox semantics must live in the path (e.g. "mem:host/inbox/thread-1"), not in the query or hash.',
    )
  }
}

/**
 * 把用户传入的地址解析成 URL，并校验它可被无损规范化（见 {@link assertLosslessMailboxAddress}）。
 *
 * 所有入口（`post` / `subscribe` / `fetch` / `status`）都走这里，保证「同一个地址在每个入口
 * 都指向同一个 topic」，且非法形式在同一处报错。
 *
 * @param input 地址字符串或 URL 对象。
 * @param context 出错信息里带上的调用点名字。
 * @returns 解析后的 URL。
 * @throws {InvalidMailboxAddressError} 无法解析，或带 query / hash。
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

  assertLosslessMailboxAddress(address, context)
  return address
}

/**
 * Generates a canonical string identifier for a mailbox address.
 * This function normalizes the input URL by stripping sensitive information (like password)
 * and irrelevant parts (like hash fragments).
 *
 * query（`search`）曾经也被「顺手丢掉」—— 那会让 `?thread=1`、`#fragment` 这类写法
 * 看起来能用、实际和不带 query 的地址塌成同一个 topic（issue#4）。现在这类地址在规范化
 * 之前就被拒绝：调用方拿到的是明确错误，而不是一条被合并的队列。
 *
 * @param address The URL object representing the mailbox address.
 * @returns A canonical string identifier for the mailbox address.
 * @throws {InvalidMailboxAddressError} 地址带 query / hash（它们无法在 canonical id 里保留）。
 */
export function getCanonicalMailboxAddressIdentifier(address: URL): string {
  assertLosslessMailboxAddress(address, 'address canonicalization')

  const userInfo = address.username ? `${address.username}@` : ''
  return `${address.protocol}//${userInfo}${address.host}${address.pathname}`
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
