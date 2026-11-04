/**
 * 停放（park）：把「到此为止但先别丢」的东西放在交付流之外
 *
 * 队列只有两个交付状态：未读、在飞。判死/封顶这类「不该再交给任何人，但也不该静默消失」的
 * 记录如果还留在未读里，排空脚本就会永远取到同一条（F8）。停放是第三个状态：
 * **不出队、不被 fetch 交出来、但在 status 里数得出来、并且能被读出来**。
 *
 * 固化的不变量：
 *   [语义] 停放的份数不进 `unreadCount`，也永远不会被 `dequeue` 交出来。
 *   [语义] 停放必须在 status 里单独看得见（`parkedCount` / `oldestParkedMs`）。
 *   [语义] 停放有上限：超了淘汰最老的，并且**出声**（不静默丢）。
 *   [语义] `clear()` 连停放一起清（不能只清交付流）。
 *   [事实] 停放的份数可以被读出来（`listParked`），读它不改变任何状态。
 */

import { describe, expect, it, vi } from 'vitest'
import { MailMessageQueue } from './MessageQueue'

type TestMessage = { id: string; body: string; headers?: Record<string, any> }

let topicSeq = 0
const topic = (name: string) => `p-${name}-${topicSeq++}`

describe('停放：交付流之外的第三态', () => {
  it('[语义] 停放的份数既不在未读里，也不会被取出来', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('not-delivered')
    q.park(t, { id: 'poison', body: 'dead' }, 'nesting limit')

    expect(q.dequeue(t, { manualAck: false })).toBeNull()
    expect(q.getStatus(t).unreadCount).toBe(0)
    expect(q.getStatus(t).inFlightCount).toBe(0)
  })

  it('[语义] 停放必须在 status 里单独数得出来', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('visible')
    q.park(t, { id: 'a', body: '1' }, 'nesting limit')
    q.park(t, { id: 'b', body: '2' }, 'nesting limit')

    const s = q.getStatus(t)
    expect(s.unreadCount).toBe(0)
    expect(s.parkedCount).toBe(2)
    expect(s.oldestParkedMs).toBeGreaterThanOrEqual(0)
  })

  it('[事实] 停放可以被读出来，且读它不改状态', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('read-only')
    q.park(t, { id: 'a', body: '1' }, 'nesting limit')

    expect(q.listParked(t).map((m) => m.id)).toEqual(['a'])
    expect(q.listParked(t).map((m) => m.id)).toEqual(['a'])
    expect(q.getStatus(t).parkedCount).toBe(1)
  })

  it('[语义] 地址之间不串扰：停放只算在自己那条队列上', () => {
    const q = new MailMessageQueue<TestMessage>()
    const a = topic('a')
    const b = topic('b')
    q.park(a, { id: 'x', body: '1' }, 'nesting limit')

    expect(q.getStatus(a).parkedCount).toBe(1)
    expect(q.getStatus(b).parkedCount).toBe(0)
    expect(q.listParked(b)).toEqual([])
  })

  it('[语义] clear() 连停放一起清', () => {
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('clear')
    q.enqueue(t, { id: 'live', body: '1' })
    q.park(t, { id: 'poison', body: '2' }, 'nesting limit')

    q.clear(t)
    expect(q.getStatus(t).unreadCount).toBe(0)
    expect(q.getStatus(t).parkedCount).toBe(0)
  })

  it('[语义] 停放有上限：淘汰最老的，并且出声', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const q = new MailMessageQueue<TestMessage>()
    const t = topic('cap')
    for (let i = 0; i < 105; i++) {
      q.park(t, { id: `m${i}`, body: String(i) }, 'nesting limit')
    }

    const s = q.getStatus(t)
    expect(s.parkedCount).toBeLessThanOrEqual(100)
    expect(s.parkedCount).toBeGreaterThan(0)
    // 留下的是最新的：淘汰最老的，排空脚本看到的才是最近的问题
    expect(q.listParked(t)[0].id).toBe('m5')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
