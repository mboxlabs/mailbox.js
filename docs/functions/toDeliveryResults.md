[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / toDeliveryResults

# Function: toDeliveryResults()

> **toDeliveryResults**(`settled`): [`DeliveryResult`](../interfaces/DeliveryResult.md)[]

Defined in: [packages/mailbox/src/lib/delivery.ts:390](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L390)

把广播监听器的结算值归一化成 `DeliveryResult`。

走 `MailboxProvider` 的订阅回调一定返回 `DeliveryResult`；第三方 provider 直接注册的
监听器可能返回任意值 —— fulfilled 视作成功，rejected 视作可重试失败（宁可多兜一次，
`requeue()` 的去重守卫会挡住重复）。

## Parameters

### settled

readonly `PromiseSettledResult`\<`unknown`\>[]

## Returns

[`DeliveryResult`](../interfaces/DeliveryResult.md)[]
