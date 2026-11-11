[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxStatus

# Interface: MailboxStatus

Defined in: [packages/mailbox/src/interfaces.ts:242](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L242)

代表一个邮箱地址的状态信息。

## Extended by

- [`MailboxAddressSnapshot`](MailboxAddressSnapshot.md)

## Indexable

> \[`key`: `string`\]: `any`

扩展位：provider 自己的观测量放这里（`v1.0.0` 就留好的口子）。

**入选判据（D7）**：只有「核心操作本身能产生的观测量」才进上面的具名字段——
`state` / `exists` / `unreadCount` / `inFlightCount` / `lastActivityTime`。
停放区、租约过期积压、死信计数这些属于某个投递策略的账，一律走这里的扩展键，
并且**用 `<scheme>.<名字>` 前缀**，免得两个 provider 往同一个键上写不同的东西：

- `mem.parkedCount` / `mem.oldestParkedMs`：判死但先不丢的那些（死信链封顶是典型来源），
  不在 `unreadCount` 里、也不会被 `fetch` 交出来，只能查 `MemoryProvider#peekParked()`；
- `mem.overdueInFlightCount` / `mem.oldestOverdueMs`：`inFlightCount` 里租约已到期、还没被
  收回的份数与最老时长（回收是惰性的，靠下一次取信或 `recover()` 才扫）。告警该盯它，
  而不是 `inFlightCount`（健康的在飞也是非零的）；
- `mem.subscriberCount`：这条地址上挂着几个订阅者。

要不要填由 provider 的能力决定（见 `Capability.Parked` 之类）；内核不解释这些键的内容，
只原样带出去。

## Properties

### exists?

> `optional` **exists?**: `boolean`

Defined in: [packages/mailbox/src/interfaces.ts:261](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L261)

provider 是否认得这个地址（有过消息 / 订阅 / 活动记录）。

只有在 provider **明确回答了**状态查询时才有值；不支持 `status` 的 provider 不会把它
设成 `false`（那会把「问不到」误报成「不存在」）。

***

### inFlightCount?

> `optional` **inFlightCount?**: `number`

Defined in: [packages/mailbox/src/interfaces.ts:275](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L275)

已交给消费者、尚未 ack/nack 的消息数量。

不计入 `unreadCount`，否则卡在 in-flight 的消息在状态里完全隐形。
这些消息在自己那份租约到期后会被重新入队——但**回收是惰性的**（只有下一次 manualAck
取信才扫），所以光看它不够：过期未收回的那部分在 provider 的扩展键里
（`mem:` 是 `['mem.overdueInFlightCount']`），或直接用 `Mailbox#recover()` 收回。

***

### lastActivityTime?

> `optional` **lastActivityTime?**: `string` \| `null`

Defined in: [packages/mailbox/src/interfaces.ts:282](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L282)

最后一次有消息活动（发送或接收）的时间 (ISO 8601 格式)；没有活动记录时为 `null`。

必须是 `null` 而不是 `undefined`：`undefined` 会在 `JSON.stringify` 后整个字段消失，
诊断页拿到的是 `undefined` 而不是「没有活动」。

***

### state

> **state**: `"unknown"` \| `"online"` \| `"offline"` \| `"degraded"`

Defined in: [packages/mailbox/src/interfaces.ts:254](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L254)

provider 对**这个地址**的可观测状态：

- `online`：provider 在线，且认得这个地址（有队列 / 订阅 / 活动记录）；
- `unknown`：provider 在线，但对这份地址**没有任何记录**（地址不存在、拼错，
  或者 provider 本身不支持状态查询）；
- `offline` / `degraded`：provider 自己连不上 / 只能给出部分答复。

不要把「地址不存在」报成 `online` + 0：诊断页区分不出「不存在」与「空闲」。
要区分「地址不存在」和「provider 答不了」，看 [MailboxStatus.exists](#exists)。

***

### unreadCount?

> `optional` **unreadCount?**: `number`

Defined in: [packages/mailbox/src/interfaces.ts:265](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L265)

队列中未被消费的消息数量（不包含 in-flight）。
