[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / SettlingAckable

# Type Alias: SettlingAckable\<T\>

> **SettlingAckable**\<`T`\> = `T` & `object`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:34](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L34)

队列自己交给消费者的那个 ackable：与 [MailMessageAckable](MailMessageAckable.md) 同一个形状，但 `ack` / `nack`
**报告这次处置有没有落定**。

为什么要把这个数报出来：“处置已经落定”与“处置没发生”在静默 no-op 下完全看不出来，
而上层（provider 的死信接法）必须分清这两者 —— 否则一次重复 `nack(false)` 就会多留一条
死信，而一条已被 stale 扫描重投的消息也会被旧 handle 迟到地判成“放弃”。

对外（`interfaces.ts` 里的 `Ackable`）现在也是 `Promise<boolean | void>`：`void` 留给不报告结果的
第三方句柄，`boolean` 是把「没落定」说出来的手段——忽略返回值的调用方在运行时不受影响。

## Type Declaration

### ack

> **ack**: () => `Promise`\<`boolean`\>

#### Returns

`Promise`\<`boolean`\>

`true` = 这次真的把消息从 in-flight 结算掉了；`false` = 它已经不归这次 `fetch` 了。

### nack

> **nack**: (`requeue?`) => `Promise`\<`boolean`\>

#### Parameters

##### requeue?

`boolean`

回队（`true`）还是放弃（`false`）。

#### Returns

`Promise`\<`boolean`\>

`true` = 处置真的落定；`false` = 重复处置 / 已被重投 / 已被丢弃。

## Type Parameters

### T

`T`
