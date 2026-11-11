[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / ParkedEntry

# Type Alias: ParkedEntry\<T\>

> **ParkedEntry**\<`T`\> = `object`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:54](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L54)

一条停放记录：判死但先不丢的那一份，加上「什么时候停的、为什么」。

## Type Parameters

### T

`T`

## Properties

### message

> **message**: `T`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:55](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L55)

***

### parkedAt

> **parkedAt**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:56](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L56)

***

### reason

> **reason**: `string`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:57](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L57)
