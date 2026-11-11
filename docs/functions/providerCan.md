[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / providerCan

# Function: providerCan()

> **providerCan**(`provider`, `operation`, `address?`): `boolean`

Defined in: [packages/mailbox/src/lib/capability.ts:110](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/capability.ts#L110)

内核判据：这个 provider 能不能做 `operation`。

用来替换所有「`typeof provider.x === 'function'`」式的探测——那种探测把「碰巧有这个方法」
当成「支持这个操作」，包装过的 provider、按配置关掉的能力都答错。

## Parameters

### provider

[`IMailboxProvider`](../interfaces/IMailboxProvider.md)

### operation

`string`

### address?

`URL`

## Returns

`boolean`
