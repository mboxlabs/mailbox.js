[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / isRetriableError

# Function: isRetriableError()

> **isRetriableError**(`error`): `boolean`

Defined in: [packages/mailbox/src/lib/retry.ts:57](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/retry.ts#L57)

判定错误是否可重试。与 Python 的 `_is_retriable` / Rust 的 `MailboxError::is_retriable` 一致：
显式标记 `isRetriable === true`，或 `code` 命中传输层重试白名单。

## Parameters

### error

`unknown`

## Returns

`boolean`
