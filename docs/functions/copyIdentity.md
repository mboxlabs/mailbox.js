[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / copyIdentity

# Function: copyIdentity()

> **copyIdentity**(`message`, `tagOf?`): `string`

Defined in: [packages/mailbox/src/lib/delivery.ts:352](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L352)

记账用的“哪一份”：系统发的份号优先，没发号退到对象身份（同一对象 = 同一份）。
与队列侧 `MailMessageQueue.copyKeyOf` 同一口径；降级到对象身份时只在内存里成立，
跳端序列化后活不下来（所以标准路径必须发号）。

## Parameters

### message

`unknown`

### tagOf?

(`o`) => `string`

## Returns

`string`
