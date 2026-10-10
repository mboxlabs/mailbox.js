[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / resolveRetryPolicy

# Function: resolveRetryPolicy()

> **resolveRetryPolicy**(`policy?`): `Required`\<[`RetryPolicy`](../interfaces/RetryPolicy.md)\> \| `null`

Defined in: [lib/retry.ts:38](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L38)

归一化策略；`null` / `undefined` 表示不重试（保持默认行为）。

## Parameters

### policy?

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null`

## Returns

`Required`\<[`RetryPolicy`](../interfaces/RetryPolicy.md)\> \| `null`
