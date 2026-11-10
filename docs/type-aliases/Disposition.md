[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Disposition

# Type Alias: Disposition

> **Disposition** = [`CoreDisposition`](CoreDisposition.md) \| `string` & `object`

Defined in: [packages/mailbox/src/interfaces.ts:146](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L146)

一次交付的处置值。三个内核值 + provider 自己声明过的自定义值
（`string & {}` 只是为了让编辑器继续提示那三个值，不做限制）。
