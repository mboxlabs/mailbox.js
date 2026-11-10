[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MBX\_DEAD\_LETTER\_TERMINAL\_HEADER

# Variable: MBX\_DEAD\_LETTER\_TERMINAL\_HEADER

> `const` **MBX\_DEAD\_LETTER\_TERMINAL\_HEADER**: `"mbx-dead-letter-terminal"` = `'mbx-dead-letter-terminal'`

Defined in: [packages/mailbox/src/providers/memory.ts:47](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/providers/memory.ts#L47)

「到顶了，原地停放」的标记（控制平面，`'true'`）。

为什么需要它：封顶之后记录不会再往下拼一层后缀，它仍然待在**同一条**死信队列里。
没有这个标记，补偿 worker 就会把它当成一条普通死信反复取、反复放弃（空转）而完全看不出来。
