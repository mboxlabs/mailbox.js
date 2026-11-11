[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / InFlightEntry

# Type Alias: InFlightEntry\<T\>

> **InFlightEntry**\<`T`\> = `object`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:65](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L65)

一条租约（manualAck 取信）：一次 manualAck 取信 = 一份信借出去一段时间（见 [MailMessageQueue](../classes/MailMessageQueue.md) 的 `inFlight`）。

`expiresAt` 是**这条租约自己的**到期时刻（取走那一刻算好），`Infinity` = 永不过期。

## Type Parameters

### T

`T`

## Properties

### expiresAt

> **expiresAt**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:71](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L71)

***

### leaseId

> **leaseId**: `string`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:70](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L70)

这一份的第几次交出去（`<份号>#<次序>`）：同一份被收回重投后就是新的一个。

***

### message

> **message**: `T`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:66](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L66)

***

### timestamp

> **timestamp**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:67](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L67)

***

### topic

> **topic**: `string`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:68](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L68)
