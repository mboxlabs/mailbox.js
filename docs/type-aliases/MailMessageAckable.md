[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailMessageAckable

# Type Alias: MailMessageAckable\<T\>

> **MailMessageAckable**\<`T`\> = `T` & `object`

Defined in: [lib/MessageQueue.ts:7](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/lib/MessageQueue.ts#L7)

Represents a message that can be manually acknowledged or negatively acknowledged.

## Type Declaration

### ack

> **ack**: () => `Promise`\<`void`\>

Acknowledges the message, confirming successful processing.

#### Returns

`Promise`\<`void`\>

### nack

> **nack**: (`requeue?`) => `Promise`\<`void`\>

Negatively acknowledges the message, indicating failure to process.

#### Parameters

##### requeue?

`boolean`

If true, the message will be added back to the front of the queue. Defaults to false.

#### Returns

`Promise`\<`void`\>

## Type Parameters

### T

`T`

The type of the message payload.
