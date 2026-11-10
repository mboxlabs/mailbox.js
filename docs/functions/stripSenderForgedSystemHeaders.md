[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / stripSenderForgedSystemHeaders

# Function: stripSenderForgedSystemHeaders()

> **stripSenderForgedSystemHeaders**(`headers`): `Record`\<`string`, `any`\>

Defined in: [packages/mailbox/src/lib/delivery.ts:261](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L261)

剥掉发送方自带的系统头（返回新对象，不改调用方那份）。

只在**发送边界**用一次（`Mailbox.post()`）：内核自己后面注入的那些不受影响。

## Parameters

### headers

`Record`\<`string`, `any`\> \| `undefined`

## Returns

`Record`\<`string`, `any`\>
