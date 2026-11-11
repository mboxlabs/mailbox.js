[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MBX\_DEAD\_LETTER\_DEPTH\_HEADER

# Variable: MBX\_DEAD\_LETTER\_DEPTH\_HEADER

> `const` **MBX\_DEAD\_LETTER\_DEPTH\_HEADER**: `"mbx-dead-letter-depth"` = `'mbx-dead-letter-depth'`

Defined in: [packages/mailbox/src/providers/memory.ts:39](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L39)

死信记录在链里的深度（控制平面，字符串整数）：第一次归档是 1，被再归档一层是 2……
与 topic 名字里的后缀层数一致（两者由同一个函数算，见 `deadLetterDepth`）。
