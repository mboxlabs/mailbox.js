[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / DeadLetterQueueOptions

# Interface: DeadLetterQueueOptions

Defined in: [packages/mailbox/src/providers/memory.ts:73](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L73)

[MemoryProvider.enableDeadLetterQueue](../classes/MemoryProvider.md#enabledeadletterqueue) 的选项。

## Properties

### maxNesting?

> `optional` **maxNesting?**: `number`

Defined in: [packages/mailbox/src/providers/memory.ts:95](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L95)

死信链的深度上限（一条消息最多能被归档进几层 `<suffix>`）。默认
[DEFAULT\_MAX\_DEAD\_LETTER\_NESTING](../variables/DEFAULT_MAX_DEAD_LETTER_NESTING.md)。

到顶之后不报错、也不丢消息：[MemoryProvider.deadLetterTopic](../classes/MemoryProvider.md#deadlettertopic) 对那条队列返回它**自己**
（停放目的地），归档就在原地发生并打 [MBX\_DEAD\_LETTER\_TERMINAL\_HEADER](../variables/MBX_DEAD_LETTER_TERMINAL_HEADER.md)。
必须是 ≥ 1 的整数或 `Number.POSITIVE_INFINITY`，否则在 `enableDeadLetterQueue()` 抛
[InvalidDeadLetterNestingError](../classes/InvalidDeadLetterNestingError.md)（小于 1 = 死信无处可去；NaN / 非整数 = 比较永远不成立，链永不封顶）。

***

### suffix?

> `optional` **suffix?**: `string`

Defined in: [packages/mailbox/src/providers/memory.ts:84](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L84)

死信 topic 的后缀（接在原始地址 path 的末尾）。默认 [DEFAULT\_DEAD\_LETTER\_SUFFIX](../variables/DEFAULT_DEAD_LETTER_SUFFIX.md)。

后缀必须**已经是规范形式**，否则在 `enableDeadLetterQueue()` 就拒绝（[InvalidDeadLetterSuffixError](../classes/InvalidDeadLetterSuffixError.md)）：
- 空串 / 只剩空白 ⇒ 会把被放弃的消息写回**原队列**（无限重试）；
- 带 query / hash ⇒ 会在地址规范化时被静默丢掉；
- 会被 URL 改写的形式（非 ASCII、双引号 / 尖括号 / 反引号 / 花括号、NUL 与 C1 控制符、
  `.` / `..` 路径段）⇒ 写进去的 key 没有任何地址能命名（取不回来），或塌到别人的活队列里。
  要非 ASCII 就写它的 percent-encoding 拼法，例如 `_死信` 要写成 `_%E6%AD%BB%E4%BF%A1`。
