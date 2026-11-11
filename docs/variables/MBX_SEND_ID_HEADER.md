[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MBX\_SEND\_ID\_HEADER

# Variable: MBX\_SEND\_ID\_HEADER

> `const` **MBX\_SEND\_ID\_HEADER**: `"mbx-send-id"` = `'mbx-send-id'`

Defined in: [packages/mailbox/src/lib/delivery.ts:228](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L228)

「这一份信」的编号（控制平面）：每次 `post()` 一个，由系统发，随副本一路带着走。

为什么要它：`id` 是**发送方**给的名字（`OutgoingMail.id` 还建议用内容 hash），名字可以重复——
同一封信发两次、两个发送方撞名、恶意发送方故意撞名，都合法。队列要是拿 `id` 当记账的键，
就会把两份不同的信当成一份：回队被当成重复吞掉、在飞槽位被顶替、按 id 的结算落到别人手里那份上。
所以记账必须按「哪一份」，不能按「叫什么」。

它必须放在 headers 里而不是只在内存里记：投递副本是被一路 `{...message}` 拷出来的，
只有头能穿过每一次拷贝活下来（对象身份活不下来）。

**发送方塞的值一律不采信**（见 [stripSenderForgedSystemHeaders](../functions/stripSenderForgedSystemHeaders.md)）：否则一个伪造的编号
就能让两份信在队列里被当成一份。
