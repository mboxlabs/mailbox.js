/**
 * `mem:` 这个 scheme 的**地址折叠规则**——它故意**不从 `src/lib/index.ts` 导出**。
 *
 * 为什么退出公共面（D5 + `3.0.0` 拆包计划 §6.1）：
 * - 内核只 `parseMailboxAddress`，不折叠字段、不判等、不禁 query / fragment（见 `utils.ts`）；
 * - `mem:a@h/i` 与 `mem://a@h/i` 是同一个信箱，这是 `mem:` 的**语法声明**，不是 URL 的通用规则；
 * - 别的 scheme 拿整套 href 当键、或让 query 参与寻址时，这个折叠会把两个信箱判成一个——正是错的。
 *
 * 所以这两个函数是 provider 内部件：`MemoryProvider` 用它给队列取键，第三方要同款折叠自带一份。
 * 它们曾长期从核心 barrel 泄漏（`export * from './utils'`），`3.0.0` 起不再出现在导出面上。
 */

import { InvalidMailboxAddressError } from "../error";

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
 * **不在导出面上**：本文件不从 `src/lib/index.ts` 导出（随 `3.0.0` 发布；`2.x` 能 `import` 到，
 * 升级后会编译报错）。内核不调它（`src/mailbox.ts` 一次都不用）；`MemoryProvider` 拿它给队列取键；
 * 第三方要同款折叠自带一份。
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
 * **不在导出面上**（同上）：公开契约里不该有它（`MailboxAddressSnapshot.canonicalId` 已移除）。
 * 它只是 `mem:` 的内部键写法；第三方 provider 需要同款折叠就自带一份。
 *
 * @param address The URL object representing the mailbox address.
 * @returns A canonical string identifier for the mailbox address.
 * @throws {InvalidMailboxAddressError} 地址带 query / hash（它们无法在这个折叠里保留）。
 */
export function getCanonicalMailboxAddressIdentifier(address: URL): string {
  assertLosslessMailboxAddress(address, 'address canonicalization')
  return foldMailboxAddress(address)
}
