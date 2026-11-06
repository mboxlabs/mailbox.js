import { describe, it, expect } from 'vitest'
import {
  AckableMailMessage,
  Capability,
  Disposition,
  MailMessage,
  Mailbox,
  MailboxProvider,
  MemoryProvider,
  Subscription,
  UnsupportedCapabilityError,
} from './index'

/**
 * 处置词汇（D3）与「一次取信 = 一次处置」（D4）。
 *
 * 词汇说的是「这次交付怎么收尾」，不是「成功 / 失败」：
 * `handled`（到此为止，不留痕）/ `unhandled`（交回队列，还会再交出去）/
 * `discard`（判它不合格，结束，provider 按自己协议善后）。
 *
 * 要钉住的行为：
 *
 * - 三个值各自的效果；**`nack(true|false)` 是完整 alias**——不是「参数被忽略的旧方法」，
 *   那会让老代码里的 `nack(false)` 从丢弃静默变成无限重投；
 * - **句柄只生效一次**：重复处置、租约到期后拿着旧句柄来处置，都返回 `false`，
 *   不抛错，也不静默 no-op；
 * - **结果回给调用方**：`true` / `false` 是事实；provider 不报告就是 `undefined`，内核不编一个；
 * - **不认得的处置值先报错、不动消息**：那次「一次处置」的机会不会被失败的调用消耗掉；
 * - 自定义处置值必须由能力声明覆盖，然后原样交给 provider 的句柄。
 */

async function isolatedMailbox(protocolAddress: string) {
  const provider = MemoryProvider.createIsolated()
  const mailbox = new Mailbox()
  mailbox.registerProvider(provider)
  await mailbox.start()
  const address = protocolAddress.replace(
    '<id>',
    Math.random().toString(36).slice(2)
  )
  return { provider, mailbox, address }
}

async function takeOne(
  mailbox: Mailbox,
  address: string,
  options?: { ackTimeout?: number | null }
) {
  await mailbox.post({
    from: 'mem:sender@example.com/u',
    to: address,
    body: { n: 1 },
  })
  const taken = await mailbox.fetch(address, { manualAck: true, ...options })
  expect(taken).not.toBeNull()
  return taken as AckableMailMessage
}

describe('处置词汇：ack(handled | unhandled | discard)', () => {
  it('handled：结束这次交付，队列与在飞都清零，什么都不留', async () => {
    const { mailbox, address } = await isolatedMailbox(
      'mem:disp-handled-<id>@example.com/inbox'
    )
    const taken = await takeOne(mailbox, address)

    await expect(taken.ack('handled')).resolves.toBe(true)

    const status = await mailbox.status(address)
    expect(status.unreadCount).toBe(0)
    expect(status.inFlightCount).toBe(0)
  })

  it('省略处置值 = handled（老写法 `ack()` 的语义不变）', async () => {
    const { mailbox, address } = await isolatedMailbox(
      'mem:disp-default-<id>@example.com/inbox'
    )
    const taken = await takeOne(mailbox, address)

    await expect(taken.ack()).resolves.toBe(true)
    expect((await mailbox.status(address)).inFlightCount).toBe(0)
  })

  it('unhandled：交回队列，还会再被取到', async () => {
    const { mailbox, address } = await isolatedMailbox(
      'mem:disp-unhandled-<id>@example.com/inbox'
    )
    const taken = await takeOne(mailbox, address)

    await expect(taken.ack('unhandled')).resolves.toBe(true)

    const status = await mailbox.status(address)
    expect(status.inFlightCount).toBe(0)
    expect(status.unreadCount).toBe(1) // 不是被丢掉，是回到未读
    expect(await mailbox.fetch(address, { peek: true })).toHaveLength(1)
  })

  it('discard：不开死信队列时就是纯丢弃——而且没声明 `dead-letter` 能力', async () => {
    const { provider, mailbox, address } = await isolatedMailbox(
      'mem:disp-discard-<id>@example.com/inbox'
    )
    const taken = await takeOne(mailbox, address)

    await expect(taken.ack('discard')).resolves.toBe(true)

    const status = await mailbox.status(address)
    expect(status.unreadCount).toBe(0)
    expect(status.inFlightCount).toBe(0)
    expect(provider.can('dead-letter')).toBe(false) // 没开 = 没有，声明不说谎
    expect(provider.peekParked(address)).toHaveLength(0)
  })

  it('discard + 死信队列：留一条痕（这就是「按协议善后」）', async () => {
    const { provider, mailbox, address } = await isolatedMailbox(
      'mem:disp-dlq-<id>@example.com/inbox'
    )
    provider.enableDeadLetterQueue()
    const taken = await takeOne(mailbox, address)

    await taken.ack('discard')

    const records = await mailbox.fetch(provider.deadLetterTopic(address)!, {
      peek: true,
    })
    expect(records).toHaveLength(1)
    expect(records[0].headers?.['mbx-dead-letter-reason']).toBe('consumer-nack')
  })
})

describe('deprecated alias：nack(requeue) 是完整等价，不是被忽略的参数', () => {
  it("nack(true) ≡ ack('unhandled')：回队，且不会因此留死信痕", async () => {
    const { provider, mailbox, address } = await isolatedMailbox(
      'mem:disp-nacktrue-<id>@example.com/inbox'
    )
    provider.enableDeadLetterQueue()
    const taken = await takeOne(mailbox, address)

    await expect(taken.nack(true)).resolves.toBe(true)

    expect((await mailbox.status(address)).unreadCount).toBe(1)
    expect(
      await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true })
    ).toHaveLength(0)
  })

  it("nack(false) / nack() ≡ ack('discard')：缺省参数仍是 false（v1.0.0 的语义）", async () => {
    const { provider, mailbox, address } = await isolatedMailbox(
      'mem:disp-nackfalse-<id>@example.com/inbox'
    )
    provider.enableDeadLetterQueue()
    await (await takeOne(mailbox, address)).nack(false)
    await (await takeOne(mailbox, address)).nack()

    expect(
      await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true })
    ).toHaveLength(2)
    expect((await mailbox.status(address)).unreadCount).toBe(0)
  })
})

describe('一次取信 = 一次处置（句柄代表这次交付，不代表这封信）', () => {
  it('ack 之后再 discard：不生效，也不给处理成功的消息写死信', async () => {
    const { provider, mailbox, address } = await isolatedMailbox(
      'mem:disp-twice-a-<id>@example.com/inbox'
    )
    provider.enableDeadLetterQueue()
    const taken = await takeOne(mailbox, address)

    await taken.ack('handled')
    await expect(taken.ack('discard')).resolves.toBe(false)

    expect(
      await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true })
    ).toHaveLength(0)
  })

  it('unhandled 之后再 ack：不生效，退回队列的那一份不受影响', async () => {
    const { mailbox, address } = await isolatedMailbox(
      'mem:disp-twice-b-<id>@example.com/inbox'
    )
    const taken = await takeOne(mailbox, address)

    await taken.ack('unhandled')
    await expect(taken.ack('handled')).resolves.toBe(false)

    const status = await mailbox.status(address)
    expect(status.unreadCount).toBe(1)
    expect(status.inFlightCount).toBe(0)
  })

  it('重复 unhandled 只回队一份（补偿代码里常见的「再 nack 一次」不会复制消息）', async () => {
    const { mailbox, address } = await isolatedMailbox(
      'mem:disp-twice-c-<id>@example.com/inbox'
    )
    const taken = await takeOne(mailbox, address)

    await expect(taken.ack('unhandled')).resolves.toBe(true)
    await expect(taken.ack('unhandled')).resolves.toBe(false)

    expect((await mailbox.status(address)).unreadCount).toBe(1)
  })

  it('重复 discard 只留一条死信痕', async () => {
    const { provider, mailbox, address } = await isolatedMailbox(
      'mem:disp-twice-d-<id>@example.com/inbox'
    )
    provider.enableDeadLetterQueue()
    const taken = await takeOne(mailbox, address)

    await expect(taken.ack('discard')).resolves.toBe(true)
    await expect(taken.nack(false)).resolves.toBe(false)

    expect(
      await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true })
    ).toHaveLength(1)
  })

  it('迟到的旧句柄：租约到期重投后，旧消费者怎么处置都不生效', async () => {
    const { mailbox, address } = await isolatedMailbox(
      'mem:disp-late-<id>@example.com/inbox'
    )
    const stale = await takeOne(mailbox, address, { ackTimeout: 1 })
    await new Promise((resolve) => setTimeout(resolve, 5))

    const fresh = await mailbox.fetch(address, { manualAck: true })
    expect(fresh).not.toBeNull() // 到期重投，被新消费者接走

    await expect(stale.ack('handled')).resolves.toBe(false)
    await expect(stale.ack('discard')).resolves.toBe(false)

    await expect(fresh!.ack('handled')).resolves.toBe(true) // 新消费者的处置照常生效
    const status = await mailbox.status(address)
    expect(status.inFlightCount).toBe(0)
    expect(status.unreadCount).toBe(0)
  })
})

describe('处置值合法吗：内核词汇免费，自定义值要声明', () => {
  it('不认得的处置值：先报能力错误，而且不消耗这次处置的机会', async () => {
    const { provider, mailbox, address } = await isolatedMailbox(
      'mem:disp-unknown-<id>@example.com/inbox'
    )
    provider.enableDeadLetterQueue()
    const taken = await takeOne(mailbox, address)

    const error = await taken.ack('quarantine').then(
      () => null,
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(UnsupportedCapabilityError)
    expect((error as UnsupportedCapabilityError).capability).toContain(
      "'quarantine'"
    )

    // 消息还在飞（处置没发生），句柄也还能用：调用方可以换合法值补救
    expect((await mailbox.status(address)).inFlightCount).toBe(1)
    await expect(taken.ack('discard')).resolves.toBe(true)
    expect(
      await mailbox.fetch(provider.deadLetterTopic(address)!, { peek: true })
    ).toHaveLength(1)
  })

  it('provider 声明过的自定义处置值：原样交给它的句柄', async () => {
    const { mailbox, handle } = await tinyMailbox('custom')
    const taken = (await mailbox.fetch('tiny:x@example.com/inbox', {
      manualAck: true,
    })) as AckableMailMessage

    await expect(taken.ack('answered')).resolves.toBe(true)
    expect(handle.seen).toEqual(['answered']) // 「这值意味着什么」是 provider 的协议知识
  })

  it('同一个自定义处置值：没声明过的 provider 一律显式拒绝', async () => {
    const { provider, mailbox, handle } = await tinyMailbox('custom-undeclared')
    const taken = (await mailbox.fetch('tiny:x@example.com/inbox', {
      manualAck: true,
    })) as AckableMailMessage

    const error = await taken.ack('answered').then(
      () => null,
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(UnsupportedCapabilityError)
    expect((error as UnsupportedCapabilityError).message).toContain(
      'disposition:answered'
    )
    expect(provider.supports.has(Capability.disposition('answered'))).toBe(
      false
    )
    expect(handle.ackCalls).toBe(0) // 没递给句柄
  })
})

describe('句柄结果：内核不替 provider 编答案', () => {
  it('按 v1.0.0 写的第三方句柄（只有 ack / nack(requeue)）照样能用', async () => {
    const { mailbox, handle, postAnother } = await tinyMailbox('v1')
    const address = 'tiny:x@example.com/inbox'

    const a = (await mailbox.fetch(address, {
      manualAck: true,
    })) as AckableMailMessage
    await expect(a.ack('unhandled')).resolves.toBeUndefined() // provider 不报告 ⇒ 内核不编一个 true
    expect(handle.nackCalls).toEqual([true]) // 路由回老词汇：unhandled → nack(true)

    await postAnother()
    const b = (await mailbox.fetch(address, {
      manualAck: true,
    })) as AckableMailMessage
    await expect(b.ack('discard')).resolves.toBeUndefined()
    expect(handle.nackCalls).toEqual([true, false]) // discard → nack(false)

    await postAnother()
    const c = (await mailbox.fetch(address, {
      manualAck: true,
    })) as AckableMailMessage
    await c.ack('handled')
    expect(handle.ackCalls).toBe(1)
  })

  it('句柄没有 nack 却要 unhandled / discard：报错，不降级成 ack（那等于把回队变成丢弃）', async () => {
    const { mailbox, handle } = await tinyMailbox('ack-only')
    const taken = (await mailbox.fetch('tiny:x@example.com/inbox', {
      manualAck: true,
    })) as AckableMailMessage

    await expect(taken.ack('unhandled')).rejects.toThrow(
      UnsupportedCapabilityError
    )
    await expect(taken.ack('discard')).rejects.toThrow(
      UnsupportedCapabilityError
    )
    expect(handle.ackCalls).toBe(0)
    await expect(taken.ack('handled')).resolves.toBeUndefined() // 报错没消耗这次处置
    expect(handle.ackCalls).toBe(1)
  })
})

describe('provider 侧钩子：_settle 是新入口，_ack / _nack 是兼容转发', () => {
  it('接了 `_settle` 的 provider 收到处置值，并声明 `settle` 能力', async () => {
    const provider = new SettleHookProvider()
    const message = hookMessage()

    await provider.settle(message, 'unhandled')
    await provider.settle(message, 'discard')
    await provider.settle(message, 'handled')

    expect(provider.settled).toEqual(['unhandled', 'discard', 'handled'])
    expect(provider.can(Capability.Settle)).toBe(true)
  })

  it('只写了 `_ack` / `_nack`（v1.0.0 写法）的 provider：处置照样到，语义等价', async () => {
    const provider = new LegacyHookProvider()
    const message = hookMessage()

    await provider.settle(message, 'handled')
    await provider.settle(message, 'unhandled')
    await provider.settle(message, 'discard')

    expect(provider.ackCalls).toBe(1)
    expect(provider.nackRequeues).toEqual([true, false]) // unhandled → requeue=true，discard → false
    expect(provider.can(Capability.Settle)).toBe(false) // 没接新钩子就不声明这个能力
  })

  it('provider 侧同样要声明自定义处置值：没声明就在递给钩子之前失败', async () => {
    const provider = new SettleHookProvider()
    const message = hookMessage()

    await expect(provider.settle(message, 'answered')).rejects.toThrow(
      UnsupportedCapabilityError
    )
    expect(provider.settled).toEqual([])

    provider.supports.add(Capability.disposition('answered'))
    await provider.settle(message, 'answered')
    expect(provider.settled).toEqual(['answered'])
  })
})

// --- 测试用的极简 provider -------------------------------------------------

interface TinyHandle {
  seen: Disposition[]
  ackCalls: number
  nackCalls: boolean[]
}

type TinyStyle = 'custom' | 'custom-undeclared' | 'v1' | 'ack-only'

/**
 * 「信箱就是一个数组」的 provider：用来看内核在句柄上到底做了什么，
 * 也用来扮演按 `v1.0.0` 写的第三方句柄（只有 `ack()` / `nack(requeue)`）。
 * 地址按 `href` 分箱——地址内部结构是 scheme 自己的事，内核不碰。
 */
class TinyProvider extends MailboxProvider {
  private readonly boxes: Map<string, MailMessage[]> = new Map()
  public readonly handle: TinyHandle = { seen: [], ackCalls: 0, nackCalls: [] }

  constructor(private readonly style: TinyStyle) {
    super('tiny')
    if (style === 'custom') {
      // 规矩：谁能处理某个处置值，谁就得声明它（包装 / AoP 同理）。
      this.supports.add(Capability.disposition('answered'))
    }
  }

  protected _subscribe(): any {}

  protected async _unsubscribe(): Promise<void> {}

  protected async _send(message: MailMessage): Promise<void> {
    const list = this.boxes.get(message.to.href) ?? []
    list.push(message)
    this.boxes.set(message.to.href, list)
  }

  public async subscribe(): Promise<Subscription> {
    return {
      id: 'tiny-sub',
      address: new URL('tiny:x@example.com/inbox'),
      status: 'active',
      unsubscribe: async () => {},
    }
  }

  protected async _fetch(
    address: URL,
    options?: { manualAck?: boolean }
  ): Promise<AckableMailMessage | null> {
    const list = this.boxes.get(address.href)
    const message = list?.shift()
    if (!message) return null
    if (!options?.manualAck) return message as AckableMailMessage

    const handle = this.handle
    const back = () => {
      const box = this.boxes.get(message.to.href) ?? []
      box.unshift(message)
      this.boxes.set(message.to.href, box)
    }

    if (this.style === 'ack-only') {
      // 故意缺 `nack`：第三方句柄只实现了 v1.0.0 的一半。
      return {
        ...message,
        ack: async () => {
          handle.ackCalls += 1
        },
      } as unknown as AckableMailMessage
    }

    if (this.style === 'v1') {
      // 按已发布的形状写：不报告处置结果。
      return {
        ...message,
        ack: async () => {
          handle.ackCalls += 1
        },
        nack: async (requeue = false) => {
          handle.nackCalls.push(requeue)
          if (requeue) back()
        },
      } as unknown as AckableMailMessage
    }

    // 新形状：句柄自己收处置值，并报告有没有生效。
    return {
      ...message,
      ack: async (where?: Disposition) => {
        if (handle.ackCalls > 0) return false
        handle.seen.push(where ?? 'handled')
        handle.ackCalls += 1
        return true
      },
      nack: async () => false,
    } as unknown as AckableMailMessage
  }
}

async function tinyMailbox(style: TinyStyle) {
  const provider = new TinyProvider(style)
  const mailbox = new Mailbox()
  mailbox.registerProvider(provider)
  await mailbox.start()
  const postAnother = () =>
    mailbox.post({
      from: 'tiny:a@example.com/u',
      to: 'tiny:x@example.com/inbox',
      body: 1,
    })
  await postAnother()
  return { provider, mailbox, handle: provider.handle, postAnother }
}

/** 钩子测试只要一封形状正确的信，不需要真的走发送边界。 */
function hookMessage(): MailMessage {
  return {
    id: 'hook-1',
    from: new URL('hook:a@example.com/u'),
    to: new URL('hook:x@example.com/inbox'),
    body: 1,
    headers: {},
    meta: {},
  }
}

/** 只为了观察 provider 侧钩子收到的处置值。 */
class SettleHookProvider extends MailboxProvider {
  public readonly settled: Disposition[] = []

  constructor() {
    super('hook')
  }

  protected async _send(): Promise<void> {}

  protected _subscribe(): any {}

  protected async _unsubscribe(): Promise<void> {}

  public async subscribe(): Promise<Subscription> {
    return {
      id: 'hook-sub',
      address: new URL('hook:x@example.com/inbox'),
      status: 'active',
      unsubscribe: async () => {},
    }
  }

  protected async _fetch(): Promise<AckableMailMessage | null> {
    return null
  }

  /** 把处置入口暴露给测试。 */
  public settle(
    message: MailMessage,
    where: Disposition
  ): Promise<boolean | void> {
    return this.settleDelivery(message, where)
  }

  protected override async _settle(
    _message: MailMessage,
    where: Disposition
  ): Promise<boolean> {
    this.settled.push(where)
    return true
  }
}

/** 只有 `v1.0.0` 那两个钩子的 provider：基类必须把处置转发过去。 */
class LegacyHookProvider extends MailboxProvider {
  public ackCalls = 0
  public nackRequeues: boolean[] = []

  constructor() {
    super('hook')
  }

  protected async _send(): Promise<void> {}

  protected _subscribe(): any {}

  protected async _unsubscribe(): Promise<void> {}

  public async subscribe(): Promise<Subscription> {
    return {
      id: 'hook-sub',
      address: new URL('hook:x@example.com/inbox'),
      status: 'active',
      unsubscribe: async () => {},
    }
  }

  protected async _fetch(): Promise<AckableMailMessage | null> {
    return null
  }

  public settle(
    message: MailMessage,
    where: Disposition
  ): Promise<boolean | void> {
    return this.settleDelivery(message, where)
  }

  protected override async _ack(): Promise<void> {
    this.ackCalls += 1
  }

  protected override async _nack(
    _message: MailMessage,
    requeue: boolean
  ): Promise<void> {
    this.nackRequeues.push(requeue)
  }
}
