[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailMessageQueue

# Class: MailMessageQueue\<T\>

Defined in: [lib/MessageQueue.ts:42](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L42)

## Type Parameters

### T

`T` *extends* `object`

## Constructors

### Constructor

> **new MailMessageQueue**\<`T`\>(): `MailMessageQueue`\<`T`\>

#### Returns

`MailMessageQueue`\<`T`\>

## Methods

### ack()

> **ack**(`messageId`): `void`

Defined in: [lib/MessageQueue.ts:128](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L128)

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

Defined in: [lib/MessageQueue.ts:76](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L76)

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

###### ackTimeout?

`number` \| `null`

In manual-ack mode, the time in milliseconds after which an
  unacknowledged message is considered stale and will be requeued on the next dequeue.
  Omitted (or negative) falls back to [DEFAULT\_ACK\_TIMEOUT](../variables/DEFAULT_ACK_TIMEOUT.md); `0` or `null` disables the
  stale check entirely (the message stays in-flight until it is ack'd or nack'd).

###### manualAck

`true`

If true, enables manual acknowledgement mode. Defaults to false.

##### Returns

[`MailMessageAckable`](../type-aliases/MailMessageAckable.md)\<`T`\> \| `null`

An `Ackable` message in manual-ack mode, a regular message in auto-ack mode, or `null` if the queue is empty.

#### Call Signature

> **dequeue**(`topic`, `options?`): `T` \| `null`

Defined in: [lib/MessageQueue.ts:80](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L80)

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

Defined in: [lib/MessageQueue.ts:52](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L52)

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

Defined in: [lib/MessageQueue.ts:157](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L157)

Gets the current status of a topic's queue.

#### Parameters

##### topic

`string`

The topic to query.

#### Returns

`object`

An object containing status information: `unreadCount` (waiting in the queue)
  and `inFlightCount` (handed to consumers, awaiting ack/nack). Only `unreadCount` is
  safe to treat as "delivered"; in-flight messages will come back if they are never ack'd.

##### inFlightCount

> **inFlightCount**: `number`

##### unreadCount

> **unreadCount**: `number`

***

### has()

> **has**(`messageId`): `boolean`

Defined in: [lib/MessageQueue.ts:200](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L200)

判断某个消息是否已在队列中等待或已被取走（in-flight）。

#### Parameters

##### messageId

`string`

#### Returns

`boolean`

***

### nack()

> **nack**(`messageId`, `topic`, `requeue`): `void`

Defined in: [lib/MessageQueue.ts:139](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L139)

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

***

### requeue()

> **requeue**(`topic`, `message`): `boolean`

Defined in: [lib/MessageQueue.ts:182](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L182)

Adds a message back to the front of its queue. Used for requeueing.

去重：同一个 `id` 已经在该 topic 队列里、或已被某个消费者取走（in-flight）时，
不再插入副本。一个地址有多个订阅者时，每个失败的订阅者都会触发一次 nack(requeue)；
不去重就会在队列里留下 N 份同一消息（实测：2 个订阅者失败 → `unreadCount` 为 2）。

#### Parameters

##### topic

`string`

The topic of the queue.

##### message

`T`

The message to requeue.

#### Returns

`boolean`

true 如果消息确实回到队列；false 如果因为重复而跳过。
