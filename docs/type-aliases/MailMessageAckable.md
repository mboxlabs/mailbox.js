[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailMessageAckable

# Type Alias: MailMessageAckable\<T\>

> **MailMessageAckable**\<`T`\> = `T` & `object`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:10](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L10)

Represents a message that can be manually acknowledged or negatively acknowledged.

## Type Declaration

### ack

> **ack**: () => `Promise`\<`boolean` \| `void`\>

结束这次取信（= 处置值 `handled`）。

#### Returns

`Promise`\<`boolean` \| `void`\>

有没有落定；`void` = 实现不报告（公开契约里的 `Ackable` 也是这个形状）。

### nack

> **nack**: (`requeue?`) => `Promise`\<`boolean` \| `void`\>

处置这次取信：`requeue` = 回队（`unhandled`），省略 / `false` = 放弃（`discard`）。

#### Parameters

##### requeue?

`boolean`

#### Returns

`Promise`\<`boolean` \| `void`\>

有没有落定。

## Type Parameters

### T

`T`

The type of the message payload.
