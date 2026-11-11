[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Disposition

# Type Alias: Disposition

> **Disposition** = [`CoreDisposition`](CoreDisposition.md) \| `string` & `object`

Defined in: [packages/mailbox/src/interfaces.ts:146](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L146)

一次交付的处置值。三个内核值 + provider 自己声明过的自定义值
（`string & {}` 只是为了让编辑器继续提示那三个值，不做限制）。
