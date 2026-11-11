[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Mailbox

# Class: Mailbox

Defined in: [packages/mailbox/src/mailbox.ts:50](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L50)

## Constructors

### Constructor

> **new Mailbox**(): `Mailbox`

#### Returns

`Mailbox`

## Accessors

### providers

#### Get Signature

> **get** **providers**(): `ReadonlyMap`\<`string`, [`IMailboxProvider`](../interfaces/IMailboxProvider.md)\>

Defined in: [packages/mailbox/src/mailbox.ts:56](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L56)

获取所有已注册的 Provider。返回只读 Map 以确保安全性。

##### Returns

`ReadonlyMap`\<`string`, [`IMailboxProvider`](../interfaces/IMailboxProvider.md)\>

## Methods

### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/mailbox.ts:110](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L110)

丢弃各 provider 持有的积压消息（含 in-flight），**不**拆订阅。

测试隔离、用例之间重置状态用它；没声明 `clear` 能力的 provider 会被跳过。
注意默认构造的 `MemoryProvider` 共用进程级单例总线——`clear()` 会清掉同一份
总线上其它 `Mailbox` 的队列。只清自己那份，请用 `MemoryProvider.createIsolated()`
或 `MemoryProvider.forScope(scope)`。

#### Returns

`Promise`\<`void`\>

***

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

Defined in: [packages/mailbox/src/mailbox.ts:189](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L189)

取信 / 只读快照。

- 默认：取一封，隐式 ACK（出队即完成）。
- `{ manualAck: true }`：取一封，进 in-flight，直到 ack / nack 或超时重投。
- `{ peek: true, limit?: n }`：**只读**——返回副本数组（空队列是 `[]`），不出队、
  不建 in-flight、不刷活动时间。诊断与测试断言用这个，不要用「manualAck 但不 ack」凑。

`peek` 与 `manualAck` 同时给出会直接报错（互相矛盾），provider 不支持只读时抛
`UnsupportedCapabilityError`——都不会被静默降级成普通取信。

**手动 ACK 模式下拿到的句柄由内核套过一层**（见 `bindConsumerHandle`）：处置词汇
（`ack('handled' | 'unhandled' | 'discard')`）与「一次取信 = 一次处置」是内核保证，
不靠每个 provider 自己记得。句柄回 `boolean`：`false` = 这次处置没生效（重复处置 /
迟到的旧句柄），别当成功。

##### Parameters

###### address

`string` \| `URL`

###### options

[`PeekFetchOptions`](../interfaces/PeekFetchOptions.md)

##### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md)[]\>

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [packages/mailbox/src/mailbox.ts:190](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L190)

取信 / 只读快照。

- 默认：取一封，隐式 ACK（出队即完成）。
- `{ manualAck: true }`：取一封，进 in-flight，直到 ack / nack 或超时重投。
- `{ peek: true, limit?: n }`：**只读**——返回副本数组（空队列是 `[]`），不出队、
  不建 in-flight、不刷活动时间。诊断与测试断言用这个，不要用「manualAck 但不 ack」凑。

`peek` 与 `manualAck` 同时给出会直接报错（互相矛盾），provider 不支持只读时抛
`UnsupportedCapabilityError`——都不会被静默降级成普通取信。

**手动 ACK 模式下拿到的句柄由内核套过一层**（见 `bindConsumerHandle`）：处置词汇
（`ack('handled' | 'unhandled' | 'discard')`）与「一次取信 = 一次处置」是内核保证，
不靠每个 provider 自己记得。句柄回 `boolean`：`false` = 这次处置没生效（重复处置 /
迟到的旧句柄），别当成功。

##### Parameters

###### address

`string` \| `URL`

###### options

[`ManualAckFetchOptions`](../interfaces/ManualAckFetchOptions.md)

##### Returns

`Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

Defined in: [packages/mailbox/src/mailbox.ts:191](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L191)

取信 / 只读快照。

- 默认：取一封，隐式 ACK（出队即完成）。
- `{ manualAck: true }`：取一封，进 in-flight，直到 ack / nack 或超时重投。
- `{ peek: true, limit?: n }`：**只读**——返回副本数组（空队列是 `[]`），不出队、
  不建 in-flight、不刷活动时间。诊断与测试断言用这个，不要用「manualAck 但不 ack」凑。

`peek` 与 `manualAck` 同时给出会直接报错（互相矛盾），provider 不支持只读时抛
`UnsupportedCapabilityError`——都不会被静默降级成普通取信。

**手动 ACK 模式下拿到的句柄由内核套过一层**（见 `bindConsumerHandle`）：处置词汇
（`ack('handled' | 'unhandled' | 'discard')`）与「一次取信 = 一次处置」是内核保证，
不靠每个 provider 自己记得。句柄回 `boolean`：`false` = 这次处置没生效（重复处置 /
迟到的旧句柄），别当成功。

##### Parameters

###### address

`string` \| `URL`

###### options?

[`PlainFetchOptions`](../interfaces/PlainFetchOptions.md)

##### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

***

### getProvider()

#### Call Signature

> **getProvider**(`protocol`, `raiseErrorIfFailed`): [`IMailboxProvider`](../interfaces/IMailboxProvider.md)

Defined in: [packages/mailbox/src/mailbox.ts:65](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L65)

根据协议名获取指定的 Provider。

##### Parameters

###### protocol

`string`

协议名（例如 "memory" 或 "memory:"）

###### raiseErrorIfFailed

`true`

如果为 true，且找不到 Provider 时抛出错误。默认为 false。

##### Returns

[`IMailboxProvider`](../interfaces/IMailboxProvider.md)

#### Call Signature

> **getProvider**(`protocol`, `raiseErrorIfFailed?`): [`IMailboxProvider`](../interfaces/IMailboxProvider.md) \| `undefined`

Defined in: [packages/mailbox/src/mailbox.ts:66](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L66)

根据协议名获取指定的 Provider。

##### Parameters

###### protocol

`string`

协议名（例如 "memory" 或 "memory:"）

###### raiseErrorIfFailed?

`boolean`

如果为 true，且找不到 Provider 时抛出错误。默认为 false。

##### Returns

[`IMailboxProvider`](../interfaces/IMailboxProvider.md) \| `undefined`

***

### post()

> **post**(`mail`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md)\>

Defined in: [packages/mailbox/src/mailbox.ts:123](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L123)

#### Parameters

##### mail

[`OutgoingMail`](../interfaces/OutgoingMail.md)

#### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md)\>

***

### recover()

#### Call Signature

> **recover**(`address`): `Promise`\<[`LeaseRecoveryReport`](../interfaces/LeaseRecoveryReport.md)\>

Defined in: [packages/mailbox/src/mailbox.ts:255](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L255)

显式回收：把该地址上**租约已到期**的信收回队列。

为什么需要它：在飞租约的回收本来是惰性的（无后台定时器，只有下一次 manualAck 取信才扫）。
对正常轮询的消费者够用；但“最后一个消费者崩了”、“这个地址再没人 fetch”时，那封信就永远挂在
in-flight：`unreadCount` 0、`inFlightCount` 1（`mem:` 还会给出 `['mem.overdueInFlightCount']` 1），
不会自愈。
`recover()` 就是留给运维脚本 / 定时任务 / 健康检查的那个入口（不靠往默认路径里塞定时器）。

只动**已到期**的租约：别人手里未到期的、以及 `ackTimeout: 0` / `null` 的常驻租约都不会被碰。
幂等：紧接着再调一次通常 `reclaimed: 0`。provider 报错直接抛出，不静默吐掉。

没有租约概念的 provider 会回 `supported: false`——**别把 `reclaimed: 0` 读成“一切正常”**。

##### Parameters

###### address

`string` \| `URL`

要回收的地址；不带 = 遍历所有能枚举自身地址的 provider 的全部地址。

##### Returns

`Promise`\<[`LeaseRecoveryReport`](../interfaces/LeaseRecoveryReport.md)\>

#### Call Signature

> **recover**(): `Promise`\<[`LeaseRecoveryReport`](../interfaces/LeaseRecoveryReport.md)\>

Defined in: [packages/mailbox/src/mailbox.ts:256](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L256)

显式回收：把该地址上**租约已到期**的信收回队列。

为什么需要它：在飞租约的回收本来是惰性的（无后台定时器，只有下一次 manualAck 取信才扫）。
对正常轮询的消费者够用；但“最后一个消费者崩了”、“这个地址再没人 fetch”时，那封信就永远挂在
in-flight：`unreadCount` 0、`inFlightCount` 1（`mem:` 还会给出 `['mem.overdueInFlightCount']` 1），
不会自愈。
`recover()` 就是留给运维脚本 / 定时任务 / 健康检查的那个入口（不靠往默认路径里塞定时器）。

只动**已到期**的租约：别人手里未到期的、以及 `ackTimeout: 0` / `null` 的常驻租约都不会被碰。
幂等：紧接着再调一次通常 `reclaimed: 0`。provider 报错直接抛出，不静默吐掉。

没有租约概念的 provider 会回 `supported: false`——**别把 `reclaimed: 0` 读成“一切正常”**。

##### Returns

`Promise`\<[`LeaseRecoveryReport`](../interfaces/LeaseRecoveryReport.md)\>

***

### registerProvider()

> **registerProvider**(`provider`): `void`

Defined in: [packages/mailbox/src/mailbox.ts:118](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L118)

#### Parameters

##### provider

[`IMailboxProvider`](../interfaces/IMailboxProvider.md)

#### Returns

`void`

***

### snapshot()

> **snapshot**(): `Promise`\<[`MailboxSnapshot`](../interfaces/MailboxSnapshot.md)\>

Defined in: [packages/mailbox/src/mailbox.ts:301](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L301)

全量快照：把所有能枚举自身地址的 provider 的 topic 状态汇成一个可断言的结构。

等价于无参的 `status()`，只是名字更直白（诊断页里 `mailbox.snapshot()` 比 `mailbox.status()`
更好读）。不能枚举的 provider（消息不在本地，如 AMQP / SQS）会列在
`unsupportedProviders` 里，不会被误报成“队列为空”。

#### Returns

`Promise`\<[`MailboxSnapshot`](../interfaces/MailboxSnapshot.md)\>

***

### start()

> **start**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/mailbox.ts:80](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L80)

启动所有注册的 Provider。
建议在应用初始化阶段调用此方法，以确保所有通信通道准备就绪。

#### Returns

`Promise`\<`void`\>

***

### status()

#### Call Signature

> **status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [packages/mailbox/src/mailbox.ts:213](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L213)

查询指定地址的状态信息。

地址在 provider 里没有任何记录（没投过、没订阅过、没有活动）时，返回
`state: 'unknown'` + `exists: false`，而不是 `state: 'online'` + 0——诊断页要能区分
“这个地址不存在”和“这个地址空闲”。

##### Parameters

###### address

`string` \| `URL`

要查询的地址。

##### Returns

`Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

返回该地址的邮箱状态。

#### Call Signature

> **status**(): `Promise`\<[`MailboxSnapshot`](../interfaces/MailboxSnapshot.md)\>

Defined in: [packages/mailbox/src/mailbox.ts:217](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L217)

不带地址 = 全量快照：所有 provider、所有 topic 的一时刻诊断视图（见 [snapshot](#snapshot)）。

##### Returns

`Promise`\<[`MailboxSnapshot`](../interfaces/MailboxSnapshot.md)\>

***

### stop()

> **stop**(`options?`): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/mailbox.ts:93](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L93)

关闭所有注册的 Provider，并释放资源。
建议在应用关闭阶段调用此方法。

默认只拆订阅、不动积压消息：`stop()` 后同一个 provider（或共享同一份状态的另一个
`Mailbox`）重新 `start()`，队列里的残留消息照旧可见——这是 issue#3 里“测试隔离失效”的根源。
确实要销毁状态时显式传 `{ purge: true }`。

#### Parameters

##### options?

[`MailBoxStopOptions`](../interfaces/MailBoxStopOptions.md)

#### Returns

`Promise`\<`void`\>

***

### subscribe()

> **subscribe**(`address`, `onReceive`): `Promise`\<[`Subscription`](../interfaces/Subscription.md)\>

Defined in: [packages/mailbox/src/mailbox.ts:162](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/mailbox.ts#L162)

订阅一个地址（推送模式）。隐式 ACK：回调正常返回即确认，抛错即 nack。

**`await` 完成才是「订阅可收投递」的时刻**（与 Python / Rust 同形）：真实 broker 的
「订阅已生效」是每订阅粒度的事实，只能在这个 await 里确认。**忘了 await 是静默失败**：
回调可能根本没注册，错误也只是一个没人接的 rejection。需要「订阅已建立后再往下走」
（典型的：先订阅、再 drain 积压），必须 await——那个顺序现在写在代码里，而不是
靠 `subscribe()` 恰好是同步的。

错误时机与 `post()` / `fetch()` 一致：地址解析失败、scheme 未注册、provider 同步拒约
仍是**同步 throw**（所以本方法不是 `async`）；只有 `_subscribe` 异步 reject 才是 rejection。

#### Parameters

##### address

`string` \| `URL`

订阅地址（带 query / hash 是否合法由该 scheme 的 provider 判定）。

##### onReceive

(`message`) => `void` \| `Promise`\<`void`\>

投递回调。内核会 **await** 它：resolve = 隐式 ACK，reject = nack（
                 可重试判定决定回队还是放弃）。返回 Promise 就是让内核等你。

#### Returns

`Promise`\<[`Subscription`](../interfaces/Subscription.md)\>

已生效的订阅句柄；若在这期间已被 `stop()` / `unsubscribe()` 拆掉，
         拿到的是一个 `status: 'closed'` 的句柄（不报错）。
