[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Ackable

# Interface: Ackable

Defined in: [interfaces.ts:67](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L67)

代表一个可被手动确认或拒绝的信件。

## Methods

### ack()

> **ack**(): `Promise`\<`void`\>

Defined in: [interfaces.ts:72](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L72)

确认消息已被成功处理。
Provider 将会通知消息队列彻底删除此消息。

#### Returns

`Promise`\<`void`\>

***

### nack()

> **nack**(`requeue?`): `Promise`\<`void`\>

Defined in: [interfaces.ts:79](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L79)

拒绝消息。

#### Parameters

##### requeue?

`boolean`

如果为 true，请求消息队列将此消息重新放回，使其可以被再次消费。
               如果为 false，消息将被丢弃或移入死信队列。

#### Returns

`Promise`\<`void`\>
