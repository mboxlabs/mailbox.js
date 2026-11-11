[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MemoryEventBus

# Class: MemoryEventBus

Defined in: [packages/mailbox/src/providers/memory.ts:115](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L115)

模拟消息传递的内存总线（一个“服务端”）：每个实例持有一份 topic 队列 + 订阅表。

实例边界（issue#3）：
- `new MemoryEventBus()` —— 私有总线，只属于持有它的 `MemoryProvider`。需要“每个 Mailbox
  一套互不相干的 `mem:` 状态”（宿主 + 插件、测试隔离）就用这个。
- `MemoryEventBus.getInstance(scope?)` —— 按 scope 共享的进程级单例。不带 `scope` 就是历史上
  那个全局单例（保持现有“模拟服务端”用法不变）。

注意：隔离靠“换 bus 实例”，不靠“换地址”——`mem:` 地址空间在同一个 bus 内是全局的，
没有租户前缀，跨实例串台就是同一个 bus 上 topic 同名。

## Constructors

### Constructor

> **new MemoryEventBus**(`scope?`): `MemoryEventBus`

Defined in: [packages/mailbox/src/providers/memory.ts:126](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L126)

#### Parameters

##### scope?

`string` = `DEFAULT_MEMORY_SCOPE`

所属 scope。仅用于诊断（`status()` / 日志里能看出这份状态是谁的）。

#### Returns

`MemoryEventBus`

## Properties

### scope

> `readonly` **scope**: `string` = `DEFAULT_MEMORY_SCOPE`

Defined in: [packages/mailbox/src/providers/memory.ts:126](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L126)

所属 scope。仅用于诊断（`status()` / 日志里能看出这份状态是谁的）。

## Methods

### ack()

> **ack**(`key`, `leaseId?`): `boolean`

Defined in: [packages/mailbox/src/providers/memory.ts:251](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L251)

结算**一份**在飞的副本（确认完成）。

#### Parameters

##### key

`string`

份号（系统发的 `mbx-send-id`），来自取信的 handle 或 [locate](#locate)。

##### leaseId?

`string`

这一份的第几次交出去（[locate](#locate) 的 `leaseId`）：传了就只结算那一次租约。
  传发送方写在信上的消息 id **不会命中**（回 `false`）：那个名字可以重复，
  拿它定位就会默默结算到别人手里那一份。

#### Returns

`boolean`

`true` = 这次处置真的落定；`false` = 消息已不在 in-flight（重复处置 / 已被重投）。

***

### clear()

> **clear**(`topic?`): `number`

Defined in: [packages/mailbox/src/providers/memory.ts:301](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L301)

丢弃队列里的消息（含 in-flight）并抹掉对应的活动时间；不传 `topic` 则清掉全部。

**不动订阅表**：订阅是消费者主动建立的意图，拆它的是 `unsubscribe()` / `close()`。
在 `clear()` 里顺手拆订阅，会让 provider 侧的 `Subscription` 对象变成“报 active 但
再也收不到消息”的僵尸。需要拆订阅就关掉持有它的 `Mailbox` / provider。

#### Parameters

##### topic?

`string`

只清这个 topic；省略则清空整份总线状态。

#### Returns

`number`

被丢弃的消息数（含 in-flight）。

***

### clearParked()

> **clearParked**(`topic`, `predicate?`): `number`

Defined in: [packages/mailbox/src/providers/memory.ts:419](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L419)

排空停放区（永久丢弃）。返回丢掉的份数。

#### Parameters

##### topic

`string`

##### predicate?

(`message`) => `boolean`

#### Returns

`number`

***

### enqueue()

> **enqueue**(`topic`, `message`): `void`

Defined in: [packages/mailbox/src/providers/memory.ts:328](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L328)

追加到队尾（**不是**回队）：回队（`requeue`）把消息放回队头重新参与投递，
归档（死信）是把已经判死刑的消息放到另一条队列里等人工 / 补偿处理，
不该插到别人前面。同时刷活动时间，使死信 topic 在 `status()` 里是 `exists: true`。

#### Parameters

##### topic

`string`

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`void`

***

### fetchAndForget()

> **fetchAndForget**(`topic`): [`MailMessage`](../interfaces/MailMessage.md) \| `undefined`

Defined in: [packages/mailbox/src/providers/memory.ts:213](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L213)

Fetches and removes a message from the queue (for auto-acknowledgment).
交出去也算一轮：用 `handoff` 给 `mbx-round` +1（与基类在订阅侧的 +1 同一套语义）。

#### Parameters

##### topic

`string`

The topic to fetch a message from.

#### Returns

[`MailMessage`](../interfaces/MailMessage.md) \| `undefined`

The message, or undefined if the queue is empty.

***

### fetchForAck()

> **fetchForAck**(`topic`, `options?`): [`SettlingAckable`](../type-aliases/SettlingAckable.md)\<[`MailMessage`](../interfaces/MailMessage.md)\> \| `undefined`

Defined in: [packages/mailbox/src/providers/memory.ts:228](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L228)

Fetches a message for manual acknowledgment, moving it to the in-flight state.
顺手把这个 topic 上**已到期**的租约收回队头（扫的是每条租约自己的到期时刻，不是本次传的时长）。
交给消费者时同样给 `mbx-round` +1；存进 in-flight 的是打戳副本，所以 `nack(true)` 放回
队列的那一份带着轮次（否则拉取侧数不出“已经被取了几次”，provider 就无法封顶）。

#### Parameters

##### topic

`string`

The topic to fetch a message from.

##### options?

###### leaseTimeout?

`number` \| `null`

**这份租约**的时长（ms）；`0`/`null` = 永不过期，缺省 = 默认租约。
  旧名 `staleTimeout` 已改：它不是“清扫用的阈值”（那条不归调用者管），而是这次取信的租期。

#### Returns

[`SettlingAckable`](../type-aliases/SettlingAckable.md)\<[`MailMessage`](../interfaces/MailMessage.md)\> \| `undefined`

The message, or undefined if the queue is empty.

***

### getStatus()

> **getStatus**(`topic`): `object`

Defined in: [packages/mailbox/src/providers/memory.ts:372](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L372)

Gets the current status of a topic.

#### Parameters

##### topic

`string`

The topic to get the status for.

#### Returns

`object`

An object containing status information. `exists` 区分「不存在」与「空闲」，
         `lastActivityTime` 没活动记录时是 `null`（不是 `undefined`，否则 JSON 序列化后整个字段消失）。

##### exists

> **exists**: `boolean`

##### inFlightCount

> **inFlightCount**: `number`

##### lastActivityTime

> **lastActivityTime**: `string` \| `null`

##### oldestOverdueMs

> **oldestOverdueMs**: `number`

##### oldestParkedMs

> **oldestParkedMs**: `number`

##### overdueInFlightCount

> **overdueInFlightCount**: `number`

##### parkedCount

> **parkedCount**: `number`

##### subscriberCount

> **subscriberCount**: `number`

##### unreadCount

> **unreadCount**: `number`

***

### knows()

> **knows**(`topic`): `boolean`

Defined in: [packages/mailbox/src/providers/memory.ts:339](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L339)

这份总线认不认这个 topic：有过订阅、有过活动记录，或现在/曾有未结算的消息。

这是 `status().exists` 的依据。“地址不存在”与“地址空闲但确实存在”在诊断上是两件事
（issue#4）：前者 `exists: false` / `state: 'unknown'`，后者 `exists: true` / `state: 'online'`。

#### Parameters

##### topic

`string`

#### Returns

`boolean`

***

### listParked()

> **listParked**(`topic`, `limit?`): [`MailMessage`](../interfaces/MailMessage.md)[]

Defined in: [packages/mailbox/src/providers/memory.ts:414](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L414)

只读：某条队列上停放着的记录。

#### Parameters

##### topic

`string`

##### limit?

`number`

#### Returns

[`MailMessage`](../interfaces/MailMessage.md)[]

***

### listTopics()

> **listTopics**(): `string`[]

Defined in: [packages/mailbox/src/providers/memory.ts:349](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L349)

这份总线上所有“认得”的 topic（订阅过 / 有过活动 / 有消息），按字典序排序。
供 `Mailbox#status()`（无参）做全量快照。

#### Returns

`string`[]

***

### locate()

> **locate**(`messageId`): [`LocatedCopy`](../type-aliases/LocatedCopy.md)[]

Defined in: [packages/mailbox/src/providers/memory.ts:273](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L273)

按发送方给的名字**查**账（只读）：同名的几份全部列出来，各自带着份号与现在状态。

搜索可以按他们的名字（`order-42` 是人认得的），**动手必须按返回的 `key`**。
不改动任何状态：不扫过期、不刷新活动时间。

#### Parameters

##### messageId

`string`

#### Returns

[`LocatedCopy`](../type-aliases/LocatedCopy.md)[]

***

### nack()

> **nack**(`key`, `requeue`, `leaseId?`): `boolean`

Defined in: [packages/mailbox/src/providers/memory.ts:263](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L263)

结算**一份**在飞的副本（否定处置），可选回队。

#### Parameters

##### key

`string`

份号（见 [ack](#ack)）。

##### requeue

`boolean`

If true, the copy goes back to the front of **the queue it came from**
  （topic 取在飞记录里存的那一个，不是调用方当场报的）。

##### leaseId?

`string`

#### Returns

`boolean`

`true` = 处置真的落定；`false` = 重复处置 / 已被重投 / 已被丢弃。

***

### park()

> **park**(`topic`, `message`, `reason`): `void`

Defined in: [packages/mailbox/src/providers/memory.ts:409](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L409)

停放一份判死记录（不进交付流）。见 `MailMessageQueue.park`。

#### Parameters

##### topic

`string`

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### reason

`string`

#### Returns

`void`

***

### peek()

> **peek**(`topic`, `limit?`): [`MailMessage`](../interfaces/MailMessage.md)[]

Defined in: [packages/mailbox/src/providers/memory.ts:317](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L317)

【只读】取一份队列快照（副本），不出队、不建 in-flight、不刷活动时间。

#### Parameters

##### topic

`string`

要看的 topic。

##### limit?

`number`

最多看几条；省略 = 整个队列。

#### Returns

[`MailMessage`](../interfaces/MailMessage.md)[]

***

### publish()

> **publish**(`topic`, `message`): `Promise`\<`void` \| [`DeliveryResult`](../interfaces/DeliveryResult.md)\>[] \| `null`

Defined in: [packages/mailbox/src/providers/memory.ts:181](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L181)

发布一条消息：有订阅者时交给订阅回调，否则入队等待 fetch 取回。

#### Parameters

##### topic

`string`

The topic to publish the message to.

##### message

[`MailMessage`](../interfaces/MailMessage.md)

The message to publish.

#### Returns

`Promise`\<`void` \| [`DeliveryResult`](../interfaces/DeliveryResult.md)\>[] \| `null`

广播时返回每次投递的结算 promise（供发送侧做结算判定，见 `_send`）；
  入队时返回 `null`。注意广播仍是 fire-and-forget：这里不 await，`post()` 也不会
  等订阅回调跑完。

***

### reclaimExpired()

> **reclaimExpired**(`topic`): `number`

Defined in: [packages/mailbox/src/providers/memory.ts:362](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L362)

显式回收这个 topic 上已到期的租约（`Mailbox#recover()` 往下走的那条路）。

#### Parameters

##### topic

`string`

#### Returns

`number`

收回了几份（幂等）。

***

### requeue()

> **requeue**(`topic`, `message`): `boolean`

Defined in: [packages/mailbox/src/providers/memory.ts:286](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L286)

Puts a message back at the front of a topic's queue without going through the
in-flight state. Used when a subscriber callback fails with a retriable error.

#### Parameters

##### topic

`string`

The topic the message belongs to.

##### message

[`MailMessage`](../interfaces/MailMessage.md)

The message to requeue.

#### Returns

`boolean`

`true` = 确实回了队；`false` = **就是这一份**已经在队列里或已在别人手里（重复回队）。
  注意不是“id 重复”：同 id 的另一份信一定会回队。

***

### subscribe()

> **subscribe**(`topic`, `listener`): () => `void`

Defined in: [packages/mailbox/src/providers/memory.ts:155](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L155)

Subscribes a listener to a specific topic.

#### Parameters

##### topic

`string`

The topic (canonical address) to subscribe to.

##### listener

`Listener`

The callback function to execute when a message is received.

#### Returns

A function that, when called, unsubscribes the listener.

同步返回是有意的，即使 `IMailboxProvider#subscribe()` 返回 Promise：这是进程内的派发总线，
没有 broker 要等，「已生效」在这层就是「已登记」。把它也改成 Promise 只是把破坏性改动
抄进私有实现。

() => `void`

***

### getInstance()

> `static` **getInstance**(`scope?`): `MemoryEventBus`

Defined in: [packages/mailbox/src/providers/memory.ts:136](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L136)

取（或创建）某个 scope 的共享总线。不带参数 = 历史行为：进程级唯一单例。

注册表不会自动回收：动态生成的 scope 名（带时间戳、每次新建）会一直占着那份状态。
需要“用完就丢”的场景用私有总线（[MemoryProvider.createIsolated](MemoryProvider.md#createisolated)）。

#### Parameters

##### scope?

`string` = `DEFAULT_MEMORY_SCOPE`

命名空间标识；同 scope 拿到同一份队列与订阅表，不同 scope 互不可见。

#### Returns

`MemoryEventBus`
