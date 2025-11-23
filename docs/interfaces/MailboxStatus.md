[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxStatus

# Interface: MailboxStatus

Defined in: [interfaces.ts:74](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L74)

代表一个邮箱地址的状态信息。

## Indexable

\[`key`: `string`\]: `any`

索引签名，允许 MailboxStatus 包含任意其他字符串键的属性。
这些属性将作为提供者特定的扩展信息。

## Properties

### lastActivityTime?

> `optional` **lastActivityTime**: `string`

Defined in: [interfaces.ts:86](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L86)

最后一次有消息活动（发送或接收）的时间 (ISO 8601 格式)。

***

### state

> **state**: `"online"` \| `"offline"` \| `"degraded"` \| `"unknown"`

Defined in: [interfaces.ts:78](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L78)

提供者自身的连接或运行状态。

***

### unreadCount?

> `optional` **unreadCount**: `number`

Defined in: [interfaces.ts:82](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L82)

队列中未被消费的消息数量。
