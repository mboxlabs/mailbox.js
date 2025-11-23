[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Ackable

# Interface: Ackable

Defined in: [interfaces.ts:54](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L54)

代表一个可被手动确认或拒绝的信件。

## Methods

### ack()

> **ack**(): `Promise`\<`void`\>

Defined in: [interfaces.ts:59](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L59)

确认消息已被成功处理。
Provider 将会通知消息队列彻底删除此消息。

#### Returns

`Promise`\<`void`\>

***

### nack()

> **nack**(`requeue?`): `Promise`\<`void`\>

Defined in: [interfaces.ts:66](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L66)

拒绝消息。

#### Parameters

##### requeue?

`boolean`

如果为 true，请求消息队列将此消息重新放回，使其可以被再次消费。
               如果为 false，消息将被丢弃或移入死信队列。

#### Returns

`Promise`\<`void`\>
