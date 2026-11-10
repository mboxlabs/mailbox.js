[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / isCustomDisposition

# Function: isCustomDisposition()

> **isCustomDisposition**(`where`): `boolean`

Defined in: [packages/mailbox/src/lib/disposition.ts:65](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/disposition.ts#L65)

自定义处置（既不是 `handled` 也不是 `unhandled` / `discard`）。

只有 provider 声明过才会走到这里；它把处置直接交给句柄自己的 `ack(where)`，
因为「这个值意味着什么」是 provider 的协议知识，内核不参与。

## Parameters

### where

[`Disposition`](../type-aliases/Disposition.md)

## Returns

`boolean`
