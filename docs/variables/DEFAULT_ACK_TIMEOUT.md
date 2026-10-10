[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / DEFAULT\_ACK\_TIMEOUT

# Variable: DEFAULT\_ACK\_TIMEOUT

> `const` **DEFAULT\_ACK\_TIMEOUT**: `30000` = `30_000`

Defined in: [lib/MessageQueue.ts:40](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/MessageQueue.ts#L40)

手动 ACK 模式下未显式指定 `ackTimeout` 时使用的默认超时（毫秒）。

in-flight 消息必须有界：否则消费者崩溃后既取不回来、也不会在状态里可见，
等于静默丢失。传 0（或 null）可以显式关闭超时，消息常驻 in-flight 直到 ack/nack。
该缺省值与 `ackTimeout` 的三态语义在 TS / Python / Rust 三端保持一致。
