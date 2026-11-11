[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / nextRetryDelay

# Function: nextRetryDelay()

> **nextRetryDelay**(`policy`, `attempt`): `number`

Defined in: [packages/mailbox/src/lib/retry.ts:74](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/retry.ts#L74)

第 `attempt` 次尝试失败之后，下一次重试要等多久（毫秒）。

`attempt` 是已经发生的尝试次数（首次失败即 1），因此第一次退避就是 `baseDelay`。
指数退避并夹在 `maxDelay` 之内。

## Parameters

### policy

[`RetryPolicy`](../interfaces/RetryPolicy.md)

### attempt

`number`

## Returns

`number`
