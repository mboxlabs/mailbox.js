import { InvalidFetchOptionsError, InvalidMailboxAddressError } from '../error'

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
