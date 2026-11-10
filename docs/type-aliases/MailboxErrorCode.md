[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxErrorCode

# Type Alias: MailboxErrorCode

> **MailboxErrorCode** = `"MBX_INVALID_ADDRESS"` \| `"MBX_INVALID_FETCH_OPTIONS"` \| `"MBX_INVALID_DEAD_LETTER_SUFFIX"` \| `"MBX_INVALID_DEAD_LETTER_NESTING"` \| `"MBX_UNSUPPORTED_CAPABILITY"` \| `"MBX_NO_PROVIDER"`

Defined in: [packages/mailbox/src/error.ts:5](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/error.ts#L5)

库内错误的错误码。跨语言端口（Python `MailboxError` / Rust `MailboxError`）按同样的码对齐，
调用方判断错误类型请用 `code` / `instanceof`，不要匹配 message —— message 是给人看的，会变。
