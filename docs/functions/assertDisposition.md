[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / assertDisposition

# Function: assertDisposition()

> **assertDisposition**(`where`, `provider`, `address?`): `void`

Defined in: [packages/mailbox/src/lib/disposition.ts:36](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/disposition.ts#L36)

处置值合法吗？

三个内核词汇永远合法；其余值是 provider 自定义的，**必须由能力声明覆盖**
（`supports.has('disposition:<where>')`）。不认得就在处置发生**之前**报错——
不能先把消息处理掉再说「这个值我不认」，那样调用方既不知道有没有生效，也没法补救。

## Parameters

### where

[`Disposition`](../type-aliases/Disposition.md)

### provider

[`IMailboxProvider`](../interfaces/IMailboxProvider.md)

### address?

`URL`

## Returns

`void`
