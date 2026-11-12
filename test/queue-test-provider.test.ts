/**
 * `QueueTestProvider` —— 队列层的测试基座，以及**它自己必须成立的前提**。
 *
 * 为什么单独守这条（拆包计划 §3）：`mailbox-queue` 出核后，那一仓要靠这个形状测「租约 / 按份去重 /
 * 停放 / 轮次计数 / barrier 结算」。要是基座悄悄靠 `MemoryProvider` / `MemoryEventBus` 撑着，那些
 * 测试测的就还是 `mem:` 总线——队列的回归面被顶替，而且顶替是无声的（全绿）。
 *
 * 命名标记：
 *   [规矩] 基座的依赖与实现路径。
 *   [覆盖层] 它得真的能撑起队列那一层的观测，否则「有基座」是空话。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { Mailbox } from '../src/mailbox'
import { MailboxProvider } from '../src/providers/MailboxProvider'
import { canonicalTopicOf, QueueTestProvider } from './support/queue-test-provider'

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const retriable = () => Object.assign(new Error('upstream down'), { isRetriable: true })

let seq = 0
const addrOf = (name: string): string => `q://t${seq++}-${name}@broker/inbox`

/** 剔注释（`//` 前缀不看 `:`，不切 `https://`），再把真 import 的模块路径抽出来。 */
const importSpecifiers = (source: string): string[] =>
  [
    ...source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
  ].map((match) => match[1])

describe('QueueTestProvider：基座自己的规矩', () => {
  const SUPPORT = 'test/support/queue-test-provider.ts'

  it('[规矩] 依赖只有「核心基类 + 自家队列」两条——不许靠 memory 撑着', () => {
    const specs = importSpecifiers(readFileSync(new URL(`../${SUPPORT}`, import.meta.url), 'utf8'))

    // 防空转的正向钩子：扫描确实看到了这两条
    expect(specs).toContain('../../src/lib/MessageQueue')
    expect(specs).toContain('../../src/providers/MailboxProvider')
    // 反向：一条 memory 引用都不许有（含 `providers/memory`、`MemoryEventBus`）
    expect(specs.filter((s) => /providers\/memory|MemoryEventBus/.test(s))).toEqual([])
  })

  it('[规矩] 实现路径只有继承这一条：它就是 MailboxProvider 的子类', () => {
    const provider = new QueueTestProvider()
    expect(provider).toBeInstanceOf(MailboxProvider)
    // 队列 / 传输型：一次投递 = broker 的一次 ack，不走广播投递那条路
    expect(provider.can('status')).toBe(false)
  })

  it('[规矩] topic 键规则是夹具自己的，不是内核寻址规则（D5）', () => {
    expect(canonicalTopicOf('q://alice@broker/inbox')).toBe('q://alice@broker/inbox')
    expect(canonicalTopicOf('q:alice@broker/inbox')).toBe('q://alice@broker/inbox')
  })
})

describe('QueueTestProvider：它得真的撑起队列那一层', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('[覆盖层] 租约在飞 → nack 回队头 → 再取得到同一份；ack 之后不再回来', async () => {
    const provider = new QueueTestProvider()
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()
    const address = addrOf('lease-roundtrip')
    const topic = canonicalTopicOf(address)

    // 没有订阅者 ⇒ `_send` 只入队不投递，所以队列里躺着的就是 `post()` 产出的那份**真消息**
    // （带系统发的 `mbx-send-id`）——比手搓字面量更贴近队列实际拿到的东西。
    const posted = await mailbox.post({ from: 'q://s@broker/u', to: address, body: 'A' })
    expect(provider.queue.peek(topic).map((m) => m.body)).toEqual(['A'])

    provider.queue.dequeue(topic, { manualAck: true, ackTimeout: 60_000 })
    const held = provider.queue.locate(posted.id).filter((c) => c.state === 'inFlight')
    expect(held).toHaveLength(1)
    expect(held[0].leaseId, '在飞必须带这一次交出的编号').toBeTruthy()

    expect(provider.queue.nack(held[0].key, true, held[0].leaseId)).toBe(true)
    expect(provider.queue.peek(topic).map((m) => m.body)).toEqual(['A'])

    const again = provider.queue.dequeue(topic, { manualAck: true, ackTimeout: 60_000 })!
    const settled = provider.queue.locate(posted.id).find((c) => c.state === 'inFlight')!
    expect(await again.ack()).toBe(true)
    expect(provider.queue.locate(posted.id)).toEqual([])
    expect(provider.queue.peek(topic)).toEqual([])
    // 迟到的旧句柄不得再动账
    expect(provider.queue.nack(settled.key, true, settled.leaseId)).toBe(false)

    await mailbox.stop({ purge: true })
  })

  it('[覆盖层] 同一 id 的两份各自结算：队列基座不许把它们并成一本账', async () => {
    const provider = new QueueTestProvider()
    const topic = canonicalTopicOf(addrOf('two-copies'))

    provider.queue.enqueue(topic, { id: 'same', body: 'c1', headers: { 'mbx-send-id': 's1' } } as any)
    provider.queue.enqueue(topic, { id: 'same', body: 'c2', headers: { 'mbx-send-id': 's2' } } as any)

    const h1 = provider.queue.dequeue(topic, { manualAck: true, ackTimeout: 60_000 })!
    provider.queue.dequeue(topic, { manualAck: true, ackTimeout: 60_000 })
    expect(provider.queue.getStatus(topic).inFlightCount).toBe(2)

    await h1.nack(true)
    expect(provider.queue.peek(topic).map((m) => m.body)).toEqual(['c1'])
    expect(provider.queue.getStatus(topic).inFlightCount).toBe(1)
  })

  it('[覆盖层] 投递侧的账看得见：重试趟数、`_nack` 的 requeue、回队后队列又有一份', async () => {
    const provider = new QueueTestProvider({ maxAttempts: 2, baseDelay: 1 })
    const mailbox = new Mailbox()
    mailbox.registerProvider(provider)
    await mailbox.start()
    const address = addrOf('attempt-ledger')
    const topic = canonicalTopicOf(address)

    await mailbox.subscribe(address, (message) => {
      provider.handedTo.push(message)
      throw retriable()
    })
    await mailbox.post({ from: 'q://s@broker/u', to: address, body: 'A' })
    await tick(200)

    expect(provider.handedTo).toHaveLength(2)
    expect(provider.handedTo.map((m) => m.headers?.['mbx-attempt'])).toEqual(['1', '2'])
    expect(provider.acked, '两次都失败 ⇒ 不该有隐式 ack').toHaveLength(0)
    expect(provider.nacked).toHaveLength(1)
    expect(provider.nacked[0].requeue, '可重试失败必须回队').toBe(true)
    expect(provider.queue.peek(topic).map((m) => m.body)).toEqual(['A'])

    await mailbox.stop({ purge: true })
  })
})
