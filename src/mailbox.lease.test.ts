/**
 * 租约（`fetch({ manualAck: true })`）的到期归谁管，以及过期未收回时能不能看见。
 *
 * 两条不变量：
 *   [语义] 租约按**取走那一刻谈定的时长**判过期；别的消费者用什么 timeout 来取信，
 *          既不能提前接管一条没到期的租约，也不能压住一条早已到期的租约。
 *   [语义] 回收是惰性的（没有后台定时器），所以**过期但还没被收回**必须在 status 里
 *          看得见——否则它就是一笔谁也看不见的积压：`unreadCount` 0、`inFlightCount` 1，
 *          谁也不会盯着那个数字。
 */

import { describe, expect, it } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryEventBus, MemoryProvider } from './providers/memory'

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let seq = 0
const addrOf = (name: string) => `mem://p${seq++}-${name}@bus/inbox`

const setup = () => {
  const provider = new MemoryProvider(null, new MemoryEventBus())
  const mailbox = new Mailbox()
  mailbox.registerProvider(provider)
  return { provider, mailbox }
}

describe('租约自己记着到期时间（端到端）', () => {
  it('[语义] 早已到期的租约，会被下一个取信者收回，不管它自己传了多长的 timeout', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('short-lease')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A', id: 'A' })
    const a = await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
    expect(a?.body).toBe('A')
    await tick(60) // A 的 20ms 租约早就过了；A 崩了，句柄再没人碰

    const b = await mailbox.fetch(address, { manualAck: true, ackTimeout: 60_000 })
    expect(b?.body).toBe('A') // ← B 传 60s 不影响"A 到没到期"
    await mailbox.stop({ purge: true })
  })

  it('[语义] 未过期的租约不会被另一个消费者的短 timeout 提前接管', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('long-lease')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    const a = await mailbox.fetch(address, { manualAck: true, ackTimeout: 60_000 })
    expect(a?.body).toBe('A')

    await tick(200)
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'B' })
    const b = await mailbox.fetch(address, { manualAck: true, ackTimeout: 5 })
    expect(b?.body).toBe('B') // 只能拿到 B

    const status = await mailbox.status(address)
    expect(status.inFlightCount).toBe(2) // A 仍在 A 的租约里，没被扫回来重投
    await mailbox.stop({ purge: true })
  })

  it('[语义] 发送方/消费者写的 0 = 这份租约永不过期，别人的取信不能作废它', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('never-expires')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    const a = await mailbox.fetch(address, { manualAck: true, ackTimeout: 0 })
    expect(a?.body).toBe('A')
    await tick(60)

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'B' })
    const b = await mailbox.fetch(address, { manualAck: true, ackTimeout: 5 })
    expect(b?.body).toBe('B') // 不是 A：A 那份"常驻"必须真的常驻
    expect((await mailbox.status(address)).inFlightCount).toBe(2)

    await a!.ack() // 只有它自己的句柄能结束它
    expect((await mailbox.status(address)).inFlightCount).toBe(1)
    await mailbox.stop({ purge: true })
  })
})

describe('过期未收回的在飞必须可见（端到端）', () => {
  it('[语义] status 报出过期份数与最老过期时长', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('overdue-visible')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
    await tick(90)

    const status = await mailbox.status(address)
    expect(status.unreadCount).toBe(0) // 不在队列（回收惰性）
    expect(status.inFlightCount).toBe(1) // 挂在在飞
    expect(status['mem.overdueInFlightCount']).toBe(1) // ← 已过期，必须看得见
    expect(status['mem.oldestOverdueMs']).toBeGreaterThanOrEqual(60)
    await mailbox.stop({ purge: true })
  })

  it('[语义] 全量快照汇总过期份数（运维只盯一个数也能发现僵死消费者）', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const a = addrOf('snap-a')
    const b = addrOf('snap-b')

    await mailbox.post({ from: 'mem://s@bus/u', to: a, body: 'A' })
    await mailbox.post({ from: 'mem://s@bus/u', to: b, body: 'B' })
    await mailbox.fetch(a, { manualAck: true, ackTimeout: 20 }) // 会过期
    await mailbox.fetch(b, { manualAck: true, ackTimeout: 60_000 }) // 不会
    await tick(60)

    const snapshot = await mailbox.status()
    expect(snapshot.inFlightCount).toBe(2)
    // addresses 按地址串排序，两个地址的先后是确定的：snap-a（会过期）、snap-b（不会）。
    // 过期积压是 `mem:` 的账，放在扩展键里；快照不再代求这个和（内核不认识这些键）。
    expect(snapshot.addresses.map((entry) => (entry['mem.overdueInFlightCount'] as number) ?? 0)).toEqual([1, 0])
    await mailbox.stop({ purge: true })
  })

  it('[语义] status() 是只读的：反复查询不会顺手把过期租约收回队头', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('status-readonly')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
    await tick(60)

    const first = await mailbox.status(address)
    const again = await mailbox.status(address)
    expect(again['mem.overdueInFlightCount']).toBe(first['mem.overdueInFlightCount'])
    expect(again.unreadCount).toBe(0) // 没被"顺手"放回队列
    expect((await mailbox.fetch(address, { peek: true })).length).toBe(0)
    await mailbox.stop({ purge: true })
  })
})
