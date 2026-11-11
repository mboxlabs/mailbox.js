[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / nextRoundCopy

# Function: nextRoundCopy()

> **nextRoundCopy**\<`T`\>(`message`): `T`

Defined in: [packages/mailbox/src/lib/delivery.ts:301](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L301)

把消息交给下一个消费者：返回 `mbx-round = 旧值 + 1` 的**副本**。
拉取侧（provider 自己的队列）用它，就与基类在订阅侧的 +1 同一套语义、不会重复计数。

## Type Parameters

### T

`T` *extends* `object`

## Parameters

### message

`T`

## Returns

`T`
