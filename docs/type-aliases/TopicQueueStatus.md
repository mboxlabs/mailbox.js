[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / TopicQueueStatus

# Type Alias: TopicQueueStatus

> **TopicQueueStatus** = `object`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:98](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L98)

一个 topic 的队列状态（[MailMessageQueue.getStatus](../classes/MailMessageQueue.md#getstatus)）。

## Properties

### inFlightCount

> **inFlightCount**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:102](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L102)

已交给消费者、尚未 ack/nack 的份数。

***

### oldestOverdueMs

> **oldestOverdueMs**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:111](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L111)

最老那条过期租约已经过期多久（ms）；没有过期租约时为 0。

***

### oldestParkedMs

> **oldestParkedMs**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:120](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L120)

最老那条停放记录停了多久（ms）；没有停放时为 0。

***

### overdueInFlightCount

> **overdueInFlightCount**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:109](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L109)

在飞但**租约已到期**、还没被收回的份数。

回收是惰性的（无后台定时器，只有下一次 manualAck 取信才扫），所以一个僵死的消费者能把
过期租约永远挂在这里——这个数就是为了让它不再隐形。

***

### parkedCount

> **parkedCount**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:118](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L118)

**停放**的份数：已经判死（不再交给任何人）、但还没被真正丢弃的记录。

它们不在 `unreadCount` 里，也永远不会被 `dequeue` 交出来——只看得到、拿得出来。
没有这个数，运维就只能看到「没未读」，看不出「有一条判死的停在这儿」。

***

### unreadCount

> **unreadCount**: `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:100](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/MessageQueue.ts#L100)

还在队列里的份数——唯一能当“还没投出去”的数字。
