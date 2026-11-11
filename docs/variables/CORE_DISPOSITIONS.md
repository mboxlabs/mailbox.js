[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / CORE\_DISPOSITIONS

# Variable: CORE\_DISPOSITIONS

> `const` **CORE\_DISPOSITIONS**: readonly \[`"handled"`, `"unhandled"`, `"discard"`\]

Defined in: [packages/mailbox/src/interfaces.ts:137](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L137)

内核的三个处置值（消费者侧唯一通用的词汇表）。

它们说的不是「成功 / 失败」，而是「这一次交付要怎么收尾」：

| 值 | 这一份信 | 还会再交给我吗 | provider 按协议善后 |
| --- | --- | --- | --- |
| `handled`   | 结束，不留痕 | 不 | 不 |
| `unhandled` | 交回队列 | **会** | 不 |
| `discard`   | 判它不合格，结束 | 不 | **做**（死信 / bounce / 打标记…） |

其余字符串是 provider 自定义值，必须由能力声明（`supports.has('disposition:<值>')`）覆盖，
否则内核在处置发生前就报 [UnsupportedCapabilityError](../classes/UnsupportedCapabilityError.md)。

「按协议善后」是 provider 按自己协议做的事，内核不规定它是什么：`MemoryProvider` 是往死信
topic 存一份副本（没开 `enableDeadLetterQueue()` 就等同于丢弃，零痕迹）；SMTP 是 reject /
bounce；IMAP 是打 `\Deleted` 再 expunge；MQTT 一类压根没有这个概念。**不要指望 `discard`
自带 DLQ。**

不管各协议怎么善后，有一条对所有实现都成立：`discard` 之后**这条消息不能再被交回给任何
消费者**。死信链到顶（`maxNesting`）时也不例外——那种记录**停放**在那里：不在 `unreadCount`
里、`fetch` 取不到，只能查（`MemoryProvider#peekParked`），排走要显式 `purgeParked`。
把它塞回队列等于反悔这句承诺（排空脚本会永远取到同一条）。

回队位置、已重投几趟由 provider 决定，内核不管——但内核会把带 `mbx-attempt` / `mbx-round`
的投递副本交给你，设上限就有得数。
