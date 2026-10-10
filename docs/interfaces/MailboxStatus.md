[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxStatus

# Interface: MailboxStatus

Defined in: [interfaces.ts:87](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L87)

代表一个邮箱地址的状态信息。

## Indexable

> \[`key`: `string`\]: `any`

索引签名，允许 MailboxStatus 包含任意其他字符串键的属性。
这些属性将作为提供者特定的扩展信息。

## Properties

### inFlightCount?

> `optional` **inFlightCount?**: `number`

Defined in: [interfaces.ts:103](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L103)

已交给消费者、尚未 ack/nack 的消息数量。

不计入 `unreadCount`，否则卡在 in-flight 的消息在状态里完全隐形。
这些消息超过 ack 超时后会被重新入队。

***

### lastActivityTime?

> `optional` **lastActivityTime?**: `string`

Defined in: [interfaces.ts:107](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L107)

最后一次有消息活动（发送或接收）的时间 (ISO 8601 格式)。

***

### state

> **state**: `"online"` \| `"offline"` \| `"degraded"` \| `"unknown"`

Defined in: [interfaces.ts:91](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L91)

提供者自身的连接或运行状态。

***

### unreadCount?

> `optional` **unreadCount?**: `number`

Defined in: [interfaces.ts:95](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L95)

队列中未被消费的消息数量（不包含 in-flight）。
