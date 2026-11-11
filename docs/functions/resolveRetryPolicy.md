[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / resolveRetryPolicy

# Function: resolveRetryPolicy()

> **resolveRetryPolicy**(`policy?`): `Required`\<[`RetryPolicy`](../interfaces/RetryPolicy.md)\> \| `null`

Defined in: [packages/mailbox/src/lib/retry.ts:38](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/retry.ts#L38)

归一化策略；`null` / `undefined` 表示不重试（保持默认行为）。

## Parameters

### policy?

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null`

## Returns

`Required`\<[`RetryPolicy`](../interfaces/RetryPolicy.md)\> \| `null`
