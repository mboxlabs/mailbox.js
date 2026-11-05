/**
 * 第 3 步：让过期租约的回收**不依赖有人来取信**。
 *
 * 惰性扫描（只有下一次 manualAck 取信才扫）对正常轮询的消费者够用，但“最后一个消费者崩了”
 * 或“这个地址再没人 fetch”时，那份信就永远挂在 in-flight 里：`unreadCount` 0、
 * `inFlightCount` 1、`['mem.overdueInFlightCount']` 1，谁也救不了它。
 *
 * 两条出口，都不靠往默认路径里塞定时器：
 *   1. `mailbox.recover(address)`：显式、幂等、报出收回了几份。运维脚本 / 定时任务调它。
 *   2. `new MemoryProvider(retry, bus, { leaseSweepIntervalMs })`：opt-in 定时器，默认关，
 *      `unref()` 不拖住进程，`stop()` 拆掉。
 */

import { describe, expect, it } from 'vitest'
import { Mailbox } from './mailbox'
import { MailboxProvider } from './providers/MailboxProvider'
import { MemoryEventBus, MemoryProvider } from './providers/memory'
import { MailMessage, FetchOptions } from './interfaces'
import { DeliveryResult } from './lib/delivery'

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let seq = 0
const addrOf = (name: string) => `mem://p${seq++}-${name}@bus/inbox`

const setup = (provider?: MemoryProvider) => {
  const mailbox = new Mailbox()
  const p = provider ?? new MemoryProvider(null, new MemoryEventBus())
  mailbox.registerProvider(p)
  return { provider: p, mailbox }
}

/** 一个没有租约概念的 provider（推送型）：没有 `recoverLeases` 可调。 */
class LeaselessProvider extends MailboxProvider {
  constructor() {
    super('nl', null)
  }
  protected async _send(_message: MailMessage): Promise<void> {
    // 这个 provider 不排队：没有租约可回收（AMQP / SQS 这类 broker 的可见性超时在 broker 侧）
  }
  protected _subscribe(
    _address: URL,
    _onReceive: (message: MailMessage) => void | Promise<DeliveryResult | void>,
  ): any {
    return undefined
  }
  protected async _unsubscribe(_subscriptionId: string, _unsubscribeHandle: any): Promise<void> {}
  protected async _fetch(_address: URL, _options?: FetchOptions): Promise<MailMessage | null> {
    return null
  }
}

describe('显式回收：不靠有人来取信', () => {
  it('[语义] 没有轮询者时，recover(address) 把已到期的租约收回队列，并报出份数', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('recover-expired')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 }) // 取走后就没人管了
    await tick(80)

    expect(await mailbox.recover(address)).toEqual({ reclaimed: 1, supported: true })
    const back = await mailbox.fetch(address, { peek: true })
    expect(back.map((m) => m.body)).toEqual(['A']) // 收回队列，能被重新取走
    await mailbox.stop({ purge: true })
  })

  it('[语义] 未到期的租约不会被 recover 动', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('recover-live')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    await mailbox.fetch(address, { manualAck: true, ackTimeout: 60_000 })
    await tick(30)

    expect(await mailbox.recover(address)).toEqual({ reclaimed: 0, supported: true })
    expect((await mailbox.status(address)).inFlightCount).toBe(1) // 还在消费者手里
    await mailbox.stop({ purge: true })
  })

  it('[语义] 常驻租约（ackTimeout: 0）不会被 recover 抖下来', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('recover-never')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    await mailbox.fetch(address, { manualAck: true, ackTimeout: 0 })
    await tick(80)

    expect(await mailbox.recover(address)).toEqual({ reclaimed: 0, supported: true })
    expect((await mailbox.status(address)).inFlightCount).toBe(1)
    await mailbox.stop({ purge: true })
  })

  it('[语义] recover 是幂等的：连调两次，第二次没有东西可收', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('recover-twice')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
    await tick(80)

    expect((await mailbox.recover(address)).reclaimed).toBe(1)
    expect((await mailbox.recover(address)).reclaimed).toBe(0)
    expect((await mailbox.status(address)).unreadCount).toBe(1) // 第一次收回去的还在队列里
    await mailbox.stop({ purge: true })
  })

  it('[语义] recover 之后 overdue 归零，而那份信能被新消费者正常结算', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('recover-then-settle')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    const stale = await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
    await tick(80)
    expect((await mailbox.status(address))['mem.overdueInFlightCount']).toBe(1)

    await mailbox.recover(address)
    const status = await mailbox.status(address)
    expect(status['mem.overdueInFlightCount']).toBe(0)
    expect(status.unreadCount).toBe(1)

    const fresh = await mailbox.fetch(address, { manualAck: true, ackTimeout: 60_000 })
    expect(fresh?.body).toBe('A')
    await fresh!.ack()
    await stale!.ack() // 迟到的处置：不能碰新消费者手里那份
    expect((await mailbox.status(address)).inFlightCount).toBe(0)
    await mailbox.stop({ purge: true })
  })

  it('[语义] recover 只动这个地址：另一个地址的过期租约不受影响', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const a = addrOf('recover-a')
    const b = addrOf('recover-b')

    for (const address of [a, b]) {
      await mailbox.post({ from: 'mem://s@bus/u', to: address, body: address })
      await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
    }
    await tick(80)

    expect((await mailbox.recover(a)).reclaimed).toBe(1)
    expect((await mailbox.status(b)).inFlightCount).toBe(1) // b 那份仍挂在 b 的在飞里
    expect((await mailbox.status(b))['mem.overdueInFlightCount']).toBe(1)
    await mailbox.stop({ purge: true })
  })

  it('[语义] provider 没有租约可回收时：supported=false，不能拿 reclaimed=0 冒充「一切正常」', async () => {
    const { mailbox } = setup()
    mailbox.registerProvider(new LeaselessProvider())
    await mailbox.start()

    const result = await mailbox.recover('nl://someone@nl/inbox')
    expect(result.supported).toBe(false)
    expect(result.reclaimed).toBe(0)
    await mailbox.stop()
  })

  it('[语义] 不带地址：汇总所有可枚举地址，并给出逐个地址的份数', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const a = addrOf('recover-all-a')
    const b = addrOf('recover-all-b')

    await mailbox.post({ from: 'mem://s@bus/u', to: a, body: 'A' })
    await mailbox.post({ from: 'mem://s@bus/u', to: b, body: 'B' })
    await mailbox.fetch(a, { manualAck: true, ackTimeout: 20 }) // 会过期
    await mailbox.fetch(b, { manualAck: true, ackTimeout: 60_000 }) // 不会
    await tick(80)

    const all = await mailbox.recover()
    expect(all.supported).toBe(true)
    expect(all.reclaimed).toBe(1)
    expect(Object.values(all.byAddress ?? {}).sort()).toEqual([0, 1])
    await mailbox.stop({ purge: true })
  })
})

describe('opt-in 定时回收（默认关）', () => {
  it('[事实] 默认没有任何定时器：没人取信时，过期租约不会自己回队', async () => {
    const { mailbox } = setup()
    await mailbox.start()
    const address = addrOf('sweep-off')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
    await tick(120)

    const status = await mailbox.status(address)
    expect(status.unreadCount).toBe(0)
    expect(status['mem.overdueInFlightCount']).toBe(1) // 只能靠 recover() 或下一次取信
    await mailbox.stop({ purge: true })
  })

  it('[语义] leaseSweepIntervalMs：没有任何 fetch，过期租约也会自己回到队列', async () => {
    const { mailbox } = setup(new MemoryProvider(null, new MemoryEventBus(), { leaseSweepIntervalMs: 20 }))
    await mailbox.start()
    const address = addrOf('sweep-on')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    const taken = await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
    expect(taken).not.toBeNull()
    await tick(150) // 只有定时器在跑：全程没有第二次 fetch

    const status = await mailbox.status(address)
    expect(status.inFlightCount).toBe(0)
    expect(status.unreadCount).toBe(1)
    const back = await mailbox.fetch(address, { peek: true })
    expect(back.map((m) => m.body)).toEqual(['A'])
    await mailbox.stop({ purge: true })
  })

  it('[语义] stop() 必须拆掉定时器：之后不再自动回收', async () => {
    const provider = new MemoryProvider(null, new MemoryEventBus(), { leaseSweepIntervalMs: 20 })
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()
    const address = addrOf('sweep-stopped')

    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
    await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
    await mailbox.stop()
    await tick(120)

    const status = await mailbox.status(address)
    expect(status.unreadCount).toBe(0) // 定时器已拆：不会把这份扫回队头
    expect(status.inFlightCount).toBe(1)
  })

  it('[语义] 定时器不能拖住进程：句柄必须 unref（否则测试跑完还不退出）', async () => {
    const provider = new MemoryProvider(null, new MemoryEventBus(), { leaseSweepIntervalMs: 20 })
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()

    const handle = (provider as unknown as { leaseSweeper?: unknown }).leaseSweeper
    expect(handle).toBeTruthy()
    // Node 的 Timer 有 unref；调用过 unref 后 hasRef() 为 false（浏览器环境下没有这些方法，跳过）
    const timer = handle as { hasRef?: () => boolean }
    if (typeof timer.hasRef === 'function') {
      expect(timer.hasRef()).toBe(false)
    }
    await mailbox.stop({ purge: true })
  })

  it('[语义] leaseSweepIntervalMs 非法值等于关掉，不报错也不启动', async () => {
    for (const bad of [0, -1, Number.NaN]) {
      const provider = new MemoryProvider(null, new MemoryEventBus(), { leaseSweepIntervalMs: bad })
      const mailbox = new Mailbox()
      mailbox.registerProvider(provider)
      await mailbox.start()
      const address = addrOf(`sweep-bad-${bad}`)

      await mailbox.post({ from: 'mem://s@bus/u', to: address, body: 'A' })
      await mailbox.fetch(address, { manualAck: true, ackTimeout: 20 })
      await tick(120)
      expect((await mailbox.status(address)).unreadCount).toBe(0)
      await mailbox.stop({ purge: true })
    }
  })
})
