[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / normalizePeekLimit

# Function: normalizePeekLimit()

> **normalizePeekLimit**(`limit`): `number` \| `undefined`

Defined in: [packages/mailbox/src/lib/utils.ts:132](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/utils.ts#L132)

校验并归一 `peek` 的 `limit`。

`undefined` / `Infinity` 表示「整个队列」；其余必须是**非负整数**。
负数、`NaN`、小数都会让「取几条」变成含糊语义，直接拒绝。

## Parameters

### limit

`number` \| `undefined`

调用方传入的 limit。

## Returns

`number` \| `undefined`

归一后的 limit；`undefined` 表示不限条数。

## Throws

取值非法。
