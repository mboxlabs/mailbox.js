[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / DEFAULT\_MAX\_DEAD\_LETTER\_NESTING

# Variable: DEFAULT\_MAX\_DEAD\_LETTER\_NESTING

> `const` **DEFAULT\_MAX\_DEAD\_LETTER\_NESTING**: `1` = `1`

Defined in: [packages/mailbox/src/providers/memory.ts:33](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L33)

死信链的深度上限默认值：**只允许一层** `<topic><suffix>`。

为什么必须有上限：死信 topic 的名字是后缀拼接出来的，所以「消费死信的人自己又失败」
在拓扑上可以无限套（`X_dlq_dlq_dlq…`）——topic 数量与地址长度都会无界增长，
而每一层都要有人消费、都是新的运维负担。对标：SQS 直接拒绝成环的 redrive 拓扑，
RabbitMQ 靠 `x-delivery-limit` 给隔离队列封顶。

封顶**不是**丢弃：到顶后记录**原地停放**（park）并打 [MBX\_DEAD\_LETTER\_TERMINAL\_HEADER](MBX_DEAD_LETTER_TERMINAL_HEADER.md)。
要更深的链就显式传 `maxNesting`；`Number.POSITIVE_INFINITY` 是「我不要上限」的出口。
