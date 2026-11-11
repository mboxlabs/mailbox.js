[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / LocatedCopy

# Type Alias: LocatedCopy

> **LocatedCopy** = `object`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:80](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L80)

`locate(messageId)` 的一条候选：按发送方给的名字**查**到的那一份。

查可以按他们的名字（`order-42` 是人认得的），**动手必须按这里的 `key`**（我们发的份号）。
同名多份时调用方自己选，不靠队列猜。

## Properties

### key

> **key**: `string`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:82](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L82)

份号（结算门的键）：`send:<系统发的 mbx-send-id>`，无号副本退化成 `obj:<对象份号>`。

***

### leaseId?

> `optional` **leaseId?**: `string`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:92](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L92)

在飞时：这一次交出去的编号（`<份号>#<次序>`）；拿它结算才能避开迟到的旧句柄。

***

### messageId

> **messageId**: `string`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:84](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L84)

发送方写在这封信上的名字（只读用途）。

***

### sendId?

> `optional` **sendId?**: `string`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:86](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L86)

系统发的份号；无号副本为 undefined。

***

### since?

> `optional` **since?**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:94](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L94)

在飞时：什么时候交出去的（ms epoch）；排队时为 undefined。

***

### state

> **state**: `"queued"` \| `"inFlight"`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:90](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L90)

在排队还是在飞。

***

### topic

> **topic**: `string`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:88](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L88)

这一份现在挂在哪本账上。
