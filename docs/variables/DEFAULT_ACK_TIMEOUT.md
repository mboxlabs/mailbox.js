[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / DEFAULT\_ACK\_TIMEOUT

# Variable: DEFAULT\_ACK\_TIMEOUT

> `const` **DEFAULT\_ACK\_TIMEOUT**: `30000` = `30_000`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:51](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L51)

手动 ACK 模式下未显式指定 `ackTimeout` 时使用的默认超时（毫秒）。

in-flight 消息必须有界：否则消费者崩溃后既取不回来、也不会在状态里可见，
等于静默丢失。传 0（或 null）是显式退出：那份租约永不过期，只能由它自己的句柄 ack/nack。
该缺省值与 `ackTimeout` 的三态语义在 TS / Python / Rust 三端保持一致。
