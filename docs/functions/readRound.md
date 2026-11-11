[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / readRound

# Function: readRound()

> **readRound**(`message?`): `number`

Defined in: [packages/mailbox/src/lib/delivery.ts:284](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L284)

读消息上的投递轮次；没有（或不是正数）就是 0 = 还没被交到消费者手里过。

## Parameters

### message?

\{ `headers?`: `Record`\<`string`, `any`\>; \} \| `null`

## Returns

`number`
