[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / PeekFetchOptions

# Interface: PeekFetchOptions

Defined in: [packages/mailbox/src/interfaces.ts:199](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L199)

`fetch()` 的只读快照形式（issue#4）：返回副本，不出队、不建 in-flight、不动活动时间。

返回总是**数组**（空队列是 `[]`），与单条取回的 `MailMessage | null` 刻意不同：
只读快照没有「取不到」这种状态，只有「看到几条」。

## Indexable

> \[`name`: `string`\]: `any`

## Properties

### limit?

> `optional` **limit?**: `number`

Defined in: [packages/mailbox/src/interfaces.ts:202](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L202)

最多看几条；省略（或 `Infinity`）看整个队列。必须是非负整数。

***

### peek

> **peek**: `true`

Defined in: [packages/mailbox/src/interfaces.ts:200](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L200)
