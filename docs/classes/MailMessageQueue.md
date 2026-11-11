[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailMessageQueue

# Class: MailMessageQueue\<T\>

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:142](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L142)

A generic, in-memory message queue that supports topic-based queuing and manual acknowledgement.

This class provides a reliable queuing mechanism for producer-consumer patterns where consumers
might fail and need to retry messages. It features:
- Topic-based separation of queues.
- FIFO (First-In, First-Out) message delivery.
- Auto-acknowledgement mode (fire-and-forget).
- Manual acknowledgement mode, which places messages "in-flight" until they are explicitly
  acknowledged (`ack`) or negatively acknowledged (`nack`).
- Timeout-based requeueing for stale in-flight messages to prevent message loss.
- One disposition per handle: a stale (requeued) handle cannot settle the copy a newer consumer
  holds, and repeating `ack` / `nack` does not take effect twice.

## Type Parameters

### T

`T` *extends* `object`

The type of messages in the queue. Must have an `id` property of type string.

## Constructors

### Constructor

> **new MailMessageQueue**\<`T`\>(): `MailMessageQueue`\<`T`\>

#### Returns

`MailMessageQueue`\<`T`\>

## Methods

### ack()

> **ack**(`key`, `leaseId?`): `boolean`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:507](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L507)

Acknowledges a **copy**, permanently removing it from the in-flight state.

一次处置：同一个 handle 重复 `ack`（或 `ack` 之后再 `nack`）不会第二次生效。

#### Parameters

##### key

`string`

**份号**（这一份是谁）：由取信的 handle 自己传，或从 [locate](#locate) 里拿。
  传发送方写的消息 id **不会命中**（回 `false`）——那个名字可以重复，拿它定位就会
  默默结算到别人手里那一份（F7）。

##### leaseId?

`string`

这一份的第几次交出去（handle 自己传，或 `locate()` 结果里的 `leaseId`）。
  传了就只结算那一次租约：这一份被收回重投后，旧句柄对不上号，只能回 `false`。
  不传 = 结算这一份当前的租约（运维 / broker 式 provider 的口径）。

#### Returns

`boolean`

`true` = 真的结算了；`false` = 已经不在（重复处置 / 已被重投 / 已被丢弃）。

***

### clear()

> **clear**(`topic?`): `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:749](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L749)

清空队列状态：不传 `topic` 则清空所有 topic。

in-flight 的消息**也**会被丢弃：它同样是队列状态的一部分，只清「等待中」的那一半，
下一轮（或同进程的另一个消费者 / 另一个测试用例）还是会看到残留消息。
被丢弃的 in-flight 消息之后 `ack()` / `nack(requeue)` 都是 no-op —— 不会复活成幽灵消息。

#### Parameters

##### topic?

`string`

只清这个 topic；省略则清空全部。

#### Returns

`number`

被丢弃的消息数（含 in-flight），便于诊断与断言。

***

### clearParked()

> **clearParked**(`topic`, `predicate?`): `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:642](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L642)

排空停放区：把判死的记录真正丢掉。返回丢掉的份数。

这是停放唯一的出口（它们不进交付流，所以没有 ack 可用）。省略谓词 = 整条队列的停放记录
全清；给谓词 = 只清挑中的那几条。丢弃是**永久**的，所以调用方要么已经读过
（[listParked](#listparked)），要么就是在明确接受丢数据。

#### Parameters

##### topic

`string`

##### predicate?

(`message`) => `boolean`

#### Returns

`number`

***

### dequeue()

#### Call Signature

> **dequeue**(`topic`, `options`): [`SettlingAckable`](../type-aliases/SettlingAckable.md)\<`T`\> \| `null`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:264](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L264)

Dequeues a message from the front of a specific topic's queue.

In auto-ack mode (`manualAck: false`), it removes and returns the message.
In manual-ack mode (`manualAck: true`), it moves the message to an "in-flight" state
and returns an `Ackable` message with `ack` and `nack` methods.
Every manual-ack dequeue also sweeps this topic's *expired* leases back into the queue
(there is no background timer; see [getStatus](#getstatus)'s `overdueInFlightCount`).

##### Parameters

###### topic

`string`

The topic from which to dequeue a message.

###### options

Options for the dequeue operation.

###### ackTimeout?

`number` \| `null`

In manual-ack mode, how long **this** lease stays valid, in ms.
  It is fixed at handoff time and recorded on the lease: another consumer's `ackTimeout`
  can neither shorten it (an unexpired lease is never swept back) nor stretch it (an expired
  lease is swept back no matter how long the next caller asks for). Omitted (or negative /
  non-finite) falls back to [DEFAULT\_ACK\_TIMEOUT](../variables/DEFAULT_ACK_TIMEOUT.md); `0` or `null` means *this lease never
  expires* — it stays in-flight until its own handle acks or nacks it.

###### handoff?

(`message`) => `T`

交给消费者前的**改写**（可选）：比如给投递轮次 +1（`nextRoundCopy`）。
  改写后的副本就是交出去的那一份，也是存进 in-flight 的那一份：所以 `nack(requeue=true)`
  放回队列的也是它，否则轮次永远停在第一次取信时的值。只读快照（[peek](#peek)）不走这里。

###### manualAck

`true`

If true, enables manual acknowledgement mode. Defaults to false.

##### Returns

[`SettlingAckable`](../type-aliases/SettlingAckable.md)\<`T`\> \| `null`

An `Ackable` message in manual-ack mode, a regular message in auto-ack mode, or `null` if the queue is empty.

#### Call Signature

> **dequeue**(`topic`, `options?`): `T` \| `null`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:268](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L268)

Dequeues a message from the front of a specific topic's queue.

In auto-ack mode (`manualAck: false`), it removes and returns the message.
In manual-ack mode (`manualAck: true`), it moves the message to an "in-flight" state
and returns an `Ackable` message with `ack` and `nack` methods.
Every manual-ack dequeue also sweeps this topic's *expired* leases back into the queue
(there is no background timer; see [getStatus](#getstatus)'s `overdueInFlightCount`).

##### Parameters

###### topic

`string`

The topic from which to dequeue a message.

###### options?

Options for the dequeue operation.

###### handoff?

(`message`) => `T`

交给消费者前的**改写**（可选）：比如给投递轮次 +1（`nextRoundCopy`）。
  改写后的副本就是交出去的那一份，也是存进 in-flight 的那一份：所以 `nack(requeue=true)`
  放回队列的也是它，否则轮次永远停在第一次取信时的值。只读快照（[peek](#peek)）不走这里。

###### manualAck?

`false`

If true, enables manual acknowledgement mode. Defaults to false.

##### Returns

`T` \| `null`

An `Ackable` message in manual-ack mode, a regular message in auto-ack mode, or `null` if the queue is empty.

***

### drop()

> **drop**(`topic`, `message`): `boolean`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:680](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L680)

把**这一份**从队列里移除（`discard` 的落点）：不在队列里就返回 `false`，不谎报。

为什么需要它：`discard` 那句承诺是「这条消息不能再被交回给任何消费者」。
`nack(key, false)` 只处理**在飞**的那一份（带租约的那次交付）；还没交出去的未读副本
归这里。只处理一半，另一半就还会被下一个 `fetch` 取走——承诺等于没兑现。

去重与移除都按**哪一份**（份号）判：同 id 的另一封信不受影响。

#### Parameters

##### topic

`string`

队列键

##### message

`T`

要移除的那一份（用它的份号，不是它的 id）

#### Returns

`boolean`

`true` = 确实移除了；`false` = 队列里没有这一份（已经被取走 / 已经没了）

***

### enqueue()

> **enqueue**(`topic`, `message`): `void`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:222](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L222)

Adds a message to the end of a specific topic's queue.

这里**不**按 id 去重：每次 `post()` 交进来的都是一份新的信，同 id 只是发送方说
「我认为这是同一封」。要不要把重复的丢掉是发送边界的事（需要发送方显式声明、
并且当场告知），不是队列自己默默判定的事。

#### Parameters

##### topic

`string`

The topic to which the message will be added.

##### message

`T`

The message to enqueue.

#### Returns

`void`

***

### getStatus()

> **getStatus**(`topic`): [`TopicQueueStatus`](../type-aliases/TopicQueueStatus.md)

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:586](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L586)

Gets the current status of a topic's queue.

#### Parameters

##### topic

`string`

The topic to query.

#### Returns

[`TopicQueueStatus`](../type-aliases/TopicQueueStatus.md)

`unreadCount`（还在队列里）、`inFlightCount`（已交给消费者、还没 ack/nack）、
  `overdueInFlightCount`（在飞但**租约已到期**、还没被收回的份数）与
  `oldestOverdueMs`（最那条已经过期多久）。

只有 `unreadCount` 能当「还没投出去」；in-flight 的会在租约到期后回来，但**回收是惰性的**
（只有下一次 manualAck 取信才扫）。所以一个僵死的消费者可以把过期租约永远挂在在飞里 ——
`overdueInFlightCount` 就是为了让这种积压不再隐形（运维 / 健康检查该盯它）。
本方法是只读的：不会顺手回收、不刷新时间戳（与 [peek](#peek) 同理）。

***

### has()

> **has**(`messageId`): `boolean`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:727](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L727)

判断某个消息是否已在队列中等待或已被取走（in-flight）。按 id 问：同 id 有几份都算存在。

#### Parameters

##### messageId

`string`

#### Returns

`boolean`

***

### hasTopic()

> **hasTopic**(`topic`): `boolean`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:369](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L369)

这个 topic 在队列里有没有痕迹（等待中的消息或 in-flight）。
与 [has](#has)（按消息 id）不同：这是按 topic 的「存不存在」，用于 status 的 `exists`。

#### Parameters

##### topic

`string`

#### Returns

`boolean`

***

### listParked()

> **listParked**(`topic`, `limit?`): `T`[]

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:662](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L662)

只读：停放的那些记录（最新的在末尾）。读它不改任何状态。

#### Parameters

##### topic

`string`

##### limit?

`number`

#### Returns

`T`[]

***

### locate()

> **locate**(`messageId`): [`LocatedCopy`](../type-aliases/LocatedCopy.md)[]

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:464](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L464)

按发送方给的名字**查**账（只读）：这个名字可以重复，所以返回的是候选清单。

搜索按他们的名字，动手按我们发的 `key`：查到后拿 `key` 去 `ack` / `nack`。
不改动任何状态（不扫、不刷新活动时间、不动顺序）。

#### Parameters

##### messageId

`string`

#### Returns

[`LocatedCopy`](../type-aliases/LocatedCopy.md)[]

***

### nack()

> **nack**(`key`, `requeue`, `leaseId?`): `boolean`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:540](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L540)

Negatively acknowledges a **copy**, removing it from the in-flight state.
If `requeue` is true, the copy goes back to the front of **the queue it came from**
（topic 取自己在飞记录里存的，不是调用方当场报的那个）。

一次处置：重复 `nack`、或在 `ack` 之后的 `nack` 都不再生效（也不会把已确认的消息
退回队列）。上层要靠这个返回值区分“真的放弃了”与“这次根本没落定”，否则会重复
写死信记录。

#### Parameters

##### key

`string`

份号（见 [ack](#ack)）。

##### requeue

`boolean`

If true, the copy is re-added to the front of its own queue.

  **这个 flag 在 `3.0.0` 会被去掉**：那之后只有两个具名动作——
  `ack(key)` 结束这份拷贝（不再回来），`nack(key)` 把这份拷贝退回它自己那条队列。
  所以 `requeue` 省略时今天按「丢弃」处理（等价于 `ack(key)`），`3.0.0` 起同一个无参调用
  会改判成「退回」。带参数的调用在类型层就会被挡住，**省略参数的那一批挡不住**，
  故整个 2.x 对省略写法告警一次（行为不动）。要丢弃就写 `ack`，要退回就带上 flag。

##### leaseId?

`string`

第几次交出去（见 [ack](#ack)）：迟到的旧句柄不能把别人手里的租约退回队列。

#### Returns

`boolean`

`true` = 处置真的落定；`false` = 重复处置 / 已被重投 / 已被丢弃。

***

### park()

> **park**(`topic`, `message`, `reason`): `void`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:621](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L621)

停放一份**判死**的记录：不进队列、不会被 `dequeue` 交出来，只在 `getStatus` 里数得出来、
在 [listParked](#listparked) 里读得出来。

上限 [MAX\_PARKED\_PER\_TOPIC](../variables/MAX_PARKED_PER_TOPIC.md)：超了就淘汰最老的，并 `console.warn` 一条——
停放区自己也不能变成静默丢弃的洞。

#### Parameters

##### topic

`string`

##### message

`T`

##### reason

`string`

#### Returns

`void`

***

### peek()

> **peek**(`topic`, `limit?`): `T`[]

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:353](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L353)

【只读】看一眼队列头部最多 `limit` 条消息，**不**改动任何投递状态。

诊断 / 审计需要「看一眼但不消费」。在这之前最接近的做法是 `fetch(addr, { manualAck: true })`
然不 ack（issue#4）：那会把消息弄进 in-flight（默认 30s 后重投），既不是只读，
也会干扰正常消费者的 `unreadCount` / `inFlightCount`。

保证：
- 不出队、不建 in-flight、不动 stale 扫描、不改任何时间戳；
- 返回副本（见 `copyForPeek`），调用方改不到队列里的对象；
- 只涵盖**等待中**的消息；in-flight（已被消费者取走、尚未 ack）不在快照里 ——
  它属于那个消费者，只能在 `getStatus().inFlightCount` 里看到。

#### Parameters

##### topic

`string`

要快照的 topic。

##### limit?

`number`

最多返回几条；省略则整个队列。必须是**非负整数**（或 `Infinity`）。

#### Returns

`T`[]

按 FIFO 顺序的消息副本数组；队列为空时是空数组（不是 `null`）。

#### Throws

`limit` 非法时抛出。

***

### requeue()

> **requeue**(`topic`, `message`): `boolean`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:708](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L708)

Adds a message back to the front of its queue. Used for requeueing.

去重是按**哪一份**判的，不是按 id：同一份信已经在该 topic 队列里、或已经被某个消费者取走
（in-flight）时，不再插入副本。一个地址有多个订阅者时，每个失败的订阅者都会触发一次
nack(requeue)；不去重就会在队列里留下 N 份同一封信（实测：2 个订阅者失败 → `unreadCount` 为 2）。

但**同 id 的另一份信完全不干扰这里**：那是另一封信，它有自己的账。按 id 抑制会把它的回队
当成重复而吞掉 —— 消息既不在队列、也不在死信，零痕迹（F7）。

#### Parameters

##### topic

`string`

The topic of the queue.

##### message

`T`

The message to requeue.

#### Returns

`boolean`

true 如果消息确实回到队列；false 如果因为**这一份已在队列 / 已在飞**而跳过。

***

### sweepExpired()

> **sweepExpired**(`topic`): `number`

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:811](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L811)

把该 topic 上**租约已到期**的在飞收回队列。这是回收机制，用来在消费者崩掉时不丢消息。

到期与否只看每条租约自己的 `expiresAt`（取走那一刻定下的）。调用方的 timeout 不参与：
它既不提前接管未到期的租约，也不拖后已过期的租约。

两个调用入口：① manualAck 取信时顺手扫（惰性）；② **显式**调用（`Mailbox.recover()` 或
provider 的 opt-in 定时器）——后者就是为了“再没人来取信”那种topic（最后一个消费者崩了）。

#### Parameters

##### topic

`string`

要扫的 topic。

#### Returns

`number`

实际收回了几份（幂等：再扫一次就是 0）。

***

### topics()

> **topics**(): `string`[]

Defined in: [packages/mailbox/src/lib/MessageQueue.ts:385](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/MessageQueue.ts#L385)

当前有消息（等待中或 in-flight）的 topic 列表，按字典序排序（快照与测试断言需要确定性）。

#### Returns

`string`[]
