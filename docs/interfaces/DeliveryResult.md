[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / DeliveryResult

# Interface: DeliveryResult

Defined in: [packages/mailbox/src/lib/delivery.ts:27](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L27)

一次投递的最终结算结果。

一次投递 = 某个订阅者对某条消息的一次完整处理，**包含整条重试链**：
只有当回调成功、或彻底失败（预算耗尽 / 不可重试 / 被取消）时才结算。
广播的发送侧据此判断「有没有订阅者成功」。

## Properties

### attempts?

> `readonly` `optional` **attempts?**: `number`

Defined in: [packages/mailbox/src/lib/delivery.ts:51](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L51)

这条投递一共跑过几次尝试（含首次；未开启重试时是 1）。

为什么内核要报这个数：「重投几次」归 provider，但死信记录要写「试了几次」。
内核不报，provider 就只能自己再记一遍账（且与内核的 `AttemptLedger` 对不上）。

***

### deliveryId

> `readonly` **deliveryId**: `string`

Defined in: [packages/mailbox/src/lib/delivery.ts:33](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L33)

投递身份：`订阅者 × 一份信`（`deliveryKey(subscriptionId, copyIdentity(message))`）。
第三段是系统发的份号（无号副本退到对象身份），不是发送方写的 `id`——重试预算按这个粒度记，
按 id 记会让两封同名信共用一本预算。

***

### error?

> `readonly` `optional` **error?**: `string`

Defined in: [packages/mailbox/src/lib/delivery.ts:58](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L58)

失败原因摘要（`Name: message`，必要时带 `code=`），截断到 [MAX\_DELIVERY\_ERROR\_LENGTH](../variables/MAX_DELIVERY_ERROR_LENGTH.md)。

死信钩子只拿到 `reason` 分类是写不出可用记录的：运维要看的是「为什么」。
这里只放摘要文本，不放 Error 对象 —— 钩子可能被同步调用，也可能被序列化到日志 / DLQ。

***

### messageId

> `readonly` **messageId**: `string`

Defined in: [packages/mailbox/src/lib/delivery.ts:35](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L35)

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [packages/mailbox/src/lib/delivery.ts:37](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L37)

true = 回调成功结算；false = 这次投递最终失败。

***

### reason?

> `readonly` `optional` **reason?**: `"retriable"` \| `"fatal"` \| `"cancelled"`

Defined in: [packages/mailbox/src/lib/delivery.ts:44](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L44)

失败分类（`ok === false` 时才有意义）：
- `retriable`：可重试错误，但重试预算已用尽 —— 值得让 `fetch()` 兜底。
- `fatal`：不可重试 —— 按死信处理，不回队（避免无限重试同一条坏消息）。
- `cancelled`：待重投被取消（退订 / 关闭）—— 等同 `retriable` 兜底。

***

### subscriptionId

> `readonly` **subscriptionId**: `string`

Defined in: [packages/mailbox/src/lib/delivery.ts:34](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L34)
