[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MBX\_ATTEMPT\_HEADER

# Variable: MBX\_ATTEMPT\_HEADER

> `const` **MBX\_ATTEMPT\_HEADER**: `"mbx-attempt"` = `'mbx-attempt'`

Defined in: [packages/mailbox/src/lib/delivery.ts:192](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L192)

投递尝试次数的 header 名（控制平面）。

「重投几次」由 provider 决定，但每次投递得知道自己第几次来：真实 broker 的
`_nack(false)` 落 DLQ、日志、幂等判断都要用。放在 headers（控制平面）而不是 meta
（数据平面，业务字段，内核不写）。

**作用域要看清：它是「本轮投递链内」的趟数（基类在交给回调前注入到副本上），不是重投计数。**
重试链内 1→2→3；消息回队、下一轮投递又从 1 开始数。拿它当上限，每一轮都只数到
`maxAttempts` 就停在那里，上限永远不会触发——跨轮累积的值在 [MBX\_ROUND\_HEADER](MBX_ROUND_HEADER.md)。
