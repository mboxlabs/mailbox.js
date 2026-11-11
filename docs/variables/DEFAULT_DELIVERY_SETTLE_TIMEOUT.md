[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / DEFAULT\_DELIVERY\_SETTLE\_TIMEOUT

# Variable: DEFAULT\_DELIVERY\_SETTLE\_TIMEOUT

> `const` **DEFAULT\_DELIVERY\_SETTLE\_TIMEOUT**: `30000` = `30_000`

Defined in: [packages/mailbox/src/lib/delivery.ts:18](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L18)

单次投递**尝试**的默认结算超时（毫秒）。`0` 关闭。

卡死的订阅回调会让广播的结算 barrier 永不落定：消息既不回队也不死信，`unreadCount`
里也看不见（等于静默消失）。看门狗给「一次尝试」一个上界：超时后按取消结算，消息回到
兜底路径。它只给单次尝试计时，所以不会掐断健康的重试链或退避等待。
