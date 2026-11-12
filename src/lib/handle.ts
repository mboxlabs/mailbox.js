import { UnsupportedCapabilityError } from '../error'
import type {
  AckableMailMessage,
  Disposition,
  IMailboxProvider,
  MailMessage,
} from '../interfaces'
import {
  assertDisposition,
  isCustomDisposition,
  normalizeDisposition,
} from './disposition'

/** provider 交回来的句柄形状（`_fetch` 那侧的东西，公开契约之外）。 */
type RawHandle = MailMessage & {
  ack: (where?: Disposition) => Promise<boolean | void>
  /**
   * 「两个动词」句柄才有它（队列层就是）：`ack()` 结束这一份，`nack()` 把这一份退回队首。
   * 处置感知的句柄**不该带它**：那个形状就是用「没有 `nack`」声明「我的 `ack(where)` 认得处置值」。
   */
  nack?: () => Promise<boolean | void>
}

/** 这条消息带着句柄吗。 */
export function hasHandle(message: unknown): message is RawHandle {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as RawHandle).ack === 'function'
  )
}

/**
 * 把 provider 交回来的句柄套成**内核句柄**（D3 + D4 的执行点）。
 *
 * 内核在 `Mailbox#fetch` 这一层执行词汇表与「一次取信 = 一次处置」，而不是指望每个 provider
 * 自己记得：第三方 provider 只要给出 `ack` / `nack()`（两个动词、不带参数），句柄语义就由内核兜住。
 *
 * 三件事：
 *
 * 1. **处置值先校验后执行**（{@link assertDisposition}）。自定义值没声明过就抛
 *    `UnsupportedCapabilityError`，而且**不消耗**这个句柄的那一次处置机会——调用方还能用
 *    合法值补救。反过来，先把消息处理掉再报「这值我不认」就等于让调用方永远不知道有没有生效。
 * 2. **一次取信 = 一次处置**：第二次处置（含租约到期重投后拿着旧句柄来）返回 `false`，
 *    不动队列、不抛错。
 * 3. **把结果回给调用方**：provider 句柄回什么就用什么（`true` / `false`）；它不报（`undefined`）
 *    我们就回 `undefined`——不替它编一个 `true`。
 *
 * 路由到 provider 句柄（3.0.0）——判据是**句柄自己有没有 `nack`**：
 *
 * - **没有 `nack`** ⇒ 处置感知的句柄：处置值原样递给它的 `ack(where)`。「这个值意味着什么」
 *   是 provider 的协议知识，内核不参与（自定义值已经被 {@link assertDisposition} 按能力声明拦过）。
 * - **有 `nack`** ⇒ 「两个动词」的老句柄（队列层就是这种）：`handled` / `discard` → `ack()`
 *   （两者在这种句柄上确实是同一个动作：这份到此为止），`unhandled` → `nack()`。
 *   自定义处置递给它就是递给了一个不认得它的句柄 ⇒ 报错。
   *
 * 这里读的是**句柄自己的形状**，不是 provider 的能力声明：能力声明说的是「调用方能做什么」，
 * 而这里要回答的是「provider 把自己的句柄写成了哪一种」。两者不相干（一个 provider 可以声明
 * `settle`、同时 `_fetch` 递回一个队列层那种两动词句柄）。
 *
 * 句柄上没有 `nack` 却要 `unhandled`：那个句柄自己必须把 `ack('unhandled')` 实现成退回队列——
 * 内核不会替它把「退回队列」降级成 `ack()`，那等于悄悄丢弃。
 *
 * 内核接管的句柄上 **`nack` 会被删掉**：公开面只剩 `ack(where)` 一个入口，不然调用方能绕过
 * 「一次取信 = 一次处置」直接动 provider 那份句柄。
 *
 * @param message provider 交回来的（带句柄的）消息；就地换掉 `ack`、删掉 `nack`，保持对象同一性
 * @param provider 负责这个地址的 provider：处置值的合法性由它的**能力声明**决定
 * @param address 这次取信的地址：按地址而异的能力声明要用到
 */
export function bindConsumerHandle(
  message: MailMessage,
  provider: IMailboxProvider,
  address: URL
): AckableMailMessage {
  const handle = message as RawHandle
  if (!hasHandle(handle)) {
    throw new UnsupportedCapabilityError(
      provider.protocol,
      'manual-ack handle (the message this provider returned has no `ack()`; fetch without `manualAck`, or return an Ackable message)'
    )
  }

  const rawAck = handle.ack.bind(handle)
  const rawNack =
    typeof handle.nack === 'function' ? handle.nack.bind(handle) : undefined
  // 两动词句柄（有 `nack`）不认处置词汇；没 `nack` 的就是处置感知句柄。
  const twoVerbs = rawNack !== undefined
  let disposed = false

  const settle = async (where?: Disposition): Promise<boolean | void> => {
    const value = normalizeDisposition(where)
    assertDisposition(value, provider, address)
    if (twoVerbs && isCustomDisposition(value)) {
      throw new UnsupportedCapabilityError(
        provider.protocol,
        `disposition '${value}' (this provider returned a two-verb handle with \`ack()\` / \`nack()\`; a custom disposition needs a handle that honors \`ack(where)\`)`
      )
    }
    if (disposed) {
      return false
    }
    disposed = true

    let applied: boolean | void
    if (!twoVerbs) {
      applied = await rawAck(value)
    } else if (value === 'unhandled') {
      applied = await rawNack!()
    } else {
      // `handled` 与 `discard` 在两动词句柄上是同一个动作：这份到此为止（要退回就写 'unhandled'）。
      applied = await rawAck()
    }
    return applied
  }

  Object.defineProperty(handle, 'ack', {
    value: (where?: Disposition) => settle(where),
    writable: true,
    configurable: true,
    enumerable: true,
  })
  // 3.0.0：公开面只剩 `ack(where)`。provider 自己那个 `nack` 已经从这里递给内核了（rawNack），
  // 但**不能留在调用方拿得到的对象上**：那等于绕开「一次取信 = 一次处置」直接动 provider 句柄。
  delete (handle as { nack?: unknown }).nack
  return handle as AckableMailMessage
}
