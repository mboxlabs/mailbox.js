/**
 * 内核句柄层（`bindConsumerHandle`）—— 3.0.0 结算切口的**归属层**测试。
 *
 * 为什么这条必须在核心仓里：处置路由的判据（「provider 的句柄自己有没有 `nack`」）、一次性护栏、
 * 「先校验后执行」、以及「公开句柄上删掉 `nack`」都实现在核心 `src/lib/handle.ts`。拆包之后
 * `Ackable` 只剩 `ack(where?)`，如果这些断言只活在下游 `mem:` provider 的测试里，核心改坏路由
 * 就没人红——那正是「测的是参考实现，不是契约」的老毛病（拆包计划 §3 提基座的同一理由）。
 *
 * 命名标记：
 *   [语义] 契约不变量，破坏它们就是回归。
 *   [事实] 锁住实现里真实存在的出口（不替 provider 编返回值）。
 */

import { describe, it, expect } from 'vitest'
import { bindConsumerHandle, hasHandle } from './handle'
import { Capability } from './capability'
import { MailboxProvider } from '../providers/MailboxProvider'
import { UnsupportedCapabilityError } from '../error'
import type { Disposition, MailMessage } from '../interfaces'

/** 句柄层不碰投递：四个必备钩子留空壳，只为了拿到一个带能力声明的 provider。 */
class Probe extends MailboxProvider {
  protected async _send(): Promise<void> {}
  protected _subscribe(): unknown {
    return null;
  }
  protected async _unsubscribe(): Promise<void> {}
  protected async _fetch(): Promise<MailMessage | null> {
    return null;
  }
}

const provider = new Probe('h')
const address = new URL('h://reader@example.com/inbox')

/** provider `_fetch` 交回来的句柄形状：记录内核最终递到哪个动词上。 */
interface RawProbe {
  id: string
  body: string
  ack: (where?: Disposition) => Promise<boolean | void>
  nack?: () => Promise<boolean | void>
}

function rawHandle(
  shape: 'disposition-aware' | 'two-verbs',
  outcome: { result?: boolean | void } = {}
): {
  handle: RawProbe
  calls: { verb: 'ack' | 'nack'; where?: Disposition }[]
} {
  // 显式传 `result: undefined` 与「没传这个键」是两回事：前者测的就是「provider 不报」。
  const result = 'result' in outcome ? outcome.result : true
  const calls: { verb: 'ack' | 'nack'; where?: Disposition }[] = []
  const handle: RawProbe = {
    id: 'copy-1',
    body: 'letter',
    ack: async (where?: Disposition) => {
      calls.push({ verb: 'ack', where })
      return result
    },
  }
  if (shape === 'two-verbs') {
    handle.nack = async () => {
      calls.push({ verb: 'nack' })
      return result
    }
  }
  return { handle, calls }
}

const verbsOf = (calls: { verb: string; where?: Disposition }[]) =>
  calls.map((c) =>
    c.verb === 'ack' && c.where !== undefined ? `ack(${c.where})` : c.verb
  )

describe('bindConsumerHandle：句柄自己的形状决定路由（3.0.0）', () => {
  it('[语义] 没有 `nack` 的句柄 = 处置感知：处置值原样递给它的 `ack(where)`', async () => {
    for (const where of ['unhandled', 'discard', 'handled'] as Disposition[]) {
      const { handle, calls } = rawHandle('disposition-aware')
      const bound = bindConsumerHandle(
        handle as unknown as MailMessage,
        provider,
        address
      )

      await expect(bound.ack(where)).resolves.toBe(true)
      expect(verbsOf(calls)).toEqual([`ack(${where})`])
    }
  })

  it('[语义] 无参 `ack()` 归一成 `handled`：内核不猜调用方的意图', async () => {
    const { handle, calls } = rawHandle('disposition-aware')
    const bound = bindConsumerHandle(
      handle as unknown as MailMessage,
      provider,
      address
    )

    await expect(bound.ack()).resolves.toBe(true)
    expect(verbsOf(calls)).toEqual(['ack(handled)'])
  })

  it('[语义] 两动词句柄：`unhandled` 走 `nack()`，`handled` / `discard` 都走 `ack()`', async () => {
    const seen: string[] = []
    for (const where of ['handled', 'discard', undefined] as (
      Disposition | undefined
    )[]) {
      const { handle, calls } = rawHandle('two-verbs')
      const bound = bindConsumerHandle(
        handle as unknown as MailMessage,
        provider,
        address
      )

      await bound.ack(where)
      seen.push(verbsOf(calls).join(','))
    }
    // `handled` 与 `discard` 在这种句柄上确实是同一个动作：这份到此为止。
    expect(seen).toEqual(['ack', 'ack', 'ack'])

    const requeue = rawHandle('two-verbs')
    const bound = bindConsumerHandle(
      requeue.handle as unknown as MailMessage,
      provider,
      address
    )
    await bound.ack('unhandled')
    expect(verbsOf(requeue.calls)).toEqual(['nack'])
  })

  it('[语义] 自定义处置递给两动词句柄：显式报错，不降级成 `ack()`', async () => {
    provider.supports.add(Capability.disposition('answered'))
    try {
      const { handle, calls } = rawHandle('two-verbs')
      const bound = bindConsumerHandle(
        handle as unknown as MailMessage,
        provider,
        address
      )

      await expect(bound.ack('answered')).rejects.toBeInstanceOf(
        UnsupportedCapabilityError
      )
      expect(calls).toHaveLength(0) // 递给我一个不认得这个值的句柄 = 不做，而不是当成「结束」
    } finally {
      provider.supports.delete(Capability.disposition('answered'))
    }
  })

  it('[语义] 自定义处置递给处置感知句柄：声明过就原样递下去', async () => {
    provider.supports.add(Capability.disposition('answered'))
    try {
      const { handle, calls } = rawHandle('disposition-aware')
      const bound = bindConsumerHandle(
        handle as unknown as MailMessage,
        provider,
        address
      )

      await expect(bound.ack('answered')).resolves.toBe(true)
      expect(verbsOf(calls)).toEqual(['ack(answered)'])
    } finally {
      provider.supports.delete(Capability.disposition('answered'))
    }
  })

  it('[语义] 公开句柄上没有 `nack`：调用方不能绕过一次性护栏直接动 provider 句柄', async () => {
    const { handle } = rawHandle('two-verbs')
    const bound = bindConsumerHandle(
      handle as unknown as MailMessage,
      provider,
      address
    )

    expect('nack' in bound).toBe(false)
    expect((bound as unknown as { nack?: unknown }).nack).toBeUndefined()
    // 对象同一性保持不变：`fetch()` 返回的就是 provider 那份消息
    expect(bound).toBe(handle as unknown as MailMessage)
  })

  it('[语义] 一次取信 = 一次处置：第二次不动 provider 句柄，只回 false', async () => {
    const { handle, calls } = rawHandle('two-verbs')
    const bound = bindConsumerHandle(
      handle as unknown as MailMessage,
      provider,
      address
    )

    await expect(bound.ack('unhandled')).resolves.toBe(true)
    await expect(bound.ack('discard')).resolves.toBe(false)
    await expect(bound.ack()).resolves.toBe(false)
    expect(verbsOf(calls)).toEqual(['nack'])
  })

  it('[语义] 校验先于执行：不认得的值抛错且**不消耗**那一次处置机会', async () => {
    const { handle, calls } = rawHandle('disposition-aware')
    const bound = bindConsumerHandle(
      handle as unknown as MailMessage,
      provider,
      address
    )

    await expect(bound.ack('answered')).rejects.toBeInstanceOf(
      UnsupportedCapabilityError
    )
    expect(calls).toHaveLength(0)

    await expect(bound.ack('unhandled')).resolves.toBe(true)
    expect(verbsOf(calls)).toEqual(['ack(unhandled)'])
  })

  it('[事实] provider 句柄回什么就用什么：不报就没有报，不替它编一个 true', async () => {
    const notReported = rawHandle('disposition-aware', { result: undefined })
    const silent = bindConsumerHandle(
      notReported.handle as unknown as MailMessage,
      provider,
      address
    )
    await expect(silent.ack('handled')).resolves.toBeUndefined()

    const refused = rawHandle('disposition-aware', { result: false })
    const rejected = bindConsumerHandle(
      refused.handle as unknown as MailMessage,
      provider,
      address
    )
    await expect(rejected.ack('unhandled')).resolves.toBe(false)
  })

  it('[语义] 句柄不带 `ack` 就不是句柄：manual-ack 取信直接报错（不静默当隐式 ACK）', async () => {
    const message = { id: 'copy-1', body: 'letter' } as unknown as MailMessage
    expect(hasHandle(message)).toBe(false)
    expect(() => bindConsumerHandle(message, provider, address)).toThrow(
      UnsupportedCapabilityError
    )
    expect(hasHandle(rawHandle('two-verbs').handle)).toBe(true)
  })
})
