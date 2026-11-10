[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / normalizeDisposition

# Function: normalizeDisposition()

> **normalizeDisposition**(`where?`): [`Disposition`](../type-aliases/Disposition.md)

Defined in: [packages/mailbox/src/lib/disposition.ts:16](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/disposition.ts#L16)

把调用方给的处置值规整成内核词汇。

空串 / 空白 = 手滑，不是「某种自定义处置」：按默认值处理，而不是抛错——
`ack('')` 与 `ack()` 该是同一件事。

## Parameters

### where?

`string`

## Returns

[`Disposition`](../type-aliases/Disposition.md)
