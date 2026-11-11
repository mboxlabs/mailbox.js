[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / readSendId

# Function: readSendId()

> **readSendId**(`message?`): `string` \| `undefined`

Defined in: [packages/mailbox/src/lib/delivery.ts:277](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L277)

读「这一份信」的编号；没有就是 undefined（队列会退回按对象身份认这份）。

## Parameters

### message?

`unknown`

## Returns

`string` \| `undefined`
