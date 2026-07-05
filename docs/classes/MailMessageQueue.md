[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailMessageQueue

# Class: MailMessageQueue\<T\>

Defined in: [lib/MessageQueue.ts:33](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/lib/MessageQueue.ts#L33)

A generic, in-memory message queue that supports topic-based queuing and manual acknowledgement.

This class provides a reliable queuing mechanism for producer-consumer patterns where consumers
might fail and need to retry messages. It features:
- Topic-based separation of queues.
- FIFO (First-In, First-Out) message delivery.
- Auto-acknowledgement mode (fire-and-forget).
- Manual acknowledgement mode, which places messages "in-flight" until they are explicitly
  acknowledged (`ack`) or negatively acknowledged (`nack`).
- Timeout-based requeueing for stale in-flight messages to prevent message loss.

## Type Parameters

### T

`T` *extends* `object`

The type of messages in the queue. Must have an `id` property of type string.

## Constructors

### Constructor

> **new MailMessageQueue**\<`T`\>(): `MailMessageQueue`\<`T`\>

#### Returns

`MailMessageQueue`\<`T`\>

## Methods

### ack()

> **ack**(`messageId`): `void`

Defined in: [lib/MessageQueue.ts:112](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/lib/MessageQueue.ts#L112)

Acknowledges a message, permanently removing it from the in-flight state.

#### Parameters

##### messageId

`string`

The ID of the message to acknowledge.

#### Returns

`void`

***

### dequeue()

#### Call Signature

> **dequeue**(`topic`, `options`): [`MailMessageAckable`](../type-aliases/MailMessageAckable.md)\<`T`\> \| `null`

Defined in: [lib/MessageQueue.ts:65](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/lib/MessageQueue.ts#L65)

Dequeues a message from the front of a specific topic's queue.

In auto-ack mode (`manualAck: false`), it removes and returns the message.
In manual-ack mode (`manualAck: true`), it moves the message to an "in-flight" state
and returns an `Ackable` message with `ack` and `nack` methods.
The method also triggers a check for stale messages if a timeout is provided.

##### Parameters

###### topic

`string`

The topic from which to dequeue a message.

###### options

Options for the dequeue operation.

###### ackTimeout

`number`

In manual-ack mode, the time in milliseconds after which an
  unacknowledged message is considered stale and will be requeued on the next dequeue.

###### manualAck

`true`

If true, enables manual acknowledgement mode. Defaults to false.

##### Returns

[`MailMessageAckable`](../type-aliases/MailMessageAckable.md)\<`T`\> \| `null`

An `Ackable` message in manual-ack mode, a regular message in auto-ack mode, or `null` if the queue is empty.

#### Call Signature

> **dequeue**(`topic`, `options?`): `T` \| `null`

Defined in: [lib/MessageQueue.ts:69](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/lib/MessageQueue.ts#L69)

Dequeues a message from the front of a specific topic's queue.

In auto-ack mode (`manualAck: false`), it removes and returns the message.
In manual-ack mode (`manualAck: true`), it moves the message to an "in-flight" state
and returns an `Ackable` message with `ack` and `nack` methods.
The method also triggers a check for stale messages if a timeout is provided.

##### Parameters

###### topic

`string`

The topic from which to dequeue a message.

###### options?

Options for the dequeue operation.

###### manualAck?

`false`

If true, enables manual acknowledgement mode. Defaults to false.

##### Returns

`T` \| `null`

An `Ackable` message in manual-ack mode, a regular message in auto-ack mode, or `null` if the queue is empty.

***

### enqueue()

> **enqueue**(`topic`, `message`): `void`

Defined in: [lib/MessageQueue.ts:43](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/lib/MessageQueue.ts#L43)

Adds a message to the end of a specific topic's queue.

#### Parameters

##### topic

`string`

The topic to which the message will be added.

##### message

`T`

The message to enqueue.

#### Returns

`void`

***

### getStatus()

> **getStatus**(`topic`): `object`

Defined in: [lib/MessageQueue.ts:139](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/lib/MessageQueue.ts#L139)

Gets the current status of a topic's queue.

#### Parameters

##### topic

`string`

The topic to query.

#### Returns

`object`

An object containing status information, like the number of unread messages.

##### unreadCount

> **unreadCount**: `number`

***

### nack()

> **nack**(`messageId`, `topic`, `requeue`): `void`

Defined in: [lib/MessageQueue.ts:123](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/lib/MessageQueue.ts#L123)

Negatively acknowledges a message, removing it from the in-flight state.
If `requeue` is true, the message is added back to the front of its original queue.

#### Parameters

##### messageId

`string`

The ID of the message to nack.

##### topic

`string`

The topic the message belongs to. This is used for requeueing.

##### requeue

`boolean`

If true, the message is re-added to the front of the queue.

#### Returns

`void`
