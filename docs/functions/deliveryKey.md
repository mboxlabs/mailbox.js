[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / deliveryKey

# Function: deliveryKey()

> **deliveryKey**(`subscriptionId`, `copyId`): `string`

Defined in: [packages/mailbox/src/lib/delivery.ts:343](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L343)

投递身份。**投递 = 一个订阅者 × 一份信**（`copyId` = 系统发的 `mbx-send-id`）。

第三段不是可选装饰：`id` 是发送方的名字，可以重复（内容 hash、发送方重发、两个发送方撞名）。
只拿 `(subscriptionId, messageId)` 记尝试次数，两封同名信就共用一本预算：后到那封
第一趟就被判“重试耗尽”（它应有的重试被吞），先到那封反倒多拿到一趟，消息上的
`mbx-attempt` 章越过自己声明的 `mbx-max-attempts`。没发号的副本（非标准路径）由
[copyIdentity](copyIdentity.md) 退到对象身份，仍然分得开。

## Parameters

### subscriptionId

`string`

### copyId

`string`

## Returns

`string`
