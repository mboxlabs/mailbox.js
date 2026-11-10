[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / resolveRetryPolicy

# Function: resolveRetryPolicy()

> **resolveRetryPolicy**(`policy?`): `Required`\<[`RetryPolicy`](../interfaces/RetryPolicy.md)\> \| `null`

Defined in: [packages/mailbox/src/lib/retry.ts:38](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/retry.ts#L38)

归一化策略；`null` / `undefined` 表示不重试（保持默认行为）。

## Parameters

### policy?

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null`

## Returns

`Required`\<[`RetryPolicy`](../interfaces/RetryPolicy.md)\> \| `null`
