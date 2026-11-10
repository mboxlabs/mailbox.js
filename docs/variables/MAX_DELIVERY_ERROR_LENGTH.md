[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MAX\_DELIVERY\_ERROR\_LENGTH

# Variable: MAX\_DELIVERY\_ERROR\_LENGTH

> `const` **MAX\_DELIVERY\_ERROR\_LENGTH**: `300` = `300`

Defined in: [packages/mailbox/src/lib/delivery.ts:62](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L62)

死信记录里失败原因摘要的最大长度（跨三端一致，防止超长 body 把日志 / DLQ 撑爆）。
