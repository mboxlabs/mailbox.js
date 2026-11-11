[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MemoryProvider

# Class: MemoryProvider

Defined in: [packages/mailbox/src/providers/memory.ts:442](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L442)

Provider 的基类——**实现新 provider 请从这里继承**（规范见 `wiki/delivery-semantics.md` §1）。

基类拥有那些第三方最容易做错、又最难自己做对的记账：发送边界发 `mbx-send-id` 与系统头、投递级
结算与重试、广播的 barrier、处置与尝试记账、能力探测，以及**关闭时拆掉全部订阅**。子类要填的是
`_xxx()` 那一层钩子：`_send()` / `_subscribe()` / `_fetch()` / `_peek()` / `_ack()` / `_nack()` /
`_init()` / `_close()` / `_status()`。

直接实现 [IMailboxProvider](../interfaces/IMailboxProvider.md) 不是受支持的写法：接口只是内核调你的结构面，上面那些记账一分都
不在里面，而内核不会检查（`registerProvider()` 只读 `protocol`），也不会代劳。写错的形状实测过：
关闭时漏拆订阅 ⇒ 监听器留在 broker 上、句柄照报 `active`、`stop()` → `start()` 后一份信两次副作用。

## Extends

- [`MailboxProvider`](MailboxProvider.md)

## Constructors

### Constructor

> **new MemoryProvider**(`retry?`, `bus?`, `options?`): `MemoryProvider`

Defined in: [packages/mailbox/src/providers/memory.ts:475](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L475)

#### Parameters

##### retry?

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null`

可选的订阅重试策略。不传则保持默认：订阅失败只把消息退回队列，不自动重投。

##### bus?

[`MemoryEventBus`](MemoryEventBus.md)

可选的总线。不传则用进程级共享单例（向后兼容）；
  传 `new MemoryEventBus()` 得到实例级隔离，传 `MemoryEventBus.getInstance('scope')` 得到命名空间级隔离。

##### options?

[`MemoryProviderOptions`](../interfaces/MemoryProviderOptions.md)

可选行为（目前只有 opt-in 的租约清扫周期）。

#### Returns

`MemoryProvider`

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`constructor`](MailboxProvider.md#constructor)

## Properties

### addressGrammar

> `readonly` **addressGrammar**: [`MailboxAddressGrammar`](../interfaces/MailboxAddressGrammar.md)

Defined in: [packages/mailbox/src/providers/memory.ts:506](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L506)

`mem:` 的地址语法（D5）——本 provider 声明，并在自己的**每个**入口执行。

内核不折叠地址、不判等、不禁止 query / fragment：那些规则属于某一个 scheme。
这里把它写成**能问到的数据**，而不是只藏在 [MemoryProvider.topicOf](#topicof) 的实现里。

***

### broadcastDeliveries

> `protected` `readonly` **broadcastDeliveries**: `true` = `true`

Defined in: [packages/mailbox/src/providers/memory.ts:460](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L460)

订阅是广播：一条消息对每个订阅者各投递一次。失败处理因此走投递级记账，
整条消息回不回队由 `_send` 里的结算 barrier 决定（issue#2）。

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`broadcastDeliveries`](MailboxProvider.md#broadcastdeliveries)

***

### bus

> `readonly` **bus**: [`MemoryEventBus`](MemoryEventBus.md)

Defined in: [packages/mailbox/src/providers/memory.ts:448](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L448)

这个 provider 用的总线。默认是进程级共享单例（“模拟服务端”语义），
需要实例级隔离时用 [MemoryProvider.createIsolated](#createisolated) / [MemoryProvider.forScope](#forscope)，
或直接把自建总线传进构造函数。

***

### deliverySettleTimeout

> **deliverySettleTimeout**: `number` = `DEFAULT_DELIVERY_SETTLE_TIMEOUT`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:195](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L195)

单次投递尝试的结算超时（毫秒）。`0` / 负数关闭（调用方自己负责长任务）。
见 [DEFAULT\_DELIVERY\_SETTLE\_TIMEOUT](../variables/DEFAULT_DELIVERY_SETTLE_TIMEOUT.md)。

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`deliverySettleTimeout`](MailboxProvider.md#deliverysettletimeout)

***

### protocol

> `readonly` **protocol**: `string`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:131](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L131)

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`protocol`](MailboxProvider.md#protocol)

***

### retry

> `protected` **retry**: `Required`\<[`RetryPolicy`](../interfaces/RetryPolicy.md)\> \| `null` = `null`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:159](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L159)

订阅失败后的重试策略。`null` 表示不重试（默认）：可重试失败只把消息退回队列，
由 `fetch()` 兜底。重试是 opt-in 的，因为 AMQP / SQS 这类传输自带重投与死信，
库再重投就是双重投递。

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`retry`](MailboxProvider.md#retry)

***

### subscriptions

> `protected` `readonly` **subscriptions**: `Map`\<`string`, `ManagedSubscription`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:132](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L132)

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`subscriptions`](MailboxProvider.md#subscriptions)

## Accessors

### deadLetterEnabled

#### Get Signature

> **get** **deadLetterEnabled**(): `boolean`

Defined in: [packages/mailbox/src/providers/memory.ts:822](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L822)

死信队列是否开着。

##### Returns

`boolean`

***

### maxDeadLetterNesting

#### Get Signature

> **get** **maxDeadLetterNesting**(): `number` \| `null`

Defined in: [packages/mailbox/src/providers/memory.ts:827](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L827)

当前生效的死信链深度上限；没开启死信队列时 `null`。

##### Returns

`number` \| `null`

***

### pendingDeliveryCount

#### Get Signature

> **get** `protected` **pendingDeliveryCount**(): `number`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:1383](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L1383)

当前尚未结算的投递数量（诊断 / 测试用）。

##### Returns

`number`

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`pendingDeliveryCount`](MailboxProvider.md#pendingdeliverycount)

***

### supports

#### Get Signature

> **get** **supports**(): `Set`\<`string`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:240](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L240)

这个 provider 现在会做什么（**运行期可变的数据**，见 D6）。

初始值由已实现的可选钩子推导（`_status` → `status`、`_peek` → `peek`…），子类可以在
[declareCapabilities](MailboxProvider.md#declarecapabilities) 里加自己协议独有的能力，也可以随时直接改这个集合：

```ts
provider.supports.add('disposition:answered');   // 我认这个处置值，而且我知道怎么处理
provider.supports.delete('peek');               // 这个实例现在不让人只读了
```

规矩：**未声明 = 没有这个操作**；谁给 provider 注入能力（包装、AoP、配置开关），谁就负
责更新声明。声明与实现漂移不会报错，所以诊断面、重试门限、conformance 都以声明为准。

##### Returns

`Set`\<`string`\>

可变的能力集合。读它 = 看这个 provider 现在能做什么；改它 = 声明变了。

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`supports`](MailboxProvider.md#supports)

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

用 [\_settle](MailboxProvider.md#_settle)(message, 'handled')。它在 `v1.0.0` 就发布了，所以 2.x 里
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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`_ack`](MailboxProvider.md#_ack)

***

### \_close()

> `protected` **\_close**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/memory.ts:579](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L579)

`close()` / `Mailbox#stop()` 必须拆掉定时器：收尾之后不该再改队列。

#### Returns

`Promise`\<`void`\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_close`](MailboxProvider.md#_close)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`_deliverToLocalSubscription`](MailboxProvider.md#_delivertolocalsubscription)

***

### \_fetch()

> `protected` **\_fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| [`MailMessageAckable`](../type-aliases/MailMessageAckable.md)\<[`MailMessage`](../interfaces/MailMessage.md)\> \| `null`\>

Defined in: [packages/mailbox/src/providers/memory.ts:664](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L664)

[Subclass Responsibility] Performs the actual message fetching logic.
基类不会把 `peek: true` 送进这里（只读快照走 `_peek`），实现无需考虑只读分支。

#### Parameters

##### address

`URL`

##### options?

###### ackTimeout?

`number` \| `null`

###### manualAck?

`boolean`

#### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| [`MailMessageAckable`](../type-aliases/MailMessageAckable.md)\<[`MailMessage`](../interfaces/MailMessage.md)\> \| `null`\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_fetch`](MailboxProvider.md#_fetch)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`_handleDeliveryError`](MailboxProvider.md#_handledeliveryerror)

***

### \_isRetriable()

> `protected` **\_isRetriable**(`error`): `boolean`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:1387](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L1387)

#### Parameters

##### error

`any`

#### Returns

`boolean`

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`_isRetriable`](MailboxProvider.md#_isretriable)

***

### \_nack()

> `protected` **\_nack**(`message`, `requeue`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/memory.ts:1155](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L1155)

基类发出的处置信号的落点（广播型：全部投递结算后调用一次，不在每个订阅者失败时调用）。

之前这里是空实现：订阅的消息不再入队后，可重试错误等于消息静默消失。
现在 requeue=true（全部投递都失败）将消息退回 topic 队列头部，可被 `fetch` 取回且在
`unreadCount` 里可见；requeue=false（有订阅者成功，或失败不可重试）就是“放弃”：
默认直接丢弃，开了 [enableDeadLetterQueue](#enabledeadletterqueue) 则在死信 topic 里留一份（留痕在
`_onDeliveryDeadLettered` 里做，不在这里）。

这里的 `message` 是本轮结算后的投递副本（带 `mbx-attempt` / `mbx-round`），所以回队的
那一份在队列里也看得到“本轮试了几次 / 这是第几轮”。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### requeue

`boolean`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_nack`](MailboxProvider.md#_nack)

***

### \_onDeliveryDeadLettered()

> `protected` **\_onDeliveryDeadLettered**(`message`, `failed`): `void`

Defined in: [packages/mailbox/src/providers/memory.ts:804](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L804)

基类的死信钩子（在 `nack` 之后被调，一条广播的全部失败投递一起进来一次）。

以前 MemoryProvider 不接这个钩子：requeue=false（有订阅者成功，或失败不可重试）就等于
消息静默消失。现在：死信开关开着时，这里把**每一条失败的投递**归档一份到
`<topic><suffix>`；没开仍是丢弃（默认行为，向后兼容）。默认不开是因为：死信是运维
决定，不是内核默认——开了就会向总线多写一份数据，而那个 topic 还得有人消费。

归档目标按**消息实际所在的那条队列**算。广播侧两者天然相等：`_send` 就是拿
`canonical(message.to)` 当 topic 去 publish 的，所以这里用 `to` 没错（拉取侧不一样，
见 wrapConsumerSettlement）。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### failed

readonly [`DeliveryResult`](../interfaces/DeliveryResult.md)[]

#### Returns

`void`

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_onDeliveryDeadLettered`](MailboxProvider.md#_ondeliverydeadlettered)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`_onRetryExhausted`](MailboxProvider.md#_onretryexhausted)

***

### \_peek()

> `protected` **\_peek**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

Defined in: [packages/mailbox/src/providers/memory.ts:691](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L691)

只读快照：副本，不动队列、不建 in-flight、不刷活动时间。

之前没有这个能力：想“看一眼”只能 `fetch({ manualAck: true })` 不 ack，消息就进了
in-flight（默认 30s 后重投），既干扰正常消费者的计数，也不是只读（issue#4）。

#### Parameters

##### address

`URL`

##### options?

###### limit?

`number`

#### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_peek`](MailboxProvider.md#_peek)

***

### \_send()

> `protected` **\_send**(`message`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/memory.ts:634](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L634)

发送并给广播挂上结算 barrier：等这条消息的全部投递（含重试链）落定后，才决定要不要
把它退回队列（判定在基类的 `shouldRequeueAfterBroadcast`，issue#2）。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_send`](MailboxProvider.md#_send)

***

### \_settle()?

> `protected` `optional` **\_settle**(`message`, `where`): `Promise`\<`boolean` \| `void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:716](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L716)

[Subclass Responsibility - Optional] 处置一次交付（新入口，取代 [\_ack](MailboxProvider.md#_ack) / [\_nack](MailboxProvider.md#_nack)）。

`where` 是内核词汇：
- `handled`：这一份到此为止，不留痕；
- `unhandled`：交回队列，还会再交出去；
- `discard`：结束它，并按这个协议的规矩**善后**（死信 / bounce / 打标记——做什么由协议定）。

与已发布钩子的关系：没接 `_settle` 的子类继续走 [\_ack](MailboxProvider.md#_ack) / [\_nack](MailboxProvider.md#_nack)（基类转发，
语义等价），所以第三方 provider 不会因为这个改名而断。接了 `_settle` 就以它为准。
声明了它 = 能力 `settle`（见 [supports](MailboxProvider.md#supports)）。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### where

[`Disposition`](../type-aliases/Disposition.md)

#### Returns

`Promise`\<`boolean` \| `void`\>

这次处置有没有落定（`false` = 没落定，例如这份已经不归这次交付了）；
  不报告就返 `undefined`，内核不会替你编一个 `true`。

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`_settle`](MailboxProvider.md#_settle)

***

### \_status()

> `protected` **\_status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [packages/mailbox/src/providers/memory.ts:744](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L744)

状态：具名字段只放核心操作本身就有的观测量（D7），本策略的账走命名空间扩展键。

为什么分开：`parkedCount` / `overdueInFlightCount` 讲的是「停放区」与「租约清扫」这两套
**投递策略**——换个 broker（AMQP / SQS）这两个概念未必存在，硬塞进核心类型就等于要求所有
provider 都长得像 `MemoryProvider`。所以核心具名字段只有
`state` / `exists` / `unreadCount` / `inFlightCount` / `lastActivityTime`，
`mem:` 自己的观测量挂在 `mem.*` 上（`v1.0.0` 就留好的扩展位）。

**`mem:` 没有存活态可报**：进程内总线没有「可达性」这回事，它永远连得上，所以这里
只出 `online` / `unknown` 两档，永远不会出 `offline` / `degraded`。这里的 `online` 说的是
「这条地址我有活动记录（投过 / 订过）」，不是「broker 活着」——存活态由 provider 自己判，
内核只转述。真要测 offline 那一档，得自己扩展一个会答的 provider（直接实现
`IMailboxProvider` 的第三方，或子类覆写 `_status`），别指望 `mem:` 报出来。

#### Parameters

##### address

`URL`

#### Returns

`Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_status`](MailboxProvider.md#_status)

***

### \_subscribe()

> `protected` **\_subscribe**(`address`, `onReceive`): `any`

Defined in: [packages/mailbox/src/providers/memory.ts:646](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L646)

[Subclass Responsibility] Performs the actual subscription logic.

#### Parameters

##### address

`URL`

##### onReceive

(`message`) => `Promise`\<[`DeliveryResult`](../interfaces/DeliveryResult.md)\>

基类包装后的投递入口：返回本次投递的最终结算结果。

#### Returns

`any`

A handle that can be used later to unsubscribe (e.g., a listener function, a subscription ID).

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_subscribe`](MailboxProvider.md#_subscribe)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`_trackBroadcastSettlement`](MailboxProvider.md#_trackbroadcastsettlement)

***

### \_unsubscribe()

> `protected` **\_unsubscribe**(`subscriptionId`, `unsubscribeHandle`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/memory.ts:655](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L655)

[Subclass Responsibility] Performs the actual un-subscription logic.

#### Parameters

##### subscriptionId

`string`

##### unsubscribeHandle

`any`

#### Returns

`Promise`\<`void`\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_unsubscribe`](MailboxProvider.md#_unsubscribe)

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

用 [settleDelivery](MailboxProvider.md#settledelivery)(message, 'handled')。本方法保留是因为 `v1.0.0` 就有它：
  整个 2.x 里它都是 `settleDelivery(message, 'handled')` 的完整 alias，到拆包的 `3.0.0` 再删。

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`ack`](MailboxProvider.md#ack)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`can`](MailboxProvider.md#can)

***

### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/memory.ts:626](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L626)

丢弃这份总线上的所有消息（含 in-flight），订阅保持不变。

代价要写清楚：默认构造的 provider 共用进程级单例总线，`clear()` 就是清空全进程的
`mem:` 队列。只想清自己的状态，就用 [MemoryProvider.createIsolated](#createisolated) / [MemoryProvider.forScope](#forscope)。

#### Returns

`Promise`\<`void`\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`clear`](MailboxProvider.md#clear)

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
用 `Mailbox#stop({ purge: true })` 或 [MailboxProvider.clear](MailboxProvider.md#clear)。

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`close`](MailboxProvider.md#close)

***

### deadLetterTopic()

> **deadLetterTopic**(`address`): `string` \| `null`

Defined in: [packages/mailbox/src/providers/memory.ts:993](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L993)

某个地址的被放弃消息会去哪（canonical id）；没开启时返回 `null`。
拿它去 `fetch` / `peek` / `status` 就能消费死信：返回的 key 与归档写入的 key 是同一个，
而且一定是规范形式（能被任何读路径重新算出来）。

已封顶的地址返回**它自己**：那层不会再拼新后缀（见 [DEFAULT\_MAX\_DEAD\_LETTER\_NESTING](../variables/DEFAULT_MAX_DEAD_LETTER_NESTING.md)），
新的死信就地停放。返回一个会被拼出来、但永远不会被写入的地址，比不返回更坑：
诊断页会指着一个空队列说“死信在这”。

#### Parameters

##### address

`string` \| `URL`

#### Returns

`string` \| `null`

***

### declareCapabilities()

> `protected` **declareCapabilities**(`declared`): `Set`\<`string`\>

Defined in: [packages/mailbox/src/providers/memory.ts:491](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L491)

本 provider 的能力声明。

接口层的可选钩子（`status` / `peek` / `recoverLeases` / `listAddresses` / `clear`）由基类从实现推导；
这里只补**不属于通用接口**的形状：

- `parked`：有停放区（`peekParked` / `purgeParked`）——没这个能力就没有「判死但没丢」这个状态可查；
- `dead-letter`：只在 `enableDeadLetterQueue()` 之后有（见那两个方法里的声明增删）。
  没开时 `discard` 就是纯丢弃、零痕迹——能力声明不说谎。

#### Parameters

##### declared

`Set`\<`string`\>

#### Returns

`Set`\<`string`\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`declareCapabilities`](MailboxProvider.md#declarecapabilities)

***

### disableDeadLetterQueue()

> **disableDeadLetterQueue**(): `void`

Defined in: [packages/mailbox/src/providers/memory.ts:905](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L905)

关闭死信队列：之后被放弃的消息回到默认的“直接丢弃”。

#### Returns

`void`

***

### enableDeadLetterQueue()

> **enableDeadLetterQueue**(`options?`): `void`

Defined in: [packages/mailbox/src/providers/memory.ts:841](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L841)

开启死信队列：被放弃的消息（不回队的那些）会在 `<topic><suffix>` 里多出一份可取回的副本。

覆盖两类“放弃”：
- 订阅侧：投递不可重试 / 部分失败里失败的那一个（经 `_onDeliveryDeadLettered`）；
- 拉取侧：消费者自己 `nack(false)`（它不经过内核钩子，但同样是“放弃”，不能静默消失）。

归档只动 headers（控制平面），不碰业务 `meta` / `body`。
链深默认只允许一层（[DEFAULT\_MAX\_DEAD\_LETTER\_NESTING](../variables/DEFAULT_MAX_DEAD_LETTER_NESTING.md)），到顶就地停放。

#### Parameters

##### options?

[`DeadLetterQueueOptions`](../interfaces/DeadLetterQueueOptions.md) = `{}`

#### Returns

`void`

***

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:543](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L543)

Fetches a message.
Delegates directly to the concrete provider's implementation.

`peek` 在基类里分流（不交给 `_fetch`）：只读快照走 [MailboxProvider.\_peek](MailboxProvider.md#_peek)，
不实现这个能力的 provider 直接报错 —— 把 `peek` 当普通 fetch 跑就是把消息取走，
而调用方以为自己在看一眼（issue#3）。

##### Parameters

###### address

`URL`

###### options

[`PeekFetchOptions`](../interfaces/PeekFetchOptions.md)

##### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

##### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`fetch`](MailboxProvider.md#fetch)

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:544](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L544)

Fetches a message.
Delegates directly to the concrete provider's implementation.

`peek` 在基类里分流（不交给 `_fetch`）：只读快照走 [MailboxProvider.\_peek](MailboxProvider.md#_peek)，
不实现这个能力的 provider 直接报错 —— 把 `peek` 当普通 fetch 跑就是把消息取走，
而调用方以为自己在看一眼（issue#3）。

##### Parameters

###### address

`URL`

###### options

[`ManualAckFetchOptions`](../interfaces/ManualAckFetchOptions.md)

##### Returns

`Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

##### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`fetch`](MailboxProvider.md#fetch)

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:545](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L545)

Fetches a message.
Delegates directly to the concrete provider's implementation.

`peek` 在基类里分流（不交给 `_fetch`）：只读快照走 [MailboxProvider.\_peek](MailboxProvider.md#_peek)，
不实现这个能力的 provider 直接报错 —— 把 `peek` 当普通 fetch 跑就是把消息取走，
而调用方以为自己在看一眼（issue#3）。

##### Parameters

###### address

`URL`

###### options?

[`PlainFetchOptions`](../interfaces/PlainFetchOptions.md)

##### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

##### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`fetch`](MailboxProvider.md#fetch)

***

### generateId()

> **generateId**(): `string`

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:599](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L599)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`generateId`](MailboxProvider.md#generateid)

***

### init()

> **init**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/providers/memory.ts:557](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L557)

启动（opt-in 的）租约清扫定时器。

扫的是整个总线上已知的所有 topic：回收只按**每条租约自己的到期时刻**判，所以定时扫是
安全的——不会动别人未到期的租约，也不会动 `ackTimeout: 0` 的常驻租约。
扫失败不能搞死定时器（否则一个 topic 的异常就把回收关掉了）。

#### Returns

`Promise`\<`void`\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`init`](MailboxProvider.md#init)

***

### listAddresses()

> **listAddresses**(): `Promise`\<`string`[]\>

Defined in: [packages/mailbox/src/providers/memory.ts:725](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L725)

本总线认得的地址（`mem:` 自己的形式）——消息就在本地，所以能枚举。
唯一契约：这些串能原样喂回本 provider（`status` / `fetch` / `recoverLeases`）。

#### Returns

`Promise`\<`string`[]\>

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

用 [settleDelivery](MailboxProvider.md#settledelivery)(message, 'unhandled' | 'discard')。布尔参数在
  `v1.0.0` 就发布了，直接去掉会让老代码里的 `nack(false)` 静默变成回队（从丢弃变无限
  重投），所以它在 2.x 里必须是完整 alias，到拆包的 `3.0.0` 再删。

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`nack`](MailboxProvider.md#nack)

***

### peekParked()

> **peekParked**(`address`, `limit?`): [`MailMessage`](../interfaces/MailMessage.md)[]

Defined in: [packages/mailbox/src/providers/memory.ts:702](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L702)

只读：这条地址上**停放**着的记录（判死、不再交付、但也没丢）。

停放记录不在 `fetch` / `peek` 的交付流里——否则排空脚本又会取到它。要看只能走这里，
或者看 `status()['mem.parkedCount']`。

#### Parameters

##### address

`string` \| `URL`

##### limit?

`number`

#### Returns

[`MailMessage`](../interfaces/MailMessage.md)[]

***

### purgeParked()

> **purgeParked**(`address`, `predicate?`): `number`

Defined in: [packages/mailbox/src/providers/memory.ts:713](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L713)

排空停放区：把判死的记录**永久丢掉**，返回丢掉的份数。

停放记录不进交付流（那是 F8 的坑），所以没有 ack 可用来排走它们——唯一的出口就是这里。
先 `peekParked()` 看清要丢什么，再调它。

#### Parameters

##### address

`string` \| `URL`

##### predicate?

(`message`) => `boolean`

#### Returns

`number`

***

### recoverLeases()

> **recoverLeases**(`address`): `Promise`\<`number`\>

Defined in: [packages/mailbox/src/providers/memory.ts:590](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L590)

把该地址上**租约已到期**的信收回队列（`Mailbox#recover()` 的实现入口）。
幂等，返回收回了几份。

#### Parameters

##### address

`URL`

#### Returns

`Promise`\<`number`\>

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`send`](MailboxProvider.md#send)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`setRetryPolicy`](MailboxProvider.md#setretrypolicy)

***

### settleDelivery()

> `protected` **settleDelivery**(`message`, `where`): `Promise`\<`boolean` \| `void`\>

Defined in: [packages/mailbox/src/providers/MailboxProvider.ts:615](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/MailboxProvider.ts#L615)

向 provider 发出处置：这一次交付按 `where` 收尾（内核词汇：`handled` / `unhandled` /
`discard`，见 `CORE_DISPOSITIONS`）。

首选钩子是 [\_settle](MailboxProvider.md#_settle)。没接它的子类（包括按 `v1.0.0` 写的第三方 provider）转发到
已发布的 [\_ack](MailboxProvider.md#_ack) / [\_nack](MailboxProvider.md#_nack)：`handled` → `_ack(message)`；
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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`settleDelivery`](MailboxProvider.md#settledelivery)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`status`](MailboxProvider.md#status)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`subscribe`](MailboxProvider.md#subscribe)

***

### topicOf()

> `protected` **topicOf**(`address`): `string`

Defined in: [packages/mailbox/src/providers/memory.ts:530](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L530)

`mem:` 的等价规则：把地址折叠成本总线的内部队列键。

这是 **scheme 的语法**（见 [MemoryProvider.addressGrammar](#addressgrammar)），不是内核规则：
`mem:a@h/i` 与 `mem://a@h/i` 落到同一个键，而带 query / fragment 的写法直接报错
（折叠会把它们丢掉，两条业务流静默共用一条队列——issue#4）。

正因为 `_send` / `_fetch` / `_peek` / `_status` / `subscribe` / 死信命名 / 停放区
每个入口都过这里，「同一个地址在所有入口一致」在 `mem:` 里是**结构性成立**的，
不靠调用方小心。

#### Parameters

##### address

`URL`

#### Returns

`string`

***

### createIsolated()

> `static` **createIsolated**\<`T`\>(`this`, `retry?`): `T`

Defined in: [packages/mailbox/src/providers/memory.ts:601](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L601)

造一个“自带私有总线”的 provider：同进程的其它 `mem:` 地址完全看不到它的队列与订阅。
宿主 + 插件、kernel + provider 各持一个 `Mailbox`，以及测试隔离，都应该用这个。

写成 `this`-多态：子类调 `MyProvider.createIsolated()` 必须拿到**子类**实例，否则
子类覆写的钩子会静默没接上（一个“绿得很假”的陷阱）。

#### Type Parameters

##### T

`T` *extends* `MemoryProvider`

#### Parameters

##### this

(`retry?`, `bus?`) => `T`

##### retry?

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null`

#### Returns

`T`

***

### forScope()

> `static` **forScope**\<`T`\>(`this`, `scope`, `retry?`): `T`

Defined in: [packages/mailbox/src/providers/memory.ts:612](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/providers/memory.ts#L612)

造一个挂在命名空间总线上的 provider：同 `scope` 共享一份状态，不同 `scope` 互不可见。
“一个进程里跑多个互不相干的 `mem:` 世界”用它，不需要自己管总线对象。

#### Type Parameters

##### T

`T` *extends* `MemoryProvider`

#### Parameters

##### this

(`retry?`, `bus?`) => `T`

##### scope

`string`

##### retry?

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null`

#### Returns

`T`
