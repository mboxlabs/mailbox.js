/**
 * `TestProvider` —— 核心留下的那半个测试基座，以及**主张的边界**。
 *
 * 为什么要有它（拆包计划 §4）：Step 2 把 `MemoryProvider` 搬出核心之后，核心的测试不能再靠一个
 * 具体 provider 跑——那样「核心的回归面」其实还是 `mem:` 的回归面。`TestProvider` 只实现 L0
 * （投递交接语义），故意不实现租约到期 / 停放 / 死信 / 按份去重。
 *
 * 它是**对外导出**的（子路径 `@mboxlabs/mailbox/testing`）：第三方 provider 作者拿它验自己有没有
 * 踩满 L0。也正因为它对外，边界必须钉在这里——只写在文档里的边界会漂，而漂移不报错。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { Mailbox } from '../mailbox'
import type { MailMessage } from '../interfaces'
import { MailboxProvider } from '../providers/MailboxProvider'
import type { RetryPolicy } from '../lib/retry'
import { createTestProvider, TestProvider } from './index'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let caseNo = 0
/** 每个用例一个独立信箱地址：隔离靠地址，不靠 `clear()`（`clear()` 自己有单独的用例）。 */
const address = () => `test://bus/inbox-case-${++caseNo}`

const retriable = (what = 'boom') => Object.assign(new Error(what), { isRetriable: true })

/** 投递与结算 barrier 都不阻塞 `post()`，观察结果要等一拍。 */
async function until(probe: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await probe()) return
    await sleep(5)
  }
  throw new Error(`等不到：${what}`)
}

async function harness(options?: { retry?: RetryPolicy | null; protocol?: string }) {
  const provider = createTestProvider(options)
  const mailbox = new Mailbox()
  mailbox.registerProvider(provider)
  await mailbox.start()
  return { provider, mailbox }
}

/** 订阅一个必然抛错的消费者，返回「第 n 趟投递发生了」的闸门。 */
function consumer(failWith?: () => unknown) {
  const seen: MailMessage[] = []
  let arrived!: () => void
  const gate = new Promise<void>((resolve) => (arrived = resolve))
  const onReceive = (message: MailMessage) => {
    seen.push(message)
    arrived()
    if (failWith) {
      throw failWith()
    }
  }
  return { seen, gate, onReceive }
}

/** 剔注释（`//` 前缀不看 `:`，不切 `https://`），再把真 import 的模块路径抽出来。 */
const importSpecifiers = (source: string): string[] =>
  [
    ...source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
  ].map((match) => match[1])

describe('TestProvider：规矩（实现路径与依赖边界）', () => {
  it('[规矩] 实现路径只有继承这一条：它就是 MailboxProvider 的子类', () => {
    const provider = createTestProvider()
    expect(provider).toBeInstanceOf(TestProvider)
    expect(Object.getPrototypeOf(TestProvider.prototype)).toBe(MailboxProvider.prototype)
    expect(provider.protocol).toBe('test')
  })

  it('[规矩] L0 不靠队列实现撑：不 import MessageQueue / memory', () => {
    const source = readFileSync(new URL('./test-provider.ts', import.meta.url), 'utf8')
    const specifiers = importSpecifiers(source)
    // 正面钩子：扫描不是空转（它确实看到了基类）。
    expect(specifiers).toContain('../providers/MailboxProvider')
    expect(specifiers.filter((s) => /MessageQueue|memory/i.test(s))).toEqual([])
  })

  it('[规矩] 能力声明按实现来：只有 L0 那几个，没有租约 / 停放 / 死信', () => {
    const provider = createTestProvider()
    expect([...provider.supports].sort()).toEqual(['clear', 'listAddresses', 'peek', 'settle', 'status'])
    expect(provider.can('recoverLeases')).toBe(false)
    expect(provider.can('parked')).toBe(false)
    expect(provider.can('dead-letter')).toBe(false)
    expect(provider.can('disposition:answered')).toBe(false)
  })

  it('[规矩] 两个实例各管自己的账：换个协议就换一套状态，也不串台', async () => {
    const { mailbox } = await harness({ protocol: 'alpha' })
    const other = createTestProvider({ protocol: 'beta' })
    mailbox.registerProvider(other)
    const addr = `alpha://bus/inbox-${caseNo}`
    await mailbox.post({ from: 'alpha://bus/sender', to: addr, body: 'x' })
    expect((await mailbox.status(addr)).unreadCount).toBe(1)
    // 同一串尾巴在另一个协议下没有任何记录 ⇒ 答「不存在」，不谎报成「空闲」
    const elsewhere = await mailbox.status(`beta://bus/inbox-${caseNo}`)
    expect(elsewhere.exists).toBe(false)
    expect(elsewhere.state).toBe('unknown')
    expect(elsewhere.unreadCount).toBe(0)
  })
})

describe('TestProvider：L0 投递交接', () => {
  it('[L0] 订阅 + post：消息到消费者手上，`mbx-send-id` 由系统发', async () => {
    const { mailbox } = await harness()
    const addr = address()
    const c = consumer()
    const sub = await mailbox.subscribe(addr, c.onReceive)
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'hello' })
    await c.gate
    expect(c.seen).toHaveLength(1)
    expect(c.seen[0].body).toBe('hello')
    expect(c.seen[0].headers?.['mbx-send-id']).toBeTruthy()
    expect(c.seen[0].headers?.['mbx-attempt']).toBe('1')
    await sub.unsubscribe()
  })

  it('[L0] 发送边界剥掉来源自带的系统头：份号不能由调用方指定', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({
      from: 'test://bus/sender',
      to: addr,
      body: 'x',
      headers: { 'mbx-send-id': 'forged-copy-id', 'mbx-round': '7', 'mbx-attempt': '9' },
    })
    const got = await mailbox.fetch(addr)
    expect(got?.headers?.['mbx-send-id']).toBeTruthy()
    expect(got?.headers?.['mbx-send-id']).not.toBe('forged-copy-id')
    expect(got?.headers?.['mbx-round']).toBe('1') // 交出去就算一轮（与订阅侧 +1 同一套语义）
    expect(got?.headers?.['mbx-attempt']).toBeUndefined() // 尝试计数是投递级的事，不是取信级的
  })

  it('[L0] 没有订阅者时 post 入队，取走即出队（unreadCount 跟着降）', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'queued' })
    expect((await mailbox.status(addr)).unreadCount).toBe(1)
    const got = await mailbox.fetch(addr)
    expect(got?.body).toBe('queued')
    expect((await mailbox.status(addr)).unreadCount).toBe(0)
    expect(await mailbox.fetch(addr)).toBeNull()
  })

  it('[L0] manualAck：在飞单独分列，ack(handled) 之后这一份彻底消失', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'x' })
    const handle = await mailbox.fetch(addr, { manualAck: true })
    expect(handle).not.toBeNull()
    expect((await mailbox.status(addr)).inFlightCount).toBe(1)
    expect((await mailbox.status(addr)).unreadCount).toBe(0)
    expect(await handle!.ack('handled')).toBe(true)
    const st = await mailbox.status(addr)
    expect(st.inFlightCount).toBe(0)
    expect(st.unreadCount).toBe(0)
  })

  it('[L0] ack(unhandled) 把这一份放回**队头**；ack(discard) 不回队', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'A' })
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'B' })
    const a = await mailbox.fetch(addr, { manualAck: true }) // A
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'C' }) // 队列：B, C
    expect(await a!.ack('unhandled')).toBe(true)
    expect((await mailbox.status(addr)).unreadCount).toBe(3)
    expect((await mailbox.fetch(addr))?.body).toBe('A') // 退回的那一份排在最前
    const b = await mailbox.fetch(addr, { manualAck: true }) // B
    expect(await b!.ack('discard')).toBe(true)
    const st = await mailbox.status(addr)
    expect(st.unreadCount).toBe(1) // 只剩 C
    expect(st.inFlightCount).toBe(0)
  })

  it('[L0] 一次取信 = 一次处置：重复处置返回 false，而且不动队列', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'x' })
    const handle = await mailbox.fetch(addr, { manualAck: true })
    expect(await handle!.ack('handled')).toBe(true)
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'another' })
    expect(await handle!.ack('unhandled')).toBe(false) // 迟到的第二次处置：不生效
    expect((await mailbox.status(addr)).unreadCount).toBe(1) // 队列没被动过
    expect((await mailbox.status(addr)).inFlightCount).toBe(0)
  })

  it('[L0] 迟到的旧句柄不影响这一份的新句柄', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'x' })
    const first = await mailbox.fetch(addr, { manualAck: true })
    expect(await first!.ack('unhandled')).toBe(true) // 回队
    const second = await mailbox.fetch(addr, { manualAck: true })
    expect(await first!.ack('handled')).toBe(false) // 旧句柄不生效
    expect((await mailbox.status(addr)).inFlightCount).toBe(1) // 也没把新那份的在飞抹掉
    expect(await second!.ack('handled')).toBe(true)
    expect((await mailbox.status(addr)).inFlightCount).toBe(0)
  })

  it('[L0] peek 是只读的：不出队、不建在飞、也不把副本改回原件', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'original' })
    const peeked = await mailbox.fetch(addr, { peek: true })
    expect(peeked).toHaveLength(1)
    expect(peeked[0].body).toBe('original')
    const st = await mailbox.status(addr)
    expect(st.unreadCount).toBe(1)
    expect(st.inFlightCount).toBe(0)
    peeked[0].body = 'tampered'
    expect((await mailbox.fetch(addr))?.body).toBe('original')
  })

  it('[L0] 广播：每个订阅者各投递一次；全失败才回队，有人成功就不回队', async () => {
    const { mailbox } = await harness()
    const addr = address()
    const failing = consumer(() => retriable())
    const s1 = await mailbox.subscribe(addr, failing.onReceive)
    const s2 = await mailbox.subscribe(addr, failing.onReceive)
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'x' })
    await until(() => failing.seen.length >= 2, '两个订阅者各收到一次')
    await until(async () => (await mailbox.status(addr)).unreadCount === 1, '全部失败 ⇒ 这一份回队，可被 fetch 兜底')
    expect((await mailbox.status(addr)).inFlightCount).toBe(0)
    expect((await mailbox.fetch(addr))?.body).toBe('x')

    const ok = consumer()
    const s3 = await mailbox.subscribe(addr, ok.onReceive)
    const alsoFailing = consumer(() => retriable())
    const s4 = await mailbox.subscribe(addr, alsoFailing.onReceive)
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'y' })
    await until(() => alsoFailing.seen.length >= 1, '失败的那路投递发生了')
    await until(() => ok.seen.length >= 1, '成功的那路投递发生了')
    expect((await mailbox.status(addr)).unreadCount).toBe(0) // 有人成功 = 不回队（否则副作用再执行一次）
    await s1.unsubscribe()
    await s2.unsubscribe()
    await s3.unsubscribe()
    await s4.unsubscribe()
  })

  it('[L0] 份号才是身份：同一个 id 的两份信各自独立结算', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ id: 'same-id', from: 'test://bus/sender', to: addr, body: 'A' })
    await mailbox.post({ id: 'same-id', from: 'test://bus/sender', to: addr, body: 'B' })
    expect((await mailbox.status(addr)).unreadCount).toBe(2)
    const a = await mailbox.fetch(addr, { manualAck: true })
    const b = await mailbox.fetch(addr, { manualAck: true })
    expect(a?.body).toBe('A')
    expect(b?.body).toBe('B')
    expect(await a!.ack('unhandled')).toBe(true) // 只退回 A 这一份
    expect((await mailbox.status(addr)).unreadCount).toBe(1)
    expect(await b!.ack('discard')).toBe(true) // B 不回队
    expect((await mailbox.status(addr)).unreadCount).toBe(1)
    expect((await mailbox.fetch(addr))?.body).toBe('A')
  })

  it('[L0] clear() 清掉积压：测试隔离可以靠它，不必换新地址', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'A' })
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'B' })
    await mailbox.clear()
    const st = await mailbox.status(addr)
    expect(st.unreadCount).toBe(0)
    expect(st.inFlightCount).toBe(0)
  })

  it('[规矩] `close()` 不吞积压：丢消息那一刀是 `clear()` / `stop({ purge: true })`', async () => {
    // 内核写死的分工（`mailbox.ts:97`）：`stop()` 只拆订阅，带 `purge` 才叫 `clear()`。
    // 基类的 `_close()` 默认不动消息，因为「拆连接」不等于「删数据」：真 broker 上重连
    // 之后积压还在。`TestProvider` 是第三方作者的参照实现，它要是把 `_close()` 写成清空，
    // 就是在教错的东西，而 `stop()` → `start()` 的测试写法会静默少一批消息。
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'survive' })
    await mailbox.stop()
    await mailbox.start()
    expect((await mailbox.fetch(addr))?.body).toBe('survive')
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'dropped' })
    await mailbox.stop({ purge: true })
    await mailbox.start()
    expect(await mailbox.fetch(addr)).toBeNull()
  })
})

describe('TestProvider：status 里的三种「没有」', () => {
  /**
   * 定稿的规则：**不答 = 键缺席；答「没有」= 显式 `null` / `false`**。
   *
   * 为什么钉在参照实现身上：`./testing` 是第三方作者拄的那一个，它怎么写就会被怎么拄。
   * 参考实现 `mem:` 已经按这条答（`memory.ts:403` 的 `?? null`，另见
   * `mailbox.status-diagnostics.test.ts`），参照实现不能教另一种。
   */
  it('① 地址不存在：答过这句话 ⇒ exists false，且「没有活动」是 null 不是键消失', async () => {
    const { mailbox } = await harness()
    const st = await mailbox.status(address())

    expect(st.state).toBe('unknown')
    expect(st.exists).toBe(false)
    expect(st.lastActivityTime).toBeNull()
    // `undefined` 过 `JSON.stringify` 会整键消失，诊断页拿到的是 undefined而非「没有活动」
    const wire = JSON.parse(JSON.stringify(st))
    expect('lastActivityTime' in wire, 'JSON 往返后这个键必须还在').toBe(true)
  })

  it('② 订阅本身就算活动：exists true、lastActivityTime 是时间（与 `mem:` 同一笔）', async () => {
    const { mailbox } = await harness()
    const addr = address()
    const sub = await mailbox.subscribe(addr, () => {})

    const idle = await mailbox.status(addr)
    expect(idle.exists).toBe(true)
    expect(idle.state).toBe('online')
    // 「认得但完全没活动」这个态两边都到不了（建队 / 订阅 / 收发都会刷时间），
    // 所以 `null` 只从 ① 那一支出——但类型上它仍必须是 `string | null`。
    expect(idle.lastActivityTime).toBeTypeOf('string')

    await mailbox.post({ from: addr, to: addr, body: 'A' })
    const busy = await mailbox.status(addr)
    expect(busy.lastActivityTime).toBeTypeOf('string')

    await sub.unsubscribe()
  })
})

describe('TestProvider：主张的边界（这些不归 L0）', () => {
  it('[边界] 没有租约到期：ackTimeout 到期不重投，那份一直在飞', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'x' })
    await mailbox.fetch(addr, { manualAck: true, ackTimeout: 10 })
    await sleep(60)
    expect((await mailbox.status(addr)).inFlightCount).toBe(1)
    expect(await mailbox.fetch(addr)).toBeNull() // 不会被重投给下一个消费者
  })

  it('[边界] 没有停放 / 死信：discard 就是零痕迹，状态里也只有核心具名字段', async () => {
    const { mailbox } = await harness()
    const addr = address()
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'x' })
    const handle = await mailbox.fetch(addr, { manualAck: true })
    await handle!.ack('discard')
    const st = await mailbox.status(addr)
    expect(st.unreadCount).toBe(0)
    expect(st.inFlightCount).toBe(0)
    // 策略专属观测量属于 provider（D7）：`mem.parkedCount` 这类扩展键在这里不存在
    expect(Object.keys(st).filter((key) => key.includes('.'))).toEqual([])
  })

  it('[边界] 诊断面按声明答：没有租约可回收时不谎报成「都回收了」', async () => {
    const { mailbox } = await harness()
    const addr = address()
    const one = await mailbox.recover(addr)
    expect(one.supported).toBe(false)
    expect(one.reclaimed).toBe(0)
    const all = await mailbox.recover()
    expect(all.unreachableProviders).toContain('test')
  })

  it('[边界] 只保证投递级重试的记账，不保证重试上限的终态：耗尽之后仍回队', async () => {
    const { mailbox } = await harness({ retry: { maxAttempts: 1, baseDelay: 1 } })
    const addr = address()
    const failing = consumer(() => retriable())
    const sub = await mailbox.subscribe(addr, failing.onReceive)
    await mailbox.post({ from: 'test://bus/sender', to: addr, body: 'x' })
    await until(() => failing.seen.length >= 1, '第一次投递发生了')
    await until(async () => (await mailbox.status(addr)).unreadCount === 1, '预算耗尽后这一份回队，不是消失')
    expect(failing.seen.length).toBeLessThanOrEqual(2) // maxAttempts=1 ⇒ 不无限重投
    await sub.unsubscribe()
  })
})
