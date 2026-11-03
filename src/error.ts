/**
 * 库内错误的错误码。跨语言端口（Python `MailboxError` / Rust `MailboxError`）按同样的码对齐，
 * 调用方判断错误类型请用 `code` / `instanceof`，不要匹配 message —— message 是给人看的，会变。
 */
export type MailboxErrorCode =
  | 'MBX_INVALID_ADDRESS'
  | 'MBX_INVALID_FETCH_OPTIONS'
  | 'MBX_INVALID_DEAD_LETTER_SUFFIX'
  | 'MBX_UNSUPPORTED_CAPABILITY'
  | 'MBX_NO_PROVIDER'

/**
 * Mailbox 错误的公共基类（对齐 Python 端 `MailboxError` / Rust 端 `MailboxError`）。
 */
export class MailboxError extends Error {
  public readonly code: MailboxErrorCode

  constructor(code: MailboxErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

/**
 * 地址不合法：无法解析成 URL，或者带着规范化会**静默丢掉**的部件（query / hash）。
 *
 * 见 {@link getCanonicalMailboxAddressIdentifier}：地址语义必须留在 path 里。
 */
export class InvalidMailboxAddressError extends MailboxError {
  /** 出错时正在处理的地址（字符串形式，便于诊断页直接展示）。 */
  public readonly address: string

  constructor(address: string, message: string, options?: ErrorOptions) {
    super('MBX_INVALID_ADDRESS', message, options)
    this.name = 'InvalidMailboxAddressError'
    this.address = address
  }
}

/**
 * `fetch()` 的选项自相矛盾或取值非法（例如 `peek: true` 与 `manualAck: true` 同时出现、
 * `limit` 为负数）。这类错误是调用方的代码问题，必须在调用点炸出来，不能被忽略。
 */
export class InvalidFetchOptionsError extends MailboxError {
  constructor(message: string, options?: ErrorOptions) {
    super('MBX_INVALID_FETCH_OPTIONS', message, options)
    this.name = 'InvalidFetchOptionsError'
  }
}

/**
 * provider 不具备被请求的能力（例如对不支持只读 `peek` 的传输强要 peek）。
 *
 * 为什么要有这个错误：把 `peek` 这类新选项交给不认识它的 provider，等于**静默退化成普通 fetch**
 * —— 调用方以为自己在只读快照，实际已经把消息出队了。宁可抛错。
 */
export class UnsupportedCapabilityError extends MailboxError {
  public readonly protocol: string
  /** 缺失的能力名，例如 `'peek'` / `'status'`。 */
  public readonly capability: string

  constructor(protocol: string, capability: string) {
    super(
      'MBX_UNSUPPORTED_CAPABILITY',
      `The '${protocol}' provider does not support '${capability}'.`,
    )
    this.name = 'UnsupportedCapabilityError'
    this.protocol = protocol
    this.capability = capability
  }
}

/**
 * 死信队列后缀非法。空后缀会让死信写回**原队列**（被放弃的消息重新变得可消费，
 * 等于无限重试），带 query / hash 的后缀会在地址规范化时被静默丢掉——两者都是配置错误，
 * 在 `enableDeadLetterQueue()` 的调用点直接抛。
 */
export class InvalidDeadLetterSuffixError extends MailboxError {
  /** 被拒绝的后缀原值。 */
  public readonly suffix: unknown

  constructor(suffix: unknown, message: string, options?: ErrorOptions) {
    super('MBX_INVALID_DEAD_LETTER_SUFFIX', message, options)
    this.name = 'InvalidDeadLetterSuffixError'
    this.suffix = suffix
  }
}

/**
 * 没有 provider 认领这个协议（对齐 Python `ProviderNotFound` / Rust `ProviderNotFound`）。
 */
export class NoProviderError extends MailboxError {
  public readonly protocol: string

  constructor(protocol: string) {
    super('MBX_NO_PROVIDER', `No provider for protocol: ${protocol}`)
    this.name = 'NoProviderError'
    this.protocol = protocol
  }
}
