[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / describeDeliveryError

# Function: describeDeliveryError()

> **describeDeliveryError**(`error`): `string`

Defined in: [packages/mailbox/src/lib/delivery.ts:76](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L76)

把任意抛出的值归一成一句可落库的摘要：`Error: bad payload`、`Error: flaky (code=503)`。

非 Error（字符串 / `{ code }` 字面量）也要留下可读的信息，不能变成 `undefined`。

**必须是全函数（绝不抛）**。它跑在结算路径上（`_settleDelivery` / `toDeliveryResults`），
而 `_settleDelivery` 是「先摘 `pendingDeliveries` → 构造 result → `settle()`」：抛在这里 =
结算被半途取消 —— `settle()` 不发 → barrier 的 `allSettled` 永挂 → `nack(requeue)`、死信钩子、
缺 barrier 兜底全部不执行（消息静默丢失）；抛在重试 / 看门狗的 `setTimeout` 里就是
uncaughtException（进程挂）。以前 `JSON.stringify(error)` 正是这个炸点：循环引用 / BigInt /
抛错的 `toJSON` / Proxy trap 都会让摘要函数自己抛。三端（TS / Python / Rust）同一约定。

## Parameters

### error

`unknown`

## Returns

`string`
