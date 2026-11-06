import { describe, it, expect } from 'vitest'
import {
  Capability,
  CapabilityDeclaration,
  IMailboxProvider,
  MailMessage,
  Mailbox,
  MailboxProvider,
  MemoryEventBus,
  MemoryProvider,
  Subscription,
  UnsupportedCapabilityError,
  capabilitiesOf,
  providerCan,
} from './index'

/**
 * 能力声明（D6）：能力是**运行期可变的数据 + 谓词**，内核只认声明，不认「碰巧有这个方法」。
 *
 * 要钉住的四件事：
 *
 * 1. **未声明 = 没有这个操作**。内核不能再靠 `typeof provider.x === 'function'` 猜能力——
 *    那种探测对包装过的 provider、按配置关掉的能力都答错。
 * 2. **声明跟着配置走**：`enableDeadLetterQueue()` 这类开关必须同时改声明，否则诊断面与
 *    上层策略读到的是旧形状（谁改行为谁更新声明）。
 * 3. **声明了却没实现**要报成能力错误，而不是 `TypeError`：内核按声明行动，声明说谎就得把
 *    原因说清。
 * 4. **没声明的第三方 provider**（直接实现 `IMailboxProvider`，`v1.0.0` 就允许）按已实现的
 *    方法推导一份视图——这是兼容兜底，不是正解。
 */

/** 只有发送 / 订阅的极简 provider：没有 status / peek / 租约 / 枚举 / clear。 */
class BareProvider extends MailboxProvider {
  public sent: MailMessage[] = []

  constructor() {
    super('bare')
  }

  protected async _send(message: MailMessage): Promise<void> {
    this.sent.push(message)
  }

  public async subscribe(): Promise<Subscription> {
    return {
      id: 'sub-1',
      address: new URL('bare:x@example.com/u'),
      status: 'active',
      unsubscribe: async () => {},
    }
  }

  protected async _fetch(): Promise<MailMessage | null> {
    return this.sent.shift() ?? null
  }

  // 订阅侧用不到，但基类把它定为抽象方法：必须给个空实现。
  protected _subscribe(): any {}
  protected async _unsubscribe(): Promise<void> {}
}

describe('能力声明：内核以声明为准', () => {
  it('基类按已实现的可选钩子推导初值', () => {
    const memory = MemoryProvider.createIsolated()
    expect(memory.can(Capability.Status)).toBe(true)
    expect(memory.can(Capability.Peek)).toBe(true)
    expect(memory.can(Capability.ListAddresses)).toBe(true)
    expect(memory.can(Capability.RecoverLeases)).toBe(true)
    expect(memory.can(Capability.Clear)).toBe(true)
    // mem: 协议自己的形状（不在通用接口上）由 provider 自己声明
    expect(memory.can('parked')).toBe(true)

    const bare = new BareProvider()
    expect([...bare.supports]).toEqual([])
    expect(bare.can(Capability.Status)).toBe(false)
    expect(bare.can(Capability.Peek)).toBe(false)
  })

  it('能力是运行期可变的数据：死信开关同时改声明', () => {
    const memory = MemoryProvider.createIsolated()
    expect(memory.can('dead-letter')).toBe(false) // 没开 = 没有，`discard` 就是纯丢弃零痕迹

    memory.enableDeadLetterQueue()
    expect(memory.can('dead-letter')).toBe(true)

    memory.disableDeadLetterQueue()
    expect(memory.can('dead-letter')).toBe(false)
  })

  it('删掉声明就没这个操作——即使方法还在（内核不探结构）', async () => {
    const provider = MemoryProvider.createIsolated()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = 'mem:cap-undeclare@example.com/inbox'
    await mailbox.post({ from: 'mem:a@example.com/u', to: address, body: 1 })
    await mailbox.fetch(address, { manualAck: true, ackTimeout: 1 }) // 留一份**已到期**的在飞
    await new Promise((resolve) => setTimeout(resolve, 5))

    provider.supports.delete(Capability.RecoverLeases)
    const report = await mailbox.recover(address)
    expect(report.supported).toBe(false) // 不是「做了但 0 份」，是「这笔没做」
    expect(report.reclaimed).toBe(0)

    provider.supports.add(Capability.RecoverLeases)
    const again = await mailbox.recover(address)
    expect(again.supported).toBe(true)
    expect(again.reclaimed).toBe(1)
  })

  it('注入能力（包装 / AoP）后内核认这笔注入', async () => {
    const provider = new BareProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)

    // 注入一个「租约回收」实现：只挂方法不更新声明 ⇒ 内核看不见它
    ;(provider as BareProvider & Partial<IMailboxProvider>).recoverLeases =
      async () => 7
    expect((await mailbox.recover('bare:x@example.com/u')).supported).toBe(
      false
    )

    // 按规矩更新声明：现在内核会去调它
    provider.supports.add(Capability.RecoverLeases)
    const report = await mailbox.recover('bare:x@example.com/u')
    expect(report.supported).toBe(true)
    expect(report.reclaimed).toBe(7)
  })

  it('没声明 status 的 provider：`Mailbox#status` 回 unknown，且不谎报 exists: false', async () => {
    const provider = new BareProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)

    const status = await mailbox.status('bare:x@example.com/u')
    expect(status.state).toBe('unknown')
    expect(status.exists).toBeUndefined() // 问不到 ≠ 不存在
    expect(status.message).toContain('bare')
  })

  it('声明了 peek 却没实现 `_peek`：报能力错误（附原因），不是 TypeError', async () => {
    const provider = new BareProvider()
    provider.supports.add(Capability.Peek) // 声明与实现漂移：内核会去调一个不存在的方法
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)

    const error = await mailbox
      .fetch('bare:x@example.com/u', { peek: true })
      .then(() => null)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UnsupportedCapabilityError)
    expect((error as UnsupportedCapabilityError).capability).toContain(
      'not implemented'
    )
  })

  it('没实现只读的 provider 想 peek：明确不支持，不会静默把消息取走', async () => {
    const provider = new BareProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.post({
      from: 'bare:a@example.com/u',
      to: 'bare:x@example.com/u',
      body: 1,
    })

    await expect(
      mailbox.fetch('bare:x@example.com/u', { peek: true })
    ).rejects.toThrow(UnsupportedCapabilityError)
    const status = await mailbox.status('bare:x@example.com/u')
    expect(status.state).toBe('unknown')
    expect(provider.sent).toHaveLength(1) // 没被 peek 顺走
  })

  it('`can(op, address)` 带上地址：按地址而异的能力能被内核用上', async () => {
    class ScopedProvider extends MemoryProvider {
      public asked: Array<[string, string | undefined]> = []

      public override can(operation: string, address?: URL): boolean {
        this.asked.push([operation, address?.href])
        // 这个协议的「只读」只对 inbox 那串地址开放（mem: 没有 authority，路径怎么切分是
        // scheme 自己的事，所以这里按 href 判——内核不参与地址内部结构）
        if (
          operation === Capability.Peek &&
          address &&
          !address.href.includes('/inbox')
        ) {
          return false
        }
        return super.can(operation, address)
      }
    }

    const provider = new ScopedProvider(undefined, new MemoryEventBus())
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.post({
      from: 'mem:a@example.com/u',
      to: 'mem:x@example.com/inbox/1',
      body: 1,
    })
    await mailbox.post({
      from: 'mem:a@example.com/u',
      to: 'mem:x@example.com/outbox/1',
      body: 2,
    })

    await expect(
      mailbox.fetch('mem:x@example.com/outbox/1', { peek: true })
    ).rejects.toThrow(UnsupportedCapabilityError)
    expect(
      await mailbox.fetch('mem:x@example.com/inbox/1', { peek: true })
    ).toHaveLength(1)
    expect(provider.asked).toContainEqual([
      Capability.Peek,
      'mem:x@example.com/outbox/1',
    ])
  })

  it('直接实现 IMailboxProvider 的第三方（无声明）：按已实现方法推导视图', async () => {
    const foreign: IMailboxProvider = {
      protocol: 'foreign',
      send: async (message) => message,
      subscribe: async () => ({
        id: 's',
        address: new URL('foreign:x@example.com/u'),
        status: 'active',
        unsubscribe: async () => {},
      }),
      fetch: async (): Promise<any> => null,
      generateId: () => 'id',
      status: async () => ({ state: 'online' }),
      clear: async () => {},
    }

    expect([...capabilitiesOf(foreign).values()].sort()).toEqual(
      [Capability.Clear, Capability.Status].sort()
    )
    // 没实现的枚举 / 租约不会被推导出来
    expect(providerCan(foreign, Capability.ListAddresses)).toBe(false)
    expect(providerCan(foreign, Capability.RecoverLeases)).toBe(false)
    // `peek` 是 provider 内部钩子（`_peek`），接口层看不见 ⇒ 没声明就按不支持答，
    // 把消息取走比答「不支持」危险得多。
    expect(providerCan(foreign, Capability.Peek)).toBe(false)

    const mailbox = new Mailbox()
    mailbox.registerProvider(foreign)
    const snapshot = await mailbox.snapshot()
    expect(snapshot.unsupportedProviders).toEqual(['foreign']) // 「枚举不了」不被读成「队列为空」
  })

  it('能力名是字符串，不是类型字段：新能力不需要改类型', () => {
    const provider = MemoryProvider.createIsolated()
    expect(provider.can('a-brand-new-capability')).toBe(false)
    provider.supports.add('a-brand-new-capability')
    expect(provider.can('a-brand-new-capability')).toBe(true)
    const declared: CapabilityDeclaration = provider
    expect(declared.supports.has('a-brand-new-capability')).toBe(true)
  })
})
