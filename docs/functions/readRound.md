[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / readRound

# Function: readRound()

> **readRound**(`message?`): `number`

Defined in: [packages/mailbox/src/lib/delivery.ts:284](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L284)

读消息上的投递轮次；没有（或不是正数）就是 0 = 还没被交到消费者手里过。

## Parameters

### message?

\{ `headers?`: `Record`\<`string`, `any`\>; \} \| `null`

## Returns

`number`
