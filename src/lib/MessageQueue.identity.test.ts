/**
 * F7 根因固化：队列记账的键必须是「哪一份信」，不能是「叫什么名字」
 *
 * `id` 是发送方给的标签，可以重复（`interfaces.OutgoingMail.id` 还建议用内容 hash）。
 * 一旦队列拿 `id` 当状态键，就会把两份不同的信当成一份：回队被当成重复而吞掉、
 * in-flight 槽位被覆盖、按 id 的结算能落到别人手里那份上。换个地址、换个发送方就能触发。
 *
 * 固化的不变量：
 *   [语义] 每份信一本账：同 id 的两份信各自独立排队、各自在飞、各自结算。
 *   [语义] 同一份信重复回队仍只留一份（系统发的 `mbx-send-id` 认这份）。
 *   [语义] 队列自带 handle 的 ack/nack 只作用于自己取走的那一份。
 *   [语义] 地址之间不串扰：A 地址上的在飞记录不该影响 B 地址上的回队。
 */

import { describe, expect, it, vi } from 'vitest'
import { MailMessageQueue } from './MessageQueue'

type TestMessage = { id: string; body: string; headers?: Record<string, any> }

/** 系统发的「这一份信」编号；发送方伪造的那一份在 `post()` 处已被剥掉。 */
const SEND_ID = 'mbx-send-id'

let topicSeq = 0
const topic = (name: string) => `q-${name}-${topicSeq++}`

describe('每份信一本账（同 id 不得互相顶替）', () => {
  it('[语义] 同 id 的两份信可以同时在飞：inFlightCount = 2', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('two-in-flight')
    q.enqueue(t, { id: 'same', body: 'copy-1', headers: { [SEND_ID]: '1' } })
    q.enqueue(t, { id: 'same', body: 'copy-2', headers: { [SEND_ID]: '2' } })

    const h1 = q.dequeue(t, { manualAck: true, ackTimeout: 60_000 })
    const h2 = q.dequeue(t, { manualAck: true, ackTimeout: 60_000 })

    expect(h1?.body).toBe('copy-1')
    expect(h2?.body).toBe('copy-2')
    expect(q.getStatus(t).inFlightCount).toBe(2) // 覆盖式 Map 只会剩下 1
  })

  it('[语义] 两份各自结算各的：nack(true) 放回的是自己那份，另一份仍在飞', async () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('settle-own-copy')
    q.enqueue(t, { id: 'same', body: 'copy-1', headers: { [SEND_ID]: '1' } })
    q.enqueue(t, { id: 'same', body: 'copy-2', headers: { [SEND_ID]: '2' } })
    const h1 = q.dequeue(t, { manualAck: true, ackTimeout: 60_000 })!
    q.dequeue(t, { manualAck: true, ackTimeout: 60_000 })

    expect(await h1.nack(true)).toBe(true)
    expect(q.peek(t).map((m) => m.body)).toEqual(['copy-1'])
    expect(q.getStatus(t).inFlightCount).toBe(1) // 还挂着 copy-2，没被顶替掉
  })

  it('[语义] 回队不会被「同 id 正在别人手里」吞掉', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('requeue-while-other-in-flight')
    q.enqueue(t, { id: 'same', body: 'held', headers: { [SEND_ID]: '1' } })
    q.dequeue(t, { manualAck: true, ackTimeout: 60_000 }) // 'same' 正在飞

    const requeued = q.requeue(t, { id: 'same', body: 'push-side', headers: { [SEND_ID]: '2' } })

    expect(requeued).toBe(true)
    expect(q.peek(t).map((m) => m.body)).toEqual(['push-side'])
    expect(q.getStatus(t).inFlightCount).toBe(1)
  })

  it('[语义] 跨地址不串扰：A 上的在飞记录不影响 B 上的回队', () => {
    const q = new MailMessageQueue<TestMessage>()
    const a = topic('address-a')
    const b = topic('address-b')
    q.enqueue(a, { id: 'same', body: 'held-by-A', headers: { [SEND_ID]: '1' } })
    q.dequeue(a, { manualAck: true, ackTimeout: 60_000 }) // A 上 'same' 在飞

    expect(q.requeue(b, { id: 'same', body: 'B-copy', headers: { [SEND_ID]: '2' } })).toBe(true)

    expect(q.peek(b).map((m) => m.body)).toEqual(['B-copy'])
    expect(q.getStatus(a).inFlightCount).toBe(1)
    expect(q.getStatus(b).inFlightCount).toBe(0)
  })
})

describe('同一份信重复回队仍然只留一份', () => {
  it('[语义] 同一 mbx-send-id 回队两次 → 队列里只有一份', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('same-send-dedup')
    // 模拟缺 barrier 的广播 provider：同一次 post 的两个订阅者各失败一次，各回队一次。
    q.requeue(t, { id: 'dup', body: 'x', headers: { [SEND_ID]: '42' } })
    q.requeue(t, { id: 'dup', body: 'x', headers: { [SEND_ID]: '42' } })

    expect(q.getStatus(t).unreadCount).toBe(1)
  })

  it('[语义] 同一份信已在飞时，它的副本不会被再插一份', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('same-send-in-flight')
    q.enqueue(t, { id: 'dup', body: 'x', headers: { [SEND_ID]: '42' } })
    q.dequeue(t, { manualAck: true, ackTimeout: 60_000 })

    // 同一份信（同 mbx-send-id）的回队企图 = 重复投递，抑制掉。
    expect(q.requeue(t, { id: 'dup', body: 'x', headers: { [SEND_ID]: '42' } })).toBe(false)
    expect(q.getStatus(t).inFlightCount).toBe(1)
  })

  it('[事实] 没有 mbx-send-id 时退回按对象身份认这份（队列单独使用的场景）', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('no-send-seq')
    const one: TestMessage = { id: 'dup', body: 'x' }
    q.requeue(t, one)
    q.requeue(t, one)
    expect(q.getStatus(t).unreadCount).toBe(1)

    // 同 id 的另一份对象（另一封信）不受影响。
    expect(q.requeue(t, { id: 'dup', body: 'y' })).toBe(true)
    expect(q.peek(t).map((m) => m.body)).toEqual(['y', 'x'])
  })
})

describe('结算只认系统发的份号：发送方的名字只能用来查，不能用来动手', () => {
  const twoInFlight = (name: string) => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic(name)
    q.enqueue(t, { id: 'same', body: 'copy-1', headers: { [SEND_ID]: 's-1' } })
    q.enqueue(t, { id: 'same', body: 'copy-2', headers: { [SEND_ID]: 's-2' } })
    q.dequeue(t, { manualAck: true, ackTimeout: 60_000 })
    q.dequeue(t, { manualAck: true, ackTimeout: 60_000 })
    return { q, t }
  }

  it('[回归] 拿发送方的 id 当键结算：谁都不动，报 false', () => {
    const { q, t } = twoInFlight('sender-name-door')

    // 旧写法（凭发送方的名字就地结算）：不能再默默命中其中某一份
    expect(q.ack('same')).toBe(false)
    expect(q.nack('same', false)).toBe(false)
    expect(q.getStatus(t).inFlightCount).toBe(2)
  })

  it('[语义] locate(名字) 只读地给出候选；按 key 动手只动那一份', () => {
    const { q, t } = twoInFlight('locate-then-settle')

    const found = q.locate('same')
    expect(found).toHaveLength(2)
    expect(new Set(found.map((f) => f.key)).size).toBe(2)
    expect(found.every((f) => f.state === 'inFlight' && f.topic === t)).toBe(true)
    // 只读：查一下不改变任何状态
    expect(q.getStatus(t).inFlightCount).toBe(2)
    expect(q.getStatus(t).unreadCount).toBe(0)

    const target = found.find((f) => f.sendId === 's-1')!
    expect(q.nack(target.key, true)).toBe(true)
    expect(q.getStatus(t).inFlightCount).toBe(1)
    expect(q.getStatus(t).unreadCount).toBe(1)
    // 回队的就是那一份（号不变），不是另一份
    expect(q.peek(t).map((m) => m.headers?.[SEND_ID])).toEqual(['s-1'])
  })

  it('[语义] 两个身份各自负责：份号分清“哪一份信”，leaseId 分清“第几次交出去”', async () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('two-identities')
    q.enqueue(t, { id: 'same', body: 'copy-1', headers: { [SEND_ID]: 's-1' } })

    q.dequeue(t, { manualAck: true, ackTimeout: 1 })
    const handout1 = q.locate('same')[0]!
    expect(handout1.leaseId).toBeTypeOf('string')

    // 租约到期，这一份被收回重投（同一份信，新的一次交出去）
    await new Promise<void>((r) => setTimeout(r, 20))
    const second = q.dequeue(t, { manualAck: true, ackTimeout: 60_000 })!
    const handout2 = q.locate('same')[0]!
    expect(handout2.key).toBe(handout1.key) // 同一份信
    expect(handout2.leaseId).not.toBe(handout1.leaseId) // 不同的一次交出去

    // 迟到的旧句柄：不能销掉新消费者的租约
    expect(q.ack(handout1.key, handout1.leaseId)).toBe(false)
    expect(q.nack(handout1.key, false, handout1.leaseId)).toBe(false)
    expect(q.getStatus(t).inFlightCount).toBe(1)

    // 新句柄自己结算正常
    await second.ack()
    expect(q.getStatus(t).inFlightCount).toBe(0)
  })

  it('[事实] 无 mbx-send-id 的副本进队列：告警一次（降级可见，不抛）', () => {
    const warned: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.join(' '))
    })
    try {
      const q = new MailMessageQueue<TestMessage>()
      q.enqueue(topic('anon-a'), { id: 'anon', body: 'a' })
      q.enqueue(topic('anon-b'), { id: 'anon', body: 'b' })
    } finally {
      spy.mockRestore()
    }
    // 每个队列实例只说一次：非规范用法要承担后果，但不该刷屏
    expect(warned.filter((w) => w.includes(SEND_ID))).toHaveLength(1)
  })

  it('[语义] stale 扫描把每份在飞的信都各自收回重投', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('stale-both')
    q.enqueue(t, { id: 'same', body: 'copy-1', headers: { [SEND_ID]: '1' } })
    q.enqueue(t, { id: 'same', body: 'copy-2', headers: { [SEND_ID]: '2' } })
    q.dequeue(t, { manualAck: true, ackTimeout: 1 })
    q.dequeue(t, { manualAck: true, ackTimeout: 1 })
    // 让两份都超时，再取一次触发扫描
    const first = new Promise<void>((r) => setTimeout(r, 20))

    return first.then(() => {
      q.dequeue(t, { manualAck: true, ackTimeout: 1 })
      expect(q.getStatus(t).inFlightCount).toBe(1)
      expect(q.getStatus(t).unreadCount).toBe(1)
    })
  })
})
