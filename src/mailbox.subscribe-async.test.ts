/**
 * `subscribe()` 异步化（对齐 Python `core.py:115` / Rust `mailbox.rs:165`）—— 契约与竞态防线
 *
 * 本文件锁的不是「subscribe 返回 Promise」这一句签名，而是异步化之后**新出现**的那几条不变量：
 *
 *   1. `await` 完成才是「订阅可收投递」的时刻；`Subscription` 只在 await 之后交给调用方
 *      （不允许先同步返回对象、再在背后填 handle —— 那会把未生效的订阅当成已生效）。
 *   2. 地址校验**仍然是同步 throw**：异步化的只是 provider 那一段。`post` / `fetch` / `status`
 *      的地址一致性（I-4）不该因为这次改动变成 rejection。
 *   3. **迟到的 handle 必须被拆掉**：`_subscribe` 还在 await 里时来了一次 `unsubscribe()` /
 *      `stop()`，登记要先拆，handle 落地后立刻 `_unsubscribe`。漏掉这一步就是把监听器永久
 *      留在总线上（默认总线是进程级单例，跨 `Mailbox` 可见）。
 *   4. 拆除发生在 await 窗口内时，`subscribe()` 仍 resolve（拿到 `status: 'closed'`），
 *      不 reject、也不产生 unhandled rejection —— 退订不是错误。
 *   5. handle 还没落地时，**不许**拿 `undefined` 去调 `_unsubscribe`：broker 会把它当成
 *      一个非法句柄（而不是「还没建立」）。
 *   6. provider 钩子不强推 async：v1 写的**同步** `_subscribe` 子类不改也能跑。
 *   7. **关闭落在订阅建立的中途**（`close()` / provider 级 `stop()` 与在途 `subscribe()` 交错）：
 *      这条订阅必须作废——登记先拆、迟到的句柄补拆、句柄报 `closed`（issue#11）。
 *
 * 「provider 已经关闭之后再订」这一格**故意没有用例**：规范（`wiki/delivery-semantics.md` §1）
 * 把它标成不判，两端当前行为不一致且都没从契约推出。在这一格上钉任何一端都是把未收口的
 * 行为当契约（差异矩阵同样不收），要钉就得两端同时翻、由规范先定翻哪边。
 */

import { describe, it, expect, expectTypeOf, afterEach } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryProvider, MemoryEventBus } from './providers/memory'
import type { MailMessage, Subscription } from './interfaces'
import type { DeliveryResult } from './lib/delivery'
import { InvalidMailboxAddressError } from './error'
import { parseMailboxAddress } from './lib/utils'

const tick = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let seq = 0
const addrOf = (name: string): string => `mem://g${seq++}-${name}@gate/inbox`

/**
 * 可控的「broker 建订阅要来回一趟」provider：
 * - `defer`（默认）：`_subscribe` 返回 pending promise，测试调 `release()` / `failBroker()` 交付。
 * - `sync`：v1 风格——同步返回退订函数。
 * - `reject`：broker 拒绝订阅。
 */
class GateProvider extends MemoryProvider {
  public mode: 'defer' | 'sync' | 'reject' | 'throw' = 'defer'
  public subscribeCalls = 0
  /** `_unsubscribe` 实际收到的 handle，按调用顺序。 */
  public readonly unsubscribed: any[] = []
  private gate: { resolve: () => void; reject: (e: Error) => void } | null = null

  constructor() {
    super(undefined, new MemoryEventBus())
  }

  /** 内核订阅表规模（await 窗口里有没有「半截登记」就看它）。 */
  public get registered(): number {
    return this.subscriptions.size
  }

  /** `_subscribe` 是否还挂着没交付。 */
  public get waiting(): boolean {
    return this.gate !== null
  }

  /** provider 答话了：这时才真的在总线上挂监听器，把真 handle 交回基类。 */
  public release(): void {
    const gate = this.gate
    this.gate = null
    gate?.resolve()
  }

  /** broker 拒绝订阅。 */
  public failBroker(error = new Error('broker refused the SUBSCRIBE')): void {
    const gate = this.gate
    this.gate = null
    gate?.reject(error)
  }

  /** 这条地址上总线里还挂着几个监听器（拆干净了就该是 0）。 */
  public listenerCount(address: string | URL): number {
    return this.bus.getStatus(this.topicOf(parseMailboxAddress(address, 'test listenerCount()'))).subscriberCount
  }

  protected _subscribe(
    address: URL,
    onReceive: (message: MailMessage) => void | Promise<DeliveryResult | void>,
  ): any {
    this.subscribeCalls++
    if (this.mode === 'sync') {
      return super._subscribe(address, onReceive as any)
    }
    if (this.mode === 'reject') {
      return Promise.reject(new Error('broker refused the SUBSCRIBE'))
    }
    if (this.mode === 'throw') {
      // 老派 provider：建订阅失败是同步 throw（没有 await 点可谈）
      throw new Error('broker refused the SUBSCRIBE synchronously')
    }
    return new Promise<any>((resolve, reject) => {
      this.gate = {
        resolve: () => resolve(super._subscribe(address, onReceive as any)),
        reject,
      }
    })
  }

  protected async _unsubscribe(subscriptionId: string, unsubscribeHandle: any): Promise<void> {
    this.unsubscribed.push(unsubscribeHandle)
    await super._unsubscribe(subscriptionId, unsubscribeHandle)
  }
}

describe('契约：subscribe() 是 await 点（对齐 Python / Rust）', () => {
  it('[语义] subscribe() 返回 Promise，Subscription 只在 await 之后交给调用方', async () => {
    const provider = new GateProvider()
    provider.mode = 'sync' // 本例只测形状，不测 await 窗口
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('returns-promise')

    const pending: Promise<Subscription> = mailbox.subscribe(address, () => {})
    // 不是「同步的 Subscription 对象」：先返回对象再背后填 handle 的写法会把未生效当已生效
    expect((pending as unknown as Subscription).id).toBeUndefined()

    const sub = await pending
    expect(sub.id).toBeTruthy()
    expect(sub.address.toString()).toContain('returns-promise')
    expect(sub.status).toBe('active')

    await sub.unsubscribe()
    expect(sub.status).toBe('closed')
    await mailbox.stop()
  })

  it('[语义] await 完成即可收投递；退订后不再收', async () => {
    const provider = new GateProvider()
    provider.mode = 'sync'
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('delivers-after-await')
    const got: MailMessage[] = []

    const sub = await mailbox.subscribe(address, (m) => { got.push(m) })
    await mailbox.post({ from: 'mem://s@gate/u', to: address, body: { n: 1 } })
    await tick()
    expect(got).toHaveLength(1)

    await sub.unsubscribe()
    await mailbox.post({ from: 'mem://s@gate/u', to: address, body: { n: 2 } })
    await tick()
    expect(got).toHaveLength(1)
    expect((await mailbox.status(address)).unreadCount).toBe(1)
    await mailbox.stop()
  })

  it('[语义] 同步就能发现的错，仍然同步 throw（不把校验降级成 rejection）', () => {
    const mailbox = new Mailbox()
    mailbox.registerProvider(new MemoryProvider(undefined, new MemoryEventBus()))

    // 门面层：连 URL 都解析不了 / scheme 没注册
    expect(() => mailbox.subscribe('not a mailbox url', () => {})).toThrow(InvalidMailboxAddressError)
    expect(() => mailbox.subscribe('nosuch://a@gate/p', () => {})).toThrow()

    // provider 层：`mem:` 拒绝 query（它的折叠会丢掉 query）——这个判定在**同步**的
    // `_subscribe` 里，所以错误时机不能因为这次改动从 throw 漂成 reject（I-4）。
    expect(() => mailbox.subscribe('mem://a@gate/p?thread=1', () => {})).toThrow(InvalidMailboxAddressError)
  })

  it('[语义] 同步抛错的 _subscribe：错误仍同步出家门，且不留下登记', () => {
    const provider = new GateProvider()
    provider.mode = 'throw'
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)

    expect(() => mailbox.subscribe(addrOf('hook-sync-throw'), () => {})).toThrow(/synchronously/)
    expect(provider.registered).toBe(0)
  })

  it('[语义] 门面回调入参类型与 IMailboxProvider 契约一致（内核会 await 它：resolve=ACK，reject=nack）', () => {
    type OnReceive = Parameters<Mailbox['subscribe']>[1]
    // 收窄成 `=> void` 时这一行会红：类型上看不出「内核会等你的回调」
    expectTypeOf<ReturnType<OnReceive>>().toEqualTypeOf<void | Promise<void>>()
  })

  it('[语义] status 不再有内核给不出的 connecting；paused 留作 provider 扩展位', () => {
    // @ts-expect-error 'connecting' 已移除：await 完成就是那个等待点，没有中间态可报
    const connecting: Subscription['status'] = 'connecting'
    void connecting
    // paused 是**类型约定**，内核不实现 pause/resume，也不会在任何时刻产出它
    const paused: Subscription['status'] = 'paused'
    expect(paused).toBe('paused')
  })
})

describe('await 窗口的拆除：迟到的 handle 不许泄漏', () => {
  let unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    unhandled = []
  })

  it('[语义] 同步登记：_subscribe 还挂着时订阅表里就有这条记录（否则窗口内的退订看不见它）', async () => {
    const provider = new GateProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('registered-before-handle')

    const pending = mailbox.subscribe(address, () => {})
    expect(provider.waiting).toBe(true)
    expect(provider.registered).toBe(1) // 同步登记：否则 await 窗口里的退订看不见它
    expect(provider.listenerCount(address)).toBe(0) // 但 broker 还没回话，总线上确实没有监听器

    provider.release()
    const sub = await pending
    expect(sub.status).toBe('active')
    expect(provider.listenerCount(address)).toBe(1)
    await mailbox.stop()
  })

  it('[语义] handle 未落地时退订：不得拿 undefined 去调 _unsubscribe，且迟到 handle 被拆', async () => {
    process.on('unhandledRejection', onUnhandled)
    const provider = new GateProvider()
    provider.mode = 'sync' // 先把「正常拆」这条路跑通，下面再测竞态
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('late-handle-teardown')

    const pending = mailbox.subscribe(address, () => {})
    expect(provider.registered).toBe(1)

    const sub = await pending
    expect(provider.listenerCount(address)).toBe(1)
    await sub.unsubscribe()
    expect(provider.unsubscribed).toHaveLength(1)
    expect(typeof provider.unsubscribed[0]).toBe('function')
    expect(provider.listenerCount(address)).toBe(0)

    // 真正的竞态：退订发生在 handle 落地之前
    const provider2 = new GateProvider()
    const mailbox2 = new Mailbox()
    mailbox2.registerProvider(provider2)
    const addr2 = addrOf('late-handle-teardown-2')
    const pending2 = mailbox2.subscribe(addr2, () => {})

    // 通过内核 stop() 走退订路径：它不等 subscribe 完成，正好砸在 await 窗口里
    await tick(5)
    expect(provider2.registered).toBe(1)
    await mailbox2.stop()
    expect(provider2.unsubscribed).toEqual([]) // 不许拿 undefined 去拆
    expect(provider2.registered).toBe(0)

    provider2.release() // broker 迟到的回话
    await tick()
    expect(provider2.unsubscribed).toHaveLength(1)
    expect(typeof provider2.unsubscribed[0]).toBe('function')
    expect(provider2.listenerCount(addr2)).toBe(0)
    expect(provider2.registered).toBe(0)

    const late = await pending2
    expect(late.status).toBe('closed')
    expect(unhandled).toEqual([])
  }, 10_000)

  it('[语义] pending 期间 stop()：退订不卡死（不等一个永不落地的 handle）', async () => {
    const provider = new GateProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('close-never-settles')

    const pending = mailbox.subscribe(address, () => {})
    await tick(5)
    await mailbox.stop() // handle 永不落地：close 必须仍然有界
    expect(provider.waiting).toBe(true)
    provider.release() // 收尾，别让 gate 悬着
    const sub = await pending
    expect(sub.status).toBe('closed')
  }, 10_000)

  it('[语义] _subscribe 失败：subscribe() reject，订阅表不残留', async () => {
    const provider = new GateProvider()
    provider.mode = 'reject'
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('broker-refuses')

    await expect(mailbox.subscribe(address, () => {})).rejects.toThrow(/refused/)
    expect(provider.registered).toBe(0)
    expect(provider.listenerCount(address)).toBe(0)
    await mailbox.stop()
  })

  it('[语义] pending 中失败且调用方没 await：不产生 unhandled rejection', async () => {
    process.on('unhandledRejection', onUnhandled)
    const provider = new GateProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('reject-while-torn')

    const pending = mailbox.subscribe(address, () => {})
    await tick(5)
    await mailbox.stop() // 拆除先行
    provider.failBroker()
    await tick()

    const late = await pending
    expect(late.status).toBe('closed')
    expect(unhandled).toEqual([])
    expect(provider.registered).toBe(0)
  }, 10_000)
})

describe('provider 钩子：不强推 async（v1 的同步 _subscribe 仍可用）', () => {
  it('[语义] 同步 _subscribe 子类：await subscribe → 投递 → 用同步 handle 退订', async () => {
    class LegacyProvider extends GateProvider {}
    const provider = new LegacyProvider()
    provider.mode = 'sync' // _subscribe 同步返回退订函数，且没有返回 Promise
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('legacy-sync-hook')
    const got: MailMessage[] = []

    const sub = await mailbox.subscribe(address, (m) => { got.push(m) })
    expect(provider.subscribeCalls).toBe(1)
    expect(provider.listenerCount(address)).toBe(1)

    await mailbox.post({ from: 'mem://s@gate/u', to: address, body: { n: 1 } })
    await tick()
    expect(got).toHaveLength(1)

    await sub.unsubscribe()
    expect(provider.unsubscribed).toHaveLength(1)
    expect(typeof provider.unsubscribed[0]).toBe('function')
    expect(provider.listenerCount(address)).toBe(0)
    await mailbox.stop()
  })

})

describe('关闭落在订阅建立的中途：这条必须作废（issue#11）', () => {
  /*
   * 已判的规范（`wiki/delivery-semantics.md` §1）：`close()` / provider 级 `stop()` 与在途
   * `subscribe()` 交错时，这条订阅必须**作废**——登记先拆，迟到的句柄在 provider 答话那一刻
   * 补拆，句柄报 `closed` 而不是报错。
   *
   * 断言全部落在**总线侧**（`subscriberCount`）与 `_unsubscribe` 实际收到的 handle：
   * `subscriptions.size === 0` 看不见这条泄漏——它正是当前代码自己造出来的那个状态
   * （登记被 `close()` 末尾的 `clear()` 抹掉，监听器还挂在总线上，而默认总线是进程级单例）。
   */
  let unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    unhandled = []
  })

  it('[语义] 同步钩子：close 快照之后落地的订阅，句柄作废且监听器被拆掉', async () => {
    process.on('unhandledRejection', onUnhandled)
    const provider = new GateProvider()
    provider.mode = 'sync' // 就是 issue#11 那份复现的形状：plain Memory 钩子，无测试替身
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const addrA = addrOf('midclose-a')
    const addrB = addrOf('midclose-sync-b')

    await mailbox.subscribe(addrA, () => {}) // 先正常建立一条，让 close 的快照里有东西可拆

    const closing = mailbox.stop() // close 同步取快照：此刻表里只有 A
    const pendingB = mailbox.subscribe(addrB, () => {}) // 同一 tick 里又插进来一条
    const subB = await pendingB
    await closing

    expect(subB.status).toBe('closed') // 不能报 active：报 active 就是没人能拆它了
    expect(provider.registered).toBe(0)
    expect(provider.listenerCount(addrB)).toBe(0) // 总线侧：泄漏就在这条红
    expect(provider.unsubscribed).not.toContain(undefined) // 补拆拿到的是真 handle
    expect(unhandled).toEqual([])
  }, 10_000)

  it('[语义] 挂起的钩子：close 已在跑、handle 迟到 → 补拆，而不是挂到即将被 clear 的登记上', async () => {
    const provider = new GateProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const addrA = addrOf('midclose2-a')
    const addrB = addrOf('midclose2-b')
    provider.mode = 'sync'
    await mailbox.subscribe(addrA, () => {})
    provider.mode = 'defer'

    const closing = mailbox.stop()
    const pendingB = mailbox.subscribe(addrB, () => {})
    await tick(5) // B 还挂在 gate 上，close 已经走过去了
    expect(provider.listenerCount(addrB)).toBe(0)

    provider.release() // broker 迟到答话
    await closing
    const subB = await pendingB

    expect(subB.status).toBe('closed')
    expect(provider.registered).toBe(0)
    expect(provider.listenerCount(addrB)).toBe(0)
  }, 10_000)

  it('[语义] close 的快照本来是空的：窗口里落地的订阅同样作废', async () => {
    // 这一格不走 `clear()`（快照为空，那段整块跳过）：今天它会留下一条「在关闭进行中建立」
    // 却报 active 的订阅。规范已判：关闭落在建立过程中 ⇒ 作废。
    const provider = new GateProvider()
    provider.mode = 'sync'
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('midclose-empty')

    const closing = mailbox.stop()
    const pending = mailbox.subscribe(address, () => {})
    const sub = await pending
    await closing

    expect(sub.status).toBe('closed')
    expect(provider.registered).toBe(0)
    expect(provider.listenerCount(address)).toBe(0)
  }, 10_000)

  it('[语义] stop() → start() 不是单向门：重新开放后必须还能订上并且收得到投递', async () => {
    // 重写 `init()` 而**不调 super** 的 provider：`MemoryProvider.init()`（租约清扫定时器，
    // 默认路径直接 return）与下游 `FileProvider` 就是这个写法。把「复位关闭标志」挂在
    // `init()` 上的设计会在这一格红，而且症状是「新订阅自己拆掉自己，不报错」——
    // 比它修的那个泄漏更难发现。
    class ShadowInitProvider extends GateProvider {
      public initCalls = 0
      public async init(): Promise<void> {
        this.initCalls++ // 故意不调 super.init()
      }
    }
    const provider = new ShadowInitProvider()
    provider.mode = 'sync'
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    const address = addrOf('reopen-door')
    const got: MailMessage[] = []

    await mailbox.start()
    expect(provider.initCalls).toBe(1)
    await mailbox.stop()
    await mailbox.start()

    const sub = await mailbox.subscribe(address, (m) => { got.push(m) })
    expect(sub.status).toBe('active')
    expect(provider.listenerCount(address)).toBe(1)

    await mailbox.post({ from: 'mem://s@gate/u', to: address, body: { n: 1 } })
    await tick()
    expect(got).toHaveLength(1)

    await mailbox.stop()
    expect(provider.listenerCount(address)).toBe(0)
  }, 10_000)

  // 「已经关闭的 provider 上再订」那一格留空白：见文件头。上面三条只钉已判的那一半
  // （关闭**进行中**落地的订阅作废），不决定未收口的那一半。
})
