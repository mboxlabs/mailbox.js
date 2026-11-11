[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxSnapshot

# Interface: MailboxSnapshot

Defined in: [packages/mailbox/src/interfaces.ts:377](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L377)

全量快照：一时刻整个 `Mailbox`（所有 provider、所有 topic）的诊断视图。

给诊断页、测试断言用（issue#4）。只能由能枚举自身 topic 的 provider（实现
[IMailboxProvider.listAddresses](IMailboxProvider.md#listaddresses)）提供地址；不能枚举的（AMQP / SQS 这类消息不在本地的
broker）列在 [MailboxSnapshot.unsupportedProviders](#unsupportedproviders) 里，避免快照把「枚举不了」误读成「队列为空」。

## Properties

### addressCount

> **addressCount**: `number`

Defined in: [packages/mailbox/src/interfaces.ts:388](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L388)

快照里的地址总数。

***

### addresses

> **addresses**: [`MailboxAddressSnapshot`](MailboxAddressSnapshot.md)[]

Defined in: [packages/mailbox/src/interfaces.ts:400](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L400)

按 `address` 排序的地址状态，保证快照可重复、断言可写死。

排序键是 provider 给出的地址串本身，不做规范化（D5）：内核不知道 `mem:` 与 `mem://` 等价，
也不该知道。策略专属的聚合（停放份数、过期租约积压）不在这里求和——内核不认识那些键，
要按 scheme 聚合就自己遍历 `addresses` 上的 `mem.*` 之类扩展键。

***

### inFlightCount

> **inFlightCount**: `number`

Defined in: [packages/mailbox/src/interfaces.ts:392](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L392)

所有地址的 `inFlightCount` 之和。

***

### protocols

> **protocols**: `string`[]

Defined in: [packages/mailbox/src/interfaces.ts:386](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L386)

已注册的协议名（排序后）。

***

### state

> **state**: `"unknown"` \| `"online"` \| `"offline"` \| `"degraded"`

Defined in: [packages/mailbox/src/interfaces.ts:384](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L384)

快照的完整度：
- `online`：所有 provider 都能枚举，且所有地址都是 `online`；
- `degraded`：有 provider 无法枚举，或某个地址不是 `online`（看到了一部分）；
- `unknown`：没有任何 provider 能枚举（包括一个 provider 都没有注册）。

***

### takenAt

> **takenAt**: `string`

Defined in: [packages/mailbox/src/interfaces.ts:404](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L404)

快照生成的时间（ISO 8601）。

***

### unreadCount

> **unreadCount**: `number`

Defined in: [packages/mailbox/src/interfaces.ts:390](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L390)

所有地址的 `unreadCount` 之和。

***

### unsupportedProviders

> **unsupportedProviders**: `string`[]

Defined in: [packages/mailbox/src/interfaces.ts:402](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L402)

不支持枚举自身地址的 provider（它们的队列不在本次快照里）。
