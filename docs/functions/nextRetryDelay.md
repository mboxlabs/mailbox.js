[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / nextRetryDelay

# Function: nextRetryDelay()

> **nextRetryDelay**(`policy`, `attempt`): `number`

Defined in: [lib/retry.ts:74](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L74)

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
