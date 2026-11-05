import { UnsupportedCapabilityError } from '../error'
import type { IMailboxProvider } from '../interfaces'
import { CORE_DISPOSITIONS } from '../interfaces'
import type { Disposition } from '../interfaces'
import { Capability, providerCan } from './capability'

/** 没写处置值 = 内核词汇里的 `handled`（这一次交付我看完了）。 */
export const DEFAULT_DISPOSITION: Disposition = 'handled'

/**
 * 把调用方给的处置值规整成内核词汇。
 *
 * 空串 / 空白 = 手滑，不是「某种自定义处置」：按默认值处理，而不是抛错——
 * `ack('')` 与 `ack()` 该是同一件事。
 */
export function normalizeDisposition(where?: string): Disposition {
  if (where === undefined || where === null) {
    return DEFAULT_DISPOSITION
  }
  const trimmed = where.trim()
  return trimmed === '' ? DEFAULT_DISPOSITION : trimmed
}

/** 是不是内核的三个词汇值。 */
export function isCoreDisposition(where: string): where is Disposition {
  return (CORE_DISPOSITIONS as readonly string[]).includes(where)
}

/**
 * 处置值合法吗？
 *
 * 三个内核词汇永远合法；其余值是 provider 自定义的，**必须由能力声明覆盖**
 * （`supports.has('disposition:<where>')`）。不认得就在处置发生**之前**报错——
 * 不能先把消息处理掉再说「这个值我不认」，那样调用方既不知道有没有生效，也没法补救。
 */
export function assertDisposition(
  where: Disposition,
  provider: IMailboxProvider,
  address?: URL
): void {
  if (isCoreDisposition(where)) {
    return
  }
  if (providerCan(provider, Capability.disposition(where), address)) {
    return
  }
  throw new UnsupportedCapabilityError(
    provider.protocol,
    `disposition '${where}' (the kernel vocabulary is ${CORE_DISPOSITIONS.map(
      (d) => `'${d}'`
    ).join(
      ' / '
    )}; a custom value must be declared as '${Capability.disposition(
      where
    )}' in \`supports\` and honored by the handle)`
  )
}

/**
 * 自定义处置（既不是 `handled` 也不是 `unhandled` / `discard`）。
 *
 * 只有 provider 声明过才会走到这里；它把处置直接交给句柄自己的 `ack(where)`，
 * 因为「这个值意味着什么」是 provider 的协议知识，内核不参与。
 */
export function isCustomDisposition(where: Disposition): boolean {
  return !isCoreDisposition(where)
}
