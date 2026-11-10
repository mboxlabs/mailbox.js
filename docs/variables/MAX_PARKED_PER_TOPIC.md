[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MAX\_PARKED\_PER\_TOPIC

# Variable: MAX\_PARKED\_PER\_TOPIC

> `const` **MAX\_PARKED\_PER\_TOPIC**: `100` = `100`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:124](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L124)

每个 topic 最多留多少条停放记录；超了淘汰最老的并**出声**（不静默丢）。
