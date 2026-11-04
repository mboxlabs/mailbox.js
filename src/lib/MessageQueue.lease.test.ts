import { describe, expect, it } from 'vitest'
import { DEFAULT_ACK_TIMEOUT, MailMessageQueue } from './MessageQueue'

/**
 * 租约（manualAck 取走 → ack/nack 之前那段"在飞"）的到期判定归谁。
 *
 * 核心命题：**租约是取走那一刻谈定的，它自己必须记着什么时候到期。**
 * 过期与否不能由"下一个来取信的人传进来的 timeout"决定——那个人跟这条租约没关系。
 */

type M = { id: string; body: string }
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const msg = (id: string): M => ({ id, body: id })
const grab = (q: MailMessageQueue<M>, topic: string, ackTimeout?: number | null): M | null =>
  q.dequeue(topic, { manualAck: true, ackTimeout }) as M | null

describe('租约自己记着到期时间', () => {
  it('[语义] 过期与否按这份租约自己的时长判，不按下一个取信者传的值', () => {
    // A 谈定 20ms 的租约然后崩了；B 带着 10s 的租约来取信。
    // B 的取信动作必须把 A 那份早过期的租约收回来——不能因为 B 自己租期长就当它还没过期。
    const q = new MailMessageQueue<M>()
    const topic = 'lease-own-timeout'
    q.enqueue(topic, msg('A'))
    grab(q, topic, 20)
    return sleep(60).then(() => {
      expect(grab(q, topic, 10_000)?.id).toBe('A') // ← 扫的是"A 的 20ms 到没到"，不是"B 的 10s 到没到"
    })
  })

  it('[语义] 长租约不会被短租约消费者提前接管', () => {
    // 反方向：A 谈定 5s（正在处理慢活），B 用 20ms 来取信。B 不能因此把 A 手里那份抢回来重投。
    const q = new MailMessageQueue<M>()
    const topic = 'long-lease'
    q.enqueue(topic, msg('A'))
    grab(q, topic, 5_000)
    return sleep(300).then(() => {
      expect(grab(q, topic, 20)).toBeNull()
      expect(q.getStatus(topic).inFlightCount).toBe(1) // A 那份还在 A 手里
    })
  })

  it('[语义] ackTimeout: 0 / null 的租约永不过期，别人的取信不能作废它', async () => {
    // `0` / `null` 的语义是"这份租约不设到期"，不是"这次取信不做清扫"。
    // 于是别的消费者再怎么清扫，都不能把这份挂回队列。
    for (const never of [0, null] as const) {
      const q = new MailMessageQueue<M>()
      const topic = `never-expires-${never}`
      q.enqueue(topic, msg('A'))
      grab(q, topic, never)
      await sleep(50)
      q.enqueue(topic, msg('B'))
      const got = grab(q, topic, 1) // 另一个消费者，带 1ms 的租约
      expect(got?.id).toBe('B') // 只能拿到 B，不能把 A 那份"收回重投"
      expect(q.getStatus(topic).inFlightCount).toBe(2) // A 常驻 + B 在飞
    }
  })

  it('[语义] 每条租约各自到期：只有过期的那条被收回', () => {
    const q = new MailMessageQueue<M>()
    const topic = 'per-lease'
    q.enqueue(topic, msg('short'))
    q.enqueue(topic, msg('long'))
    grab(q, topic, 20) // short 的租约
    grab(q, topic, 60_000) // long 的租约
    return sleep(60).then(() => {
      expect(grab(q, topic, 60_000)?.id).toBe('short') // 只有 short 到期回来了
      expect(q.getStatus(topic).inFlightCount).toBe(2) // long 仍在其租约内 + 刚取走的这份
    })
  })

  it('[语义] 没写 ackTimeout 就用默认租约，同样记在这条租约上', () => {
    const q = new MailMessageQueue<M>()
    const topic = 'default-lease'
    q.enqueue(topic, msg('A'))
    grab(q, topic) // 未指定 → DEFAULT_ACK_TIMEOUT
    return sleep(30).then(() => {
      // 别的消费者带 1ms 来取，不能把这条还在默认租约里的信"扫"回来
      expect(grab(q, topic, 1)).toBeNull()
      expect(q.getStatus(topic).inFlightCount).toBe(1)
      expect(DEFAULT_ACK_TIMEOUT).toBeGreaterThan(1_000) // 默认必须是"够长"，否则这条断言没意义
    })
  })
})

describe('过期未收回的在飞必须可见', () => {
  it('[语义] 租约过期但没人来取：status 必须报出过期份数与最老过期时长', async () => {
    const q = new MailMessageQueue<M>()
    const topic = 'overdue-visible'
    q.enqueue(topic, msg('A'))
    grab(q, topic, 20)
    await sleep(90)

    const status = q.getStatus(topic)
    expect(status.unreadCount).toBe(0) // 不在队列里（回收是惰性的）
    expect(status.inFlightCount).toBe(1) // 挂在在飞
    expect(status.overdueInFlightCount).toBe(1) // ← 而且它已经过期了，必须看得见
    expect(status.oldestOverdueMs).toBeGreaterThanOrEqual(60)
  })

  it('[语义] 健康的租约与永不过期的租约都不算过期', () => {
    const q = new MailMessageQueue<M>()
    const topic = 'healthy'
    q.enqueue(topic, msg('normal'))
    q.enqueue(topic, msg('never'))
    grab(q, topic, 60_000) // 健康
    grab(q, topic, 0) // 永不过期

    const status = q.getStatus(topic)
    expect(status.inFlightCount).toBe(2)
    expect(status.overdueInFlightCount).toBe(0)
    expect(status.oldestOverdueMs).toBe(0)
  })

  it('[语义] 被 stale 扫描收回后，过期计数归零', async () => {
    const q = new MailMessageQueue<M>()
    const topic = 'overdue-cleared'
    q.enqueue(topic, msg('A'))
    grab(q, topic, 20)
    await sleep(60)
    expect(q.getStatus(topic).overdueInFlightCount).toBe(1)

    q.enqueue(topic, msg('B'))
    expect(grab(q, topic, 60_000)?.id).toBe('A') // 收回重投，被这次取信拿走
    expect(q.getStatus(topic).overdueInFlightCount).toBe(0)
  })

  it('[语义] status 只在被查询时读，不顺手改动在飞', async () => {
    const q = new MailMessageQueue<M>()
    const topic = 'status-is-read-only'
    q.enqueue(topic, msg('A'))
    grab(q, topic, 20)
    await sleep(60)
    const first = q.getStatus(topic)
    const second = q.getStatus(topic)
    expect(second).toEqual(first) // 反复快照不回收、不刷新（与 peek 同理）
    expect(q.getStatus(topic).unreadCount).toBe(0) // 没被"顺手"放回队列
  })
})

describe('显式回收（不靠有人取信触发）', () => {
  it('[语义] sweepExpired(topic) 把已过期的租约收回队列，并返回收回了几份', async () => {
    const q = new MailMessageQueue<M>()
    const topic = 'explicit-sweep'
    q.enqueue(topic, msg('short-1'))
    q.enqueue(topic, msg('short-2'))
    grab(q, topic, 20)
    grab(q, topic, 20)
    await sleep(60)

    expect(q.getStatus(topic).overdueInFlightCount).toBe(2)
    expect(q.sweepExpired(topic)).toBe(2) // ← 运维脚本 / 定时器要的就是这个动作
    expect(q.getStatus(topic)).toMatchObject({ unreadCount: 2, inFlightCount: 0, overdueInFlightCount: 0 })
  })

  it('[语义] 显式扫描不动未到期的租约，也不动常驻租约', async () => {
    const q = new MailMessageQueue<M>()
    const topic = 'explicit-sweep-scoped'
    q.enqueue(topic, msg('never'))
    q.enqueue(topic, msg('long'))
    q.enqueue(topic, msg('short'))
    grab(q, topic, 0) // 常驻
    grab(q, topic, 60_000) // 未到期
    grab(q, topic, 10) // 会到期
    await sleep(40)

    expect(q.sweepExpired(topic)).toBe(1)
    expect(q.dequeue(topic)?.id).toBe('short') // 只有那一条回来了
    expect(q.dequeue(topic)).toBeNull() // 队里没有第二条
    expect(q.getStatus(topic).inFlightCount).toBe(2) // 常驻 + 未到期都还在各自租约里
    expect(q.getStatus(topic).overdueInFlightCount).toBe(0)
  })
})
