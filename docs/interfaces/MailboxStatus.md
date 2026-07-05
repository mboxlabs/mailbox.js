[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxStatus

# Interface: MailboxStatus

Defined in: [interfaces.ts:87](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L87)

代表一个邮箱地址的状态信息。

## Indexable

> \[`key`: `string`\]: `any`

索引签名，允许 MailboxStatus 包含任意其他字符串键的属性。
这些属性将作为提供者特定的扩展信息。

## Properties

### lastActivityTime?

> `optional` **lastActivityTime?**: `string`

Defined in: [interfaces.ts:99](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L99)

最后一次有消息活动（发送或接收）的时间 (ISO 8601 格式)。

***

### state

> **state**: `"online"` \| `"offline"` \| `"degraded"` \| `"unknown"`

Defined in: [interfaces.ts:91](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L91)

提供者自身的连接或运行状态。

***

### unreadCount?

> `optional` **unreadCount?**: `number`

Defined in: [interfaces.ts:95](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L95)

队列中未被消费的消息数量。
