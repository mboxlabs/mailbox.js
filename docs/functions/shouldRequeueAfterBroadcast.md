[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / shouldRequeueAfterBroadcast

# Function: shouldRequeueAfterBroadcast()

> **shouldRequeueAfterBroadcast**(`results`): `boolean`

Defined in: [packages/mailbox/src/lib/delivery.ts:423](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L423)

广播结算后，是否把整条消息退回队列。

判定只看投递，不看「这个 topic 还有没有活跃订阅者」——后者会把全部订阅者都失败的情况
变成静默丢失（issue#1 刚补上的兜底保证）。正确条件：

1. **没有任何投递成功** —— 有成功者时整条回队就是跨投递模式重复投递；
2. **至少一次投递值得重试**（`retriable` / `cancelled`）—— 全是 `fatal` 就按死信丢弃。

## Parameters

### results

readonly [`DeliveryResult`](../interfaces/DeliveryResult.md)[]

同一消息在广播里全部投递的结算结果。

## Returns

`boolean`
