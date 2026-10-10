[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / isRetriableError

# Function: isRetriableError()

> **isRetriableError**(`error`): `boolean`

Defined in: [lib/retry.ts:57](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L57)

判定错误是否可重试。与 Python 的 `_is_retriable` / Rust 的 `MailboxError::is_retriable` 一致：
显式标记 `isRetriable === true`，或 `code` 命中传输层重试白名单。

## Parameters

### error

`unknown`

## Returns

`boolean`
