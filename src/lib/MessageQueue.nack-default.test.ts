import { describe, expect, it, vi, afterEach } from 'vitest'
import { Mailbox } from '../mailbox'
import { MemoryProvider } from '../providers/memory'
import { MailMessageQueue } from './MessageQueue'

/**
 * 「无参 `nack()`」这一族的告警。
 *
 * 队列层今天有两个默认值都是「丢弃」的 `nack`：
 *   - 直接调用：`nack(key, requeue, leaseId?)` —— `requeue` 省略时按 falsy 处理，等于 `ack(key)`；
 *   - 取信句柄：`dequeue({ manualAck: true })` 给的 `nack(requeue = false)`。
 *
 * 3.0.0 要把布尔拿掉：`ack(key)` = 结束这份拷贝，`nack(key)` = 把这份拷贝退回它自己那条队列。
 * 于是**省略参数的那一批调用会静默从「丢弃」翻成「退回」**——带参数的调用会在类型层被挡住，
 * 无参调用挡不住（编译照过，语义换了）。所以 2.x 先警告一次，把翻转挑明，行为一律不动。
 *
 * 注意消费者句柄（`MemoryProvider` 的 `wrapConsumerSettlement`）那一面**故意不警告**：
 * 它的 `nack(requeue?)` 命运是整体消失（已声明在 3.0.0 删除），调用会变成「方法不存在」/编译错误，
 * 本来就响亮，不需要再加一条噪音。这条不对称由最后一个用例钉住。
 */

type M = { id: string; body: string }
const msg = (id: string): M => ({ id, body: id })

type Handle = M & { ack(): Promise<boolean>; nack(requeue?: boolean): Promise<boolean> }
const grab = (q: MailMessageQueue<M>, topic: string): Handle | null =>
  q.dequeue(topic, { manualAck: true }) as unknown as Handle | null

let warn: ReturnType<typeof vi.spyOn>
afterEach(() => {
  warn?.mockRestore()
})
const watchWarn = () => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  return warn
}
/** 只看「无参 nack」那条告警，别把无关告警算进来。 */
const nackWarns = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter(([text]) => typeof text === 'string' && /nack\(\)/.test(text))

describe('无参 nack() 的告警（3.0.0 会把它从「丢弃」翻成「退回」）', () => {
  it('[语义] 警告不改行为：无参 nack() 今天仍是丢弃，不会退回队列', async () => {
    const q = new MailMessageQueue<M>()
    const topic = 'nack-default-discard'
    q.enqueue(topic, msg('A'))
    q.enqueue(topic, msg('B'))

    const handle = grab(q, topic)!
    expect(await handle.nack()).toBe(true)

    const status = q.getStatus(topic)
    expect(status.unreadCount).toBe(1) // B 还在，A 没被放回去
    expect(status.inFlightCount).toBe(0) // 这一份已经结算掉了
    expect(q.peek(topic, 10).map((m) => m.id)).toEqual(['B'])
  })

  it('[告警] 句柄无参 nack() 警告一次，说清 3.0.0 的翻转和该怎么写', async () => {
    const spy = watchWarn()
    const q = new MailMessageQueue<M>()
    q.enqueue('nack-default-warn', msg('A'))
    await grab(q, 'nack-default-warn')!.nack()

    const hits = nackWarns(spy)
    expect(hits).toHaveLength(1)
    const text = String(hits[0][0])
    expect(text).toMatch(/3\.0\.0/) // 说清什么时候翻
    expect(text).toMatch(/ack\(\)/) // 说清要丢弃就写 ack()
    expect(text).toMatch(/requeue/) // 说清真要退回就带上 flag
  })

  it('[告警] 同一个队列实例只警告一次（跨句柄、跨直接调用都不重复）', async () => {
    const spy = watchWarn()
    const q = new MailMessageQueue<M>()
    const topic = 'nack-default-once'
    q.enqueue(topic, msg('A'))
    q.enqueue(topic, msg('B'))
    q.enqueue(topic, msg('C'))

    await grab(q, topic)!.nack() // 句柄路径：第一次，警告
    await grab(q, topic)!.nack() // 句柄路径：不再警告
    const third = grab(q, topic)!
    expect(await third.ack()).toBe(true) // ack 不属于这一族：不该警告

    expect(nackWarns(spy)).toHaveLength(1)
  })

  it('[告警] 直接调用省略 requeue（JS 调用方写法）也警告，行为仍是丢弃', () => {
    const spy = watchWarn()
    const q = new MailMessageQueue<M>()
    const topic = 'nack-default-raw'
    q.enqueue(topic, msg('A'))
    q.enqueue(topic, msg('B'))
    grab(q, topic) // A 在飞
    const key = q.locate('A')[0].key

    // 类型上 `requeue` 是必填的；这里模拟的是 JS 调用方 / `as any` 场景——恰恰是编译挡不住的那一批。
    expect((q as unknown as { nack(key: string): boolean }).nack(key)).toBe(true)

    expect(nackWarns(spy)).toHaveLength(1)
    expect(q.getStatus(topic).unreadCount).toBe(1) // 没退回：还在飞的 A 消失了，B 还在
    expect(q.peek(topic, 10).map((m) => m.id)).toEqual(['B'])
  })

  it('[告警] 显式带 requeue 的写法一律不警告，行为照旧', async () => {
    const spy = watchWarn()
    const q = new MailMessageQueue<M>()
    const topic = 'nack-default-explicit'
    q.enqueue(topic, msg('A'))
    q.enqueue(topic, msg('B'))

    await grab(q, topic)!.nack(true) // 退回
    expect(q.getStatus(topic).unreadCount).toBe(2)

    await grab(q, topic)!.nack(false) // 丢弃
    expect(q.getStatus(topic).unreadCount).toBe(1)

    const handle = grab(q, topic)!
    expect(await handle.ack()).toBe(true) // ack 也不该警告

    expect(nackWarns(spy)).toHaveLength(0)
  })

  it('[边界] 消费者句柄的无参 nack() 不额外警告——它的 3.0.0 命运是消失，本来就响亮', async () => {
    const spy = watchWarn()
    const mailbox = new Mailbox()
    mailbox.registerProvider(new MemoryProvider())
    await mailbox.start()
    const address = 'mem://test/nack-consumer-no-warn/inbox'

    await mailbox.post({ from: 'mem://a', to: address, body: 'x' })
    const handle = (await mailbox.fetch(address, {
      manualAck: true,
    })) as unknown as { nack(requeue?: boolean): Promise<boolean> }

    expect(await handle.nack()).toBe(true) // 默认丢弃，行为不动
    expect(nackWarns(spy)).toHaveLength(0) // 不警告：删除会让它变成编译错误 / 方法不存在
  })
})
