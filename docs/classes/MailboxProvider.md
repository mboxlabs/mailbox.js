[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxProvider

# Abstract Class: MailboxProvider

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:130](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L130)

Provider 的基类——**实现新 provider 请从这里继承**（规范见 `wiki/delivery-semantics.md` §1）。

基类拥有那些第三方最容易做错、又最难自己做对的记账：发送边界发 `mbx-send-id` 与系统头、投递级
结算与重试、广播的 barrier、处置与尝试记账、能力探测，以及**关闭时拆掉全部订阅**。子类要填的是
`_xxx()` 那一层钩子：`_send()` / `_subscribe()` / `_fetch()` / `_peek()` / `_ack()` / `_nack()` /
`_init()` / `_close()` / `_status()`。

直接实现 [IMailboxProvider](../interfaces/IMailboxProvider.md) 不是受支持的写法：接口只是内核调你的结构面，上面那些记账一分都
不在里面，而内核不会检查（`registerProvider()` 只读 `protocol`），也不会代劳。写错的形状实测过：
关闭时漏拆订阅 ⇒ 监听器留在 broker 上、句柄照报 `active`、`stop()` → `start()` 后一份信两次副作用。

## Extended by

- [`MemoryProvider`](MemoryProvider.md)

## Implements

- [`IMailboxProvider`](../interfaces/IMailboxProvider.md)
- [`CapabilityDeclaration`](../interfaces/CapabilityDeclaration.md)

## Constructors

### Constructor

> **new MailboxProvider**(`protocol`, `retry?`): `MailboxProvider`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:210](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L210)

#### Parameters

##### protocol

`string`

##### retry?

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null`

#### Returns

`MailboxProvider`

## Properties

### broadcastDeliveries

> `protected` `readonly` **broadcastDeliveries**: `boolean` = `false`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:171](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L171)

这个 provider 的 `subscribe` 是不是广播（一条消息投递给 N 个订阅者）。

广播型（`true`，如 MemoryProvider）：单次投递失败**不再**自动 `nack(requeue)` 整条消息 ——
已成功订阅者的副作用不该再执行一次。回不回队由发送侧的结算 barrier 按
`shouldRequeueAfterBroadcast()` 统一判定（全部投递都失败才回队）。

队列 / 传输型（`false`，默认）：每次投递对应 broker 里的一份 ack，保持原有
per-delivery `nack` 行为，交给传输层重投或死信。

***

### deliverySettleTimeout

> **deliverySettleTimeout**: `number` = `DEFAULT_DELIVERY_SETTLE_TIMEOUT`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:195](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L195)

单次投递尝试的结算超时（毫秒）。`0` / 负数关闭（调用方自己负责长任务）。
见 [DEFAULT\_DELIVERY\_SETTLE\_TIMEOUT](../variables/DEFAULT_DELIVERY_SETTLE_TIMEOUT.md)。

***

### protocol

> `readonly` **protocol**: `string`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:131](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L131)

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`protocol`](../interfaces/IMailboxProvider.md#protocol)

***

### retry

> `protected` **retry**: `Required`\<[`RetryPolicy`](../interfaces/RetryPolicy.md)\> \| `null` = `null`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:159](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L159)

订阅失败后的重试策略。`null` 表示不重试（默认）：可重试失败只把消息退回队列，
由 `fetch()` 兜底。重试是 opt-in 的，因为 AMQP / SQS 这类传输自带重投与死信，
库再重投就是双重投递。

***

### subscriptions

> `protected` `readonly` **subscriptions**: `Map`\<`string`, `ManagedSubscription`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:132](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L132)

## Accessors

### pendingDeliveryCount

#### Get Signature

> **get** `protected` **pendingDeliveryCount**(): `number`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:1383](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L1383)

当前尚未结算的投递数量（诊断 / 测试用）。

##### Returns

`number`

***

### supports

#### Get Signature

> **get** **supports**(): `Set`\<`string`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:240](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L240)

这个 provider 现在会做什么（**运行期可变的数据**，见 D6）。

初始值由已实现的可选钩子推导（`_status` → `status`、`_peek` → `peek`…），子类可以在
[declareCapabilities](#declarecapabilities) 里加自己协议独有的能力，也可以随时直接改这个集合：

```ts
provider.supports.add('disposition:answered');   // 我认这个处置值，而且我知道怎么处理
provider.supports.delete('peek');               // 这个实例现在不让人只读了
```

规矩：**未声明 = 没有这个操作**；谁给 provider 注入能力（包装、AoP、配置开关），谁就负
责更新声明。声明与实现漂移不会报错，所以诊断面、重试门限、conformance 都以声明为准。

##### Returns

`Set`\<`string`\>

可变的能力集合。读它 = 看这个 provider 现在能做什么；改它 = 声明变了。

#### Implementation of

[`CapabilityDeclaration`](../interfaces/CapabilityDeclaration.md).[`supports`](../interfaces/CapabilityDeclaration.md#supports)

## Methods

### ~~\_ack()?~~

> `protected` `optional` **\_ack**(`message`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:737](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L737)

[Subclass Responsibility - Optional] Provides implicit ACK capability for the `subscribe` mode.
For providers that don't support ACK (like in-memory), this can be an empty async function.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

#### Deprecated

用 [\_settle](#_settle)(message, 'handled')。它在 `v1.0.0` 就发布了，所以 2.x 里
  继续支持（基类会把 `handled` 转给它），拆包的 `3.0.0` 删。

`message` 是**本次投递的副本**（浅拷贝，带 `mbx-attempt` / `mbx-round`，开了重试还有
`mbx-max-attempts`），与交给订阅回调的是同一份；**不是** `_send` 那个对象，也不是 `post()`
的入参。重试链里每次尝试换一份新副本，只有当次尝试的回调 / `_ack` / `_nack` 拿到同一个对象。

因此 provider **不得按对象同一性记账**（`Map<MailMessage, handle>` / `WeakMap` / `set.has(message)`）：
查不到不会抛错，只会静默不 ack，消息停在 broker 里等 visibility timeout 后无限重投。
记账用 `message.id`（消息级）或 broker 自己的投递句柄；投递级身份（`subscriptionId + messageId`）
只在 `DeliveryResult.deliveryId`（死信钩子的 `failed[]` 里）拿得到。

浅拷贝的边界：`headers` 是新对象（改它不回落到 `_send` 那份），`body` / `meta` / `from` / `to`
仍是同一引用（改了会串到发送方）。

***

### \_close()?

> `protected` `optional` **\_close**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:699](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L699)

[Subclass Responsibility - Optional] Specific closing logic.

#### Returns

`Promise`\<`void`\>

***

### \_deliverToLocalSubscription()

> `protected` **\_deliverToLocalSubscription**(`subscriptionId`, `message`): `Promise`\<[`DeliveryResult`](../interfaces/DeliveryResult.md)\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:846](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L846)

把一条消息投递给本 provider 的某个**本地订阅者**，走与 `subscribe` 完全相同的投递记账
（隐式 ack、错误处理、重试、结算）。生产者型 provider（自己组装消息再分发）必须走这里，
不要直接调用户回调 —— 那样这次投递没人记账，失败也不会回队。

#### Parameters

##### subscriptionId

`string`

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<[`DeliveryResult`](../interfaces/DeliveryResult.md)\>

***

### \_fetch()

> `abstract` `protected` **\_fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:682](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L682)

[Subclass Responsibility] Performs the actual message fetching logic.
基类不会把 `peek: true` 送进这里（只读快照走 `_peek`），实现无需考虑只读分支。

#### Parameters

##### address

`URL`

##### options?

[`FetchOptions`](../interfaces/FetchOptions.md)

#### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

***

### \_handleDeliveryError()

> `protected` **\_handleDeliveryError**(`subscriptionId`, `message`, `key`, `error`): `void`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:919](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L919)

订阅回调抛错时的统一处理（投递级）。

默认（`retry === null`）：可重试 → 结算 `retriable`；不可重试 → 结算 `fatal`（放弃）。
开启重试后：可重试且未超上限 → 只重投给失败的那个订阅者（不广播给其他已成功的订阅者，
否则它们的副作用会被执行两次）；超上限 → 清零台账、调 `_onRetryExhausted`，再结算 `retriable`。
注意：“预算耗尽”不是“放弃”——消息仍会回队，由 `fetch()` 兜底。

广播型 provider 不在这里 `nack`：整条消息回不回队由发送侧在所有投递结算后统一判定
（见 `shouldRequeueAfterBroadcast`）。没接 barrier 的广播 provider 由
`_fallbackForMissingBarrier` 兜底（整条回队 + 告警），否则可重试失败就静默消失了。
非广播（队列 / 传输）型 provider 每次投递对应 broker 的一次 ack：可重试失败
`nack(requeue=true)`；不可重试失败 `nack(requeue=false)`——不发这个信号，broker 就会在
visibility timeout 后把同一条坏消息无限重投（见 \_giveUpDelivery）。

#### Parameters

##### subscriptionId

`string`

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### key

`string`

##### error

`any`

#### Returns

`void`

***

### \_isRetriable()

> `protected` **\_isRetriable**(`error`): `boolean`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:1387](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L1387)

#### Parameters

##### error

`any`

#### Returns

`boolean`

***

### ~~\_nack()?~~

> `protected` `optional` **\_nack**(`message`, `requeue`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:765](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L765)

[Subclass Responsibility - Optional] Provides NACK capability.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### requeue

`boolean`

#### Returns

`Promise`\<`void`\>

#### Deprecated

用 [\_settle](#_settle)(message, 'unhandled' | 'discard')。布尔参数在 `v1.0.0` 就发布了，
  所以 2.x 里它仍是完整入口（`requeue = true` ≡ `unhandled`，`false` ≡ `discard`），拆包的 `3.0.0` 删。

这是 provider 表达「放弃」的**唯一**入口，两个参数合起来就是内核的全部判定：
- `requeue = true`：回队（回到哪个位置、重投几次，由 provider 定，内核不管）；
- `requeue = false`：**放弃**——永久移出队列；丢弃还是落 DLQ 由 provider 定。

`message` 是**本轮结算后的投递副本**（带 `mbx-attempt` / `mbx-round`）：回队时它带着
「本轮试了几次 / 这是第几轮」落回队列，`requeue=false` 落 DLQ 时同样有次数可写。
例外照实说：广播 barrier 在**没记到投递副本**时会退回 `_send` 那份（没有任何计数）——
`_send` 接了 barrier 但投递没走 `_startDelivery` / `_deliverToLocalSubscription`、同 id 并发广播时
后落定的那个 barrier、或副本表撞上 `MAX_SETTLED_COPIES` 被淘汰。所以 provider 侧别假设头一定在。

与 [\_ack](#_ack) 同理：这是副本，**不能按对象同一性记账**（用 `message.id` 或 broker 句柄）。

广播型 provider 里它只会在**广播全部投递都结算之后**被调用一次（由发送侧的结算判定决定
`requeue` 与否），不会再在每个订阅者失败时各回队一次。队列 / 传输型 provider 里它按投递
调用：可重试失败 `requeue = true`，不可重试失败 `requeue = false`（先永久移出队列，
再走 `_onDeliveryDeadLettered`，见 wiki/mailbox-arch.md 里「先 nack 后 DLQ」的顺序）。

不实现这个钩子（基类会告警一次）= 内核的回队 / 放弃决定落空：消息停在 broker 把它
放的地方，通常就是无限重投。

***

### \_onDeliveryDeadLettered()?

> `protected` `optional` **\_onDeliveryDeadLettered**(`message`, `failed`): `void` \| `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:1004](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L1004)

[Subclass Responsibility - Optional] 死信钩子：投递被**放弃**（不回队）时用。

触发时机（两类 provider 都触发）：
- 广播型：全部投递都不可重试，或部分失败（已有订阅者成功，失败的那些不回队）——
  在 `nack(requeue)` **之后**调用；
- 队列 / 传输型：单次投递不可重试失败——在 `nack(message, false)` **之后**调用
  （先永久移出队列，再落 DLQ，见 wiki/mailbox-arch.md）。不回队是为了不把已成功者
  处理过的消息再投一次，代价是失败的投递从此隐形——这个钩子就是补上那个可观测性缺口。

内核只发信号，不知道也不关心你往哪写：`<topic>/_dlq`、外部 DLQ、日志都行。
`message` 是本轮结算后的投递副本（带 `mbx-attempt` / `mbx-round`；广播 barrier 没记到副本时
退回不带计数的 `_send` 那份），`failed[].attempts`
是各自那条重试链的次数。`failed[].deliveryId` 是投递级身份——副本会换，`deliveryId` 不会，
所以要按投递记账就认它，不要按对象同一性。`MemoryProvider#enableDeadLetterQueue()` 是一个可参考的接法。
钩子自己抛错 / 返回 rejected promise 不会吞掉回队 / 丢弃判定，错误会被记录。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### failed

readonly [`DeliveryResult`](../interfaces/DeliveryResult.md)[]

#### Returns

`void` \| `Promise`\<`void`\>

***

### \_onRetryExhausted()?

> `protected` `optional` **\_onRetryExhausted**(`message`, `attempts`): `void` \| `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:985](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L985)

[Subclass Responsibility - Optional] 重试次数耗尽时的钩子（例如告警）。
若这次广播没有任何订阅者成功，消息随后仍会退回队列，由 `fetch()` 兜底——耗尽 ≠ 放弃。
钩子自己抛错 / 返回 rejected promise 不会打断处置判定（回队照常），只会被记录。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### attempts

`number`

#### Returns

`void` \| `Promise`\<`void`\>

***

### \_peek()?

> `protected` `optional` **\_peek**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:694](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L694)

[Subclass Responsibility - Optional] 只读快照：返回队列头部消息的**副本**，
不出队、不建 in-flight、不改活动时间。不实现的 provider 在 `fetch({ peek: true })` 时
会收到 [UnsupportedCapabilityError](UnsupportedCapabilityError.md)，而不是被静默降级成普通 fetch。

#### Parameters

##### address

`URL`

##### options?

###### limit?

`number`

#### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

***

### \_send()

> `abstract` `protected` **\_send**(`message`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:661](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L661)

[Subclass Responsibility] Performs the actual sending logic.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

***

### \_settle()?

> `protected` `optional` **\_settle**(`message`, `where`): `Promise`\<`boolean` \| `void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:716](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L716)

[Subclass Responsibility - Optional] 处置一次交付（新入口，取代 [\_ack](#_ack) / [\_nack](#_nack)）。

`where` 是内核词汇：
- `handled`：这一份到此为止，不留痕；
- `unhandled`：交回队列，还会再交出去；
- `discard`：结束它，并按这个协议的规矩**善后**（死信 / bounce / 打标记——做什么由协议定）。

与已发布钩子的关系：没接 `_settle` 的子类继续走 [\_ack](#_ack) / [\_nack](#_nack)（基类转发，
语义等价），所以第三方 provider 不会因为这个改名而断。接了 `_settle` 就以它为准。
声明了它 = 能力 `settle`（见 [supports](#supports)）。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### where

[`Disposition`](../type-aliases/Disposition.md)

#### Returns

`Promise`\<`boolean` \| `void`\>

这次处置有没有落定（`false` = 没落定，例如这份已经不归这次交付了）；
  不报告就返 `undefined`，内核不会替你编一个 `true`。

***

### \_status()?

> `protected` `optional` **\_status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:770](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L770)

[Subclass Responsibility - Optional] Performs the actual status query logic.

#### Parameters

##### address

`URL`

#### Returns

`Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

***

### \_subscribe()

> `abstract` `protected` **\_subscribe**(`address`, `onReceive`): `any`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:668](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L668)

[Subclass Responsibility] Performs the actual subscription logic.

#### Parameters

##### address

`URL`

##### onReceive

(`message`) => `void` \| `Promise`\<`void` \| [`DeliveryResult`](../interfaces/DeliveryResult.md)\>

基类包装后的投递入口：返回本次投递的最终结算结果。

#### Returns

`any`

A handle that can be used later to unsubscribe (e.g., a listener function, a subscription ID).

***

### \_trackBroadcastSettlement()

> `protected` **\_trackBroadcastSettlement**(`message`, `deliveries`): `void`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:1093](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L1093)

广播的结算 barrier：把 `publish` 返回的每次投递绑成一个后台任务，全部投递
（含重试链）落定后统一判定要不要 `nack(requeue)`。给广播型 provider 的 `_send` 用。

**处置信号里的消息是本轮结算后的投递副本**（带 `mbx-attempt` / `mbx-round`），不是
`_send` 传进来的那份共享对象——否则回队的那一份不带任何计数，`fetch()` 兜底消费者与
想设上限的 provider 就都没东西可数。拿不到副本时退回 `_send` 那份（计数全缺）：
投递没走基类入口（不经 `_startDelivery` / `_deliverToLocalSubscription`）、同 id 并发广播时
后落定的 barrier、副本表被 MAX\_SETTLED\_COPIES 淘汰。

不阻塞 `post()`：`post()` 在派发完成时就 resolve，判定在投递结算后才发生。
这正是 issue#2 的坑：“按成功订阅者数 > 0 跳过回队”在 fire-and-forget 广播上会误判 ——
先失败的订阅者可能比慢而成功的订阅者先结算。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### deliveries

readonly (`void` \| [`DeliveryResult`](../interfaces/DeliveryResult.md) \| `Promise`\<`void` \| [`DeliveryResult`](../interfaces/DeliveryResult.md)\>)[]

#### Returns

`void`

***

### \_unsubscribe()

> `abstract` `protected` **\_unsubscribe**(`subscriptionId`, `unsubscribeHandle`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:676](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L676)

[Subclass Responsibility] Performs the actual un-subscription logic.

#### Parameters

##### subscriptionId

`string`

##### unsubscribeHandle

`any`

#### Returns

`Promise`\<`void`\>

***

### ~~ack()~~

> `protected` **ack**(`message`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:636](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L636)

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

#### Deprecated

用 [settleDelivery](#settledelivery)(message, 'handled')。本方法保留是因为 `v1.0.0` 就有它：
  整个 2.x 里它都是 `settleDelivery(message, 'handled')` 的完整 alias，到拆包的 `3.0.0` 再删。

***

### can()

> **can**(`operation`, `address?`): `boolean`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:249](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L249)

能不能做 `operation`。子类可按地址而异（`can('peek', addr)`）。

基类内部的判断（只读取信、状态查询）与 `Mailbox` 门面都走这里，不再探方法存在性。

#### Parameters

##### operation

`string`

##### address?

`URL`

#### Returns

`boolean`

#### Implementation of

[`CapabilityDeclaration`](../interfaces/CapabilityDeclaration.md).[`can`](../interfaces/CapabilityDeclaration.md#can)

***

### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:351](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L351)

丢弃本 provider 持有的积压消息（含 in-flight），不动订阅。

默认**空实现**：“清空传输”对 AMQP / SQS / IMAP 这类真实 broker 是破坏性操作，
基类不能替子类下结论。需要 purge 语义的 provider（如 `MemoryProvider`）自己覆写。

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`clear`](../interfaces/IMailboxProvider.md#clear)

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:306](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L306)

关闭 Provider。
此方法会自动取消该 Provider 下所有活跃的订阅，然后调用子类的 `_close` 进行具体清理。

**给子类的收尾钩子是 `_close()`，不是这个 `close()`**：入口归基类，因为那段真拆除（拆每条订阅、
取消等重投的投递、清台账、置关闭状态）必须跑完。`_close()` 就在下面两行，重写错了对象是这条契约上
最容易犯的错，而后果是**拆不掉**：监听器留在 broker 上、句柄照报 `active`、`stop()` → `start()` 后
一份信两次副作用。确实要赶在拆订阅**之前**做事，就重写 `close()` 并 `await super.close()`——
不回到基类，上面这段一行都不跑；**只调 `this._close()` 也不算**，那段真拆除住在基类的 `close()` 里，
它跑完才换 `_close()`（规范：`wiki/delivery-semantics.md` §1）。

注意：`close()` **不**清消息队列——“关掉通道”不等于“销毁在途数据”。要一并清掉积压消息
用 `Mailbox#stop({ purge: true })` 或 [MailboxProvider.clear](#clear)。

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`close`](../interfaces/IMailboxProvider.md#close)

***

### declareCapabilities()

> `protected` **declareCapabilities**(`declared`): `Set`\<`string`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:260](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L260)

子类扩能力的入口（想按地址而异就重写 [can](#can)）。

基类的推导只覆盖接口层的可选钩子；自家协议特有的东西（停放区、死信队列、自定义处置值……）
在这里声明。它们必须真的被实现支撑：只声明不实现，内核会把错报成「这个 provider 答错了」，
而不是「它不支持」。

#### Parameters

##### declared

`Set`\<`string`\>

#### Returns

`Set`\<`string`\>

***

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:543](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L543)

Fetches a message.
Delegates directly to the concrete provider's implementation.

`peek` 在基类里分流（不交给 `_fetch`）：只读快照走 [MailboxProvider.\_peek](#_peek)，
不实现这个能力的 provider 直接报错 —— 把 `peek` 当普通 fetch 跑就是把消息取走，
而调用方以为自己在看一眼（issue#3）。

##### Parameters

###### address

`URL`

###### options

[`PeekFetchOptions`](../interfaces/PeekFetchOptions.md)

##### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

##### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`fetch`](../interfaces/IMailboxProvider.md#fetch)

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:544](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L544)

Fetches a message.
Delegates directly to the concrete provider's implementation.

`peek` 在基类里分流（不交给 `_fetch`）：只读快照走 [MailboxProvider.\_peek](#_peek)，
不实现这个能力的 provider 直接报错 —— 把 `peek` 当普通 fetch 跑就是把消息取走，
而调用方以为自己在看一眼（issue#3）。

##### Parameters

###### address

`URL`

###### options

[`ManualAckFetchOptions`](../interfaces/ManualAckFetchOptions.md)

##### Returns

`Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

##### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`fetch`](../interfaces/IMailboxProvider.md#fetch)

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:545](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L545)

Fetches a message.
Delegates directly to the concrete provider's implementation.

`peek` 在基类里分流（不交给 `_fetch`）：只读快照走 [MailboxProvider.\_peek](#_peek)，
不实现这个能力的 provider 直接报错 —— 把 `peek` 当普通 fetch 跑就是把消息取走，
而调用方以为自己在看一眼（issue#3）。

##### Parameters

###### address

`URL`

###### options?

[`PlainFetchOptions`](../interfaces/PlainFetchOptions.md)

##### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

##### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`fetch`](../interfaces/IMailboxProvider.md#fetch)

***

### generateId()

> **generateId**(): `string`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:599](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L599)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`generateId`](../interfaces/IMailboxProvider.md#generateid)

***

### init()

> **init**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:288](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L288)

初始化 Provider。子类可重写此方法以建立真实的连接。

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`init`](../interfaces/IMailboxProvider.md#init)

***

### ~~nack()~~

> `protected` **nack**(`message`, `requeue`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:652](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L652)

向 provider 发出处置决定：`requeue = true` 回队（`unhandled`），`requeue = false` **放弃**
（`discard`：丢弃或落死信，由 provider 定）。

`_nack` 是可选钩子（内存型 provider 本来就没有 broker 可 nack），但「内核已经判定要回队 /
要放弃，provider 却没接」是另一回事：消息会停在 broker 把它放的位置上——真实 broker
里就是 visibility timeout 后无限重投。所以这里告警一次，把落空的决定挑明。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### requeue

`boolean`

#### Returns

`Promise`\<`void`\>

#### Deprecated

用 [settleDelivery](#settledelivery)(message, 'unhandled' | 'discard')。布尔参数在
  `v1.0.0` 就发布了，直接去掉会让老代码里的 `nack(false)` 静默变成回队（从丢弃变无限
  重投），所以它在 2.x 里必须是完整 alias，到拆包的 `3.0.0` 再删。

***

### send()

> **send**(`message`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md)\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:360](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L360)

Sends a mail message.
This method handles common logic (like adding a timestamp and injecting x-req-sent-at for replies)
and then calls the concrete `_send` method for protocol-specific delivery.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md)\>

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`send`](../interfaces/IMailboxProvider.md#send)

***

### setRetryPolicy()

> **setRetryPolicy**(`policy`): `void`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:279](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L279)

开启 / 关闭订阅重试。传 `null` 回到默认行为（失败只回队、不自动重投）。

#### Parameters

##### policy

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null` \| `undefined`

#### Returns

`void`

***

### settleDelivery()

> `protected` **settleDelivery**(`message`, `where`): `Promise`\<`boolean` \| `void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:615](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L615)

向 provider 发出处置：这一次交付按 `where` 收尾（内核词汇：`handled` / `unhandled` /
`discard`，见 `CORE_DISPOSITIONS`）。

首选钩子是 [\_settle](#_settle)。没接它的子类（包括按 `v1.0.0` 写的第三方 provider）转发到
已发布的 [\_ack](#_ack) / [\_nack](#_nack)：`handled` → `_ack(message)`；
`unhandled` → `_nack(message, true)`；`discard` → `_nack(message, false)`。
少这层转发，旧子类会收不到处置；留着它，新旧两种写法也能共存。

自定义处置值先过能力声明：没声明过就抛 `UnsupportedCapabilityError`，而不是递给一个
不认得这个值的钩子（那会把「不知道拿它怎么办」变成「当成 ack 处理」）。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### where

[`Disposition`](../type-aliases/Disposition.md)

#### Returns

`Promise`\<`boolean` \| `void`\>

***

### status()

> **status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:589](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L589)

Queries the status of an address.
If the concrete provider implements `_status`, it will be called;
otherwise, a default "unknown" status is returned.

#### Parameters

##### address

`URL`

#### Returns

`Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`status`](../interfaces/IMailboxProvider.md#status)

***

### subscribe()

> **subscribe**(`address`, `onReceive`): `Promise`\<[`Subscription`](../interfaces/Subscription.md)\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:405](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L405)

Subscribes to an address.
This method manages the creation of the subscription object, centralizing the
implicit ACK and the error / retry handling of every delivery.

注册给具体 provider 的监听器返回一个在**投递最终结算**（含整条重试链）时才 resolve 的
`Promise<DeliveryResult>`。广播型 provider 的发送侧靠它做结算判定（issue#2）。

**返回 Promise 就是 await 点**（对齐 Python `Mailbox.subscribe` / Rust `Mailbox::subscribe`）：
「这条订阅已生效」是**每订阅**粒度的事实，只有 provider 自己答得上（进程内总线是登记完成
那一刻；接了真实对端的，照它自己协议的规矩答——有些协议根本不给确认），所以它挂在每个订阅
上，塞进 provider 级的 `init()` 就丢了。
`await` 完成之前调用方拿不到 `Subscription`——不先递对象再背后填 handle，那是把未生效的
订阅当成已生效。

两个刻意保留的错误时机（这个方法**故意不写成 `async`**，`_subscribe` 同步调用）：
- 「同步就能发现的错」（地址语法、scheme 未注册、钩子直接 `throw`）**照旧同步 throw**，
  不漂成 rejection —— 否则同一个地址在 `post()` 是 throw、在 `subscribe()` 是 reject，
  违反 I-4「不能只在一个入口合法」；
- 只有 `_subscribe` 真的 reject（异步拒绝）才是 rejection，与 `send()` 对称。

钩子不要求 async：v1 写的**同步** `_subscribe` 不改也能跑——基类 `await` 它，
非 Promise 的返回值一样等得起。

#### Parameters

##### address

`URL`

##### onReceive

(`message`) => `void` \| `Promise`\<`void`\>

#### Returns

`Promise`\<[`Subscription`](../interfaces/Subscription.md)\>

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`subscribe`](../interfaces/IMailboxProvider.md#subscribe)
