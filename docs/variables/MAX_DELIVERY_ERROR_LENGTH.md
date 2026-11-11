[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MAX\_DELIVERY\_ERROR\_LENGTH

# Variable: MAX\_DELIVERY\_ERROR\_LENGTH

> `const` **MAX\_DELIVERY\_ERROR\_LENGTH**: `300` = `300`

Defined in: [packages/mailbox/src/lib/delivery.ts:62](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/delivery.ts#L62)

死信记录里失败原因摘要的最大长度（跨三端一致，防止超长 body 把日志 / DLQ 撑爆）。
