[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MBX\_DEAD\_LETTER\_DEPTH\_HEADER

# Variable: MBX\_DEAD\_LETTER\_DEPTH\_HEADER

> `const` **MBX\_DEAD\_LETTER\_DEPTH\_HEADER**: `"mbx-dead-letter-depth"` = `'mbx-dead-letter-depth'`

Defined in: [packages/mailbox/src/providers/memory.ts:39](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/providers/memory.ts#L39)

死信记录在链里的深度（控制平面，字符串整数）：第一次归档是 1，被再归档一层是 2……
与 topic 名字里的后缀层数一致（两者由同一个函数算，见 `deadLetterDepth`）。
