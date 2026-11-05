/**
 * 自己产信的 provider（输入型 provider、反向 RPC 的回信）也跑不掉 I-3。
 *
 * **不变式 I-3**：每一封进入系统的信都带系统发的 `mbx-send-id`，在发送边界发一次；
 * 来源（`post()`、路由改写后再投、provider 自己造的信）都不能指定它，也不能保留自带的值。
 *
 * 为什么内核**不加** `produce()` / `emit()`：「谁产信、产什么样的信」是各协议自己的事
 * （`InputProvider` 在 `mailbox-input` 里，`mailbox-terminal` 继承它），基类替某种形状开口子
 * 等于把一种形状写成所有 provider 的形状。内核只做两件事：
 *
 * 1. 走边界的必然带号（`Mailbox#post()` / `MailboxProvider.send()`，见 `mailbox.send-id.test.ts`）；
 * 2. 绕过边界的**出声**，并把代价说清楚（`MailMessageQueue.enqueue` 的告警：记账退化成
 *    对象同一性——同一个对象算同一份，**重建的副本算新的一份**）。
 *
 * 这两条是这套契约里少见的「不抛错、只出声」的处置：抛会把 provider 内部的写法变成运行时
 * 崩溃；不吭声则让「按份记账」在某类 provider 上悄悄失效（结算门、回队去重、退订竞态三条
 * 路径都建立在份号上）。所以这里把警告内容与「只说一次」都钉住。
 */
import { describe, expect, it, vi } from 'vitest'
import { Mailbox } from './mailbox'
import { MemoryEventBus, MemoryProvider } from './providers/memory'
import { MBX_SEND_ID_HEADER } from './lib/delivery'

const REPLY_TO = 'mem://agent@pc/replies'
const HUMAN = 'input:human@pc/ui'

/**
 * 一个会自己产信的 provider。反向 RPC 的回信就是 provider 造的——它不来自任何 `post()`，
 * 所以它是 I-3 最容易漏的那条路径（`InputProvider` 现在就是这个形状）。
 */
class SelfProducer extends MemoryProvider {
  /** 裸接法：直接 `_send()` 一份没发号的信（越界，但不是非法语法）。 */
  public async produceRaw(body: unknown): Promise<void> {
    await this._send({
      id: this.generateId(),
      from: new URL(HUMAN),
      to: new URL(REPLY_TO),
      body,
    })
  }

  /** 正确接法一：在自己的入口边界发号——`generateId()` 就是系统给 provider 的发号器。 */
  public async produceMinted(body: unknown): Promise<void> {
    await this._send({
      id: this.generateId(),
      from: new URL(HUMAN),
      to: new URL(REPLY_TO),
      body,
      headers: { [MBX_SEND_ID_HEADER]: this.generateId() },
    })
  }

  /** 正确接法二：走 `send()`——它本来就是所有 provider 的 `_send()` 的唯一入口。 */
  public async produceViaBoundary(body: unknown): Promise<void> {
    await this.send({
      id: this.generateId(),
      from: new URL(HUMAN),
      to: new URL(REPLY_TO),
      body,
    })
  }
}

async function setup() {
  const provider = new SelfProducer(null, new MemoryEventBus())
  const mailbox = new Mailbox()
  mailbox.registerProvider(provider)
  await mailbox.start()
  return { provider, mailbox }
}

async function idsOf(mailbox: Mailbox): Promise<Record<string, unknown>[]> {
  return (await mailbox.fetch(REPLY_TO, { peek: true })).map((m) => m.headers ?? {})
}

describe('provider 自产的信同样受 I-3 约束', () => {
  it('[语义] 绕过发送边界：能投递、能取，但必须出声一次，并说清代价', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { provider, mailbox } = await setup()

    await provider.produceRaw({ approved: true })
    await provider.produceRaw({ approved: false })

    const headers = await idsOf(mailbox)
    expect(headers).toHaveLength(2)
    // 没有系统号：这份信的「份」只能靠对象身份认
    expect(headers.every((h) => h[MBX_SEND_ID_HEADER] === undefined)).toBe(true)

    const warned = warn.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('without a system-owned'))
    expect(warned).toHaveLength(1) // 每队列只说一次：刷屏会让真问题被忽略
    // 告警必须把降级说清楚：按对象同一性记账 + 怎么修
    expect(warned[0]).toContain('object identity')
    expect(warned[0]).toContain('generateId()')

    await mailbox.stop({ purge: true })
    warn.mockRestore()
  })

  it('[语义] 没发号的信跨轮跟不住：回队再取，依然没有份号', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { provider, mailbox } = await setup()

    await provider.produceRaw('要回队再取一次的那封')
    const handle = await mailbox.fetch(REPLY_TO, { manualAck: true })
    expect(handle).not.toBeNull()
    expect(await handle!.nack(true)).toBe(true) // 处置本身照常生效

    const after = (await idsOf(mailbox))[0]
    expect(after[MBX_SEND_ID_HEADER]).toBeUndefined()
    // 投递副本是 `{...message}` 造出来的：没有号，下一轮的副本就是一本新账
    await mailbox.stop({ purge: true })
    warn.mockRestore()
  })

  it('[规定] 在自己的入口发号：号跟完全程，告警不发', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { provider, mailbox } = await setup()

    await provider.produceMinted({ approved: true })

    const headers = await idsOf(mailbox)
    expect(headers[0][MBX_SEND_ID_HEADER]).toBeTypeOf('string')
    expect(warn.mock.calls.map((c) => c.join(' ')).some((m) => m.includes('without a system-owned'))).toBe(false)

    const minted = headers[0][MBX_SEND_ID_HEADER]
    const handle = await mailbox.fetch(REPLY_TO, { manualAck: true })
    await handle!.nack(true)
    expect((await idsOf(mailbox))[0][MBX_SEND_ID_HEADER]).toBe(minted) // 同一份 = 同一个号

    await mailbox.stop({ purge: true })
    warn.mockRestore()
  })

  it('[规定] 走 send() 边界同样带号（provider 不必自己拼 header）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { provider, mailbox } = await setup()

    await provider.produceViaBoundary({ approved: true })

    const headers = await idsOf(mailbox)
    expect(headers[0][MBX_SEND_ID_HEADER]).toBeTypeOf('string')
    expect(headers[0]['mbx-sent-at']).toBeTypeOf('string') // 边界同时注入发送时间
    expect(warn.mock.calls.map((c) => c.join(' ')).some((m) => m.includes('without a system-owned'))).toBe(false)

    await mailbox.stop({ purge: true })
    warn.mockRestore()
  })

  it('[语义] 自产的信不要求 `from` 是本 scheme 的地址（跨协议回信是正常路径）', async () => {
    const { provider, mailbox } = await setup()

    // `input:human@pc/ui` → `mem:...`：`mem:` 的语法只管自己的地址，别人的 `from` 不归它判
    await provider.produceMinted({ approved: true })
    expect(await idsOf(mailbox)).toHaveLength(1)

    await mailbox.stop({ purge: true })
  })
})
