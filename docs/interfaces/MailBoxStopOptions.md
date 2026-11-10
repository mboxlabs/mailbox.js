[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailBoxStopOptions

# Interface: MailBoxStopOptions

Defined in: [packages/mailbox/src/mailbox.ts:31](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/mailbox.ts#L31)

## Properties

### purge?

> `optional` **purge?**: `boolean`

Defined in: [packages/mailbox/src/mailbox.ts:36](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/mailbox.ts#L36)

关掉订阅后再丢弃各 provider 的积压消息（含 in-flight）。
默认 `false`：关闭通道不等于销毁数据。
