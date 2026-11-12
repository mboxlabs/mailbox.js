/**
 * 消费者句柄的 `nack()` **故意不警告**——与队列层那条不对称。
 *
 * 队列层省略 `requeue` 的 `nack()` 会警告一次（`3.0.0` 它要从「丢弃」静默翻成「退回」，
 * 见 `lib/MessageQueue.nack-default.test.ts`）。这一面不警告是有意的：
 * `MemoryProvider.wrapConsumerSettlement` 给的 `nack(requeue?)` 在 `3.0.0` 是**整体消失**
 * （已在破坏声明里），调用方撞到的是编译错误 / 方法不存在，本来就响亮，再加一条运行时噪音只是噪音。
 *
 * 「**变形**要警告、**消失**不用警告」这条不对称两边都得钉住，否则将来有人「顺手补一致」
 * 就会把一个即将消失的 API 变成一条警告闪烁。
 *
 * 命名标记：
 *   [边界] 这个句柄与队列句柄不是一族，别把它们对齐。
 */

import { describe, expect, it, vi, afterEach } from 'vitest'

import { Mailbox } from '../mailbox'
import { MemoryProvider } from './memory'

let warn: ReturnType<typeof vi.spyOn> | undefined
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

describe('消费者句柄的 nack()：故意不警告（它的 3.0.0 命运是消失）', () => {
  it('[边界] `fetch({ manualAck: true })` 给的句柄无参 nack() 不警告，行为仍是丢弃', async () => {
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

    await mailbox.stop({ purge: true })
  })
})
