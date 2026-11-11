[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / IMailboxProvider

# Interface: IMailboxProvider

Defined in: [packages/mailbox/src/interfaces.ts:419](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L419)

内核调用 provider 的**结构面**——这不是「实现路径」。

**规范：provider 必须继承 [MailboxProvider](../classes/MailboxProvider.md)**（`class SlackProvider extends MailboxProvider`）。
基类里那套记账不在接口上：关闭时拆订阅、发送边界发 `mbx-send-id` 与系统头、广播的结算 barrier、
处置与尝试记账、能力探测。**直接实现本接口不是受支持的写法**：那等于自己承担上面全部，而内核
既不检查也不代劳（`registerProvider()` 只读 `provider.protocol`，而本接口是结构型的——鸭子类型
对象过编译也过运行）。实测过漏掉「关闭时拆订阅」那一格：broker 侧监听器留着、句柄照报 `active`、
`stop()` → `start()` 后一份信两次副作用，全程无声（规范：`wiki/delivery-semantics.md` §1）。

Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。

## Properties

### addressGrammar?

> `readonly` `optional` **addressGrammar?**: [`MailboxAddressGrammar`](MailboxAddressGrammar.md)

Defined in: [packages/mailbox/src/interfaces.ts:546](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L546)

[Optional] 这个 scheme 的地址语法（见 [MailboxAddressGrammar](MailboxAddressGrammar.md)）。

内核不用它做任何判定（地址对内核是不透明的），但它是**能问到的东西**：诊断面、上层路由、
以及「我能不能往这个 scheme 写 query」的调用方都需要它。实现了地址能力
（`listAddresses` / 自定义 scheme）的 provider 应当声明。

***

### protocol

> **protocol**: `string`

Defined in: [packages/mailbox/src/interfaces.ts:420](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L420)

## Methods

### clear()?

> `optional` **clear**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/interfaces.ts:456](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L456)

丢弃本 provider 持有的积压消息（含 in-flight），不动订阅。可选实现。

为什么不是所有 provider 都能实现：真实 broker（AMQP / SQS…）的消息不在本地，
删它属于破坏性运维操作。由 provider 自己决定支持与否；`Mailbox#stop({ purge: true })`
会跳过没实现这个方法的 provider。

#### Returns

`Promise`\<`void`\>

***

### close()?

> `optional` **close**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/interfaces.ts:447](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L447)

关闭 Provider：释放资源、断开连接，**并把 `subscribe()` 注册过的订阅全部退掉**。

**收尾写在 `_close()`，不写在 `close()`**：`close()` 是基类拥有的入口，那段真拆除（拆每条订阅、
取消等重投的投递、清台账、置关闭状态）住在它里面，跑完才调 `_close()`——而 `_close()` 就在
`close()` 下面两行，重写错对象是这条契约上最容易犯的错。确实要重写 `close()`（赶在拆订阅之前
做事），重写内部**必须回基类**：`await super.close()`。**只调 `_close()` 不算**：上面那段仍然
一行都没跑。

漏掉的后果不是「订不上」而是**拆不掉**：`stop()` 之后 broker 侧监听器还在、句柄照报 `active`，
`stop()` → `start()` 再订一次就是一份信两次副作用。

不继承基类的写法（上面的实现路径规范之外）没人代劳：`registerProvider()` 只读
`provider.protocol`（`src/mailbox.ts:118`），登记表面就是你自己那个字段，内核连「现在挂了几条」
都问不出来，因此既不能代拆也不能报警（python 端口同形实测：`1 0` → `2 投递次数 2`，全程无声）。
自查面不依赖内核：`stop()` 之后自己的 `status()` 里挂着的订阅数必须为 0，拆过的句柄不得再报
`active`（`mem:` 就是为此具名了 `mem.subscriberCount`）。规范：`wiki/delivery-semantics.md` §1。

不会销毁积压消息（见 [IMailboxProvider.clear](#clear)）。

#### Returns

`Promise`\<`void`\>

***

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`MailMessage`](MailMessage.md)[]\>

Defined in: [packages/mailbox/src/interfaces.ts:516](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L516)

【拉取模式】从指定地址主动拉取一封信件。
支持自动ACK (默认) 和手动ACK两种模式。

【只读】`{ peek: true, limit?: n }`：返回副本数组，不出队、不建 in-flight（诊断 / 审计用）。
参数名在三端（TS / Python / Rust）保持一致。

实现注意：不认识 `peek` 的 provider **不能默默把它当普通 fetch 跑**（那会把消息取走，
而调用方以为自己在只读快照）。继承 [MailboxProvider](../classes/MailboxProvider.md) 基类的实现会在入口报错；
在基类之外自己实现的 provider（不符合接口顶部的实现路径）必须自己处理或拒绝 `peek`。

##### Parameters

###### address

`URL`

###### options

[`PeekFetchOptions`](PeekFetchOptions.md)

##### Returns

`Promise`\<[`MailMessage`](MailMessage.md)[]\>

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [packages/mailbox/src/interfaces.ts:517](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L517)

##### Parameters

###### address

`URL`

###### options

[`ManualAckFetchOptions`](ManualAckFetchOptions.md)

##### Returns

`Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](MailMessage.md) \| `null`\>

Defined in: [packages/mailbox/src/interfaces.ts:518](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L518)

##### Parameters

###### address

`URL`

###### options?

[`PlainFetchOptions`](PlainFetchOptions.md)

##### Returns

`Promise`\<[`MailMessage`](MailMessage.md) \| `null`\>

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| [`MailMessage`](MailMessage.md)[] \| `null`\>

Defined in: [packages/mailbox/src/interfaces.ts:519](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L519)

##### Parameters

###### address

`URL`

###### options?

[`FetchOptions`](FetchOptions.md)

##### Returns

`Promise`\<[`MailMessage`](MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| [`MailMessage`](MailMessage.md)[] \| `null`\>

***

### generateId()

> **generateId**(): `string`

Defined in: [packages/mailbox/src/interfaces.ts:564](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L564)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

***

### init()?

> `optional` **init**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/interfaces.ts:425](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L425)

初始化 Provider。用于建立连接、验证配置等。

#### Returns

`Promise`\<`void`\>

***

### listAddresses()?

> `optional` **listAddresses**(): `Promise`\<`string`[]\>

Defined in: [packages/mailbox/src/interfaces.ts:559](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L559)

[Optional] 列出本 provider 当前认得的地址。

**唯一要求**：列出的每个串都能原样喂回**同一个 provider**（`status` / `fetch` /
`recoverLeases`）。形式由该 scheme 决定——内核不解析、不折叠、不排序规则（D5），
`snapshot()` 只是把它们再查询一遍并按串排序以保证可重复。

可选能力：只有消息确实存在本地的 provider（如 `MemoryProvider`）能实现。
没实现就不实现——[MailboxSnapshot](MailboxSnapshot.md) 会把这类 provider 归入
[MailboxSnapshot.unsupportedProviders](MailboxSnapshot.md#unsupportedproviders)，不会把「枚举不了」当成「队列为空」。

#### Returns

`Promise`\<`string`[]\>

***

### recoverLeases()?

> `optional` **recoverLeases**(`address`): `Promise`\<`number`\>

Defined in: [packages/mailbox/src/interfaces.ts:537](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L537)

[Optional] 把该地址上**租约已到期**的在飞消息收回队列，返回收回了几份（幂等）。

有“租约”这个概念的 provider（队列型 / 拉取型）实现它，`Mailbox#recover()` 就能把僵死消费者
手里的过期租约收回来。没实现（推送型，或可见性超时在 broker 侧的 AMQP / SQS）会被
`recover()` 报成 `supported: false` —— **不能当作“一切正常”**。

#### Parameters

##### address

`URL`

#### Returns

`Promise`\<`number`\>

***

### send()

> **send**(`message`): `Promise`\<[`MailMessage`](MailMessage.md)\>

Defined in: [packages/mailbox/src/interfaces.ts:458](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L458)

#### Parameters

##### message

[`MailMessage`](MailMessage.md)

#### Returns

`Promise`\<[`MailMessage`](MailMessage.md)\>

***

### status()?

> `optional` **status**(`address`): `Promise`\<[`MailboxStatus`](MailboxStatus.md)\>

Defined in: [packages/mailbox/src/interfaces.ts:528](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L528)

查询指定地址的状态。
这是一个可选实现的方法。如果 Provider 不支持，可以抛出 "Not Implemented" 错误或返回一个默认状态。

#### Parameters

##### address

`URL`

要查询状态的地址。

#### Returns

`Promise`\<[`MailboxStatus`](MailboxStatus.md)\>

返回地址的状态信息。地址不存在时返回 `state: 'unknown'` + `exists: false`，
         而不是 `state: 'online'` + 0（issue#4）。

***

### subscribe()

> **subscribe**(`address`, `onReceive`): `Promise`\<[`Subscription`](Subscription.md)\>

Defined in: [packages/mailbox/src/interfaces.ts:503](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L503)

【订阅模式】订阅一个地址，当有信件到达时触发回调。
确认机制为隐式ACK：当 onReceive 函数成功执行，消息被自动确认。

回调抛错时，内核只做两件事：
  1. 把错误分类成可重试 / 不可重试（见 `isRetriableError`）；
  2. 发出**处置信号**：`_nack(message, true)` = 回队（不是放弃），
     `_nack(message, false)` = 放弃，并在之后调 `_onDeliveryDeadLettered`。

内核**不**保证的事（均归 provider）：重投几次、回到队列的哪个位置、放弃之后留下什么。
但处置信号里的 `message` 是**本轮结算后的投递副本**（带 `mbx-attempt` / `mbx-round`），
不是 `send()` 那个共享对象——所以回队的那份在队列里也带着次数，`fetch()` 兜底消费者看得见。
隐式 ACK 收到的也是副本（带计数的投递副本，见基类 `_ack`）。
推论：provider **不得按对象同一性记账**（`Map<MailMessage, handle>` / `WeakMap` / `set.has(message)`）——
查不到不报错，只会静默不 ack。用 `message.id` 或 broker 自己的投递句柄记账。
（广播 barrier 没记到副本时会退回 `send()` 那份不带计数的副本：投递没走基类入口 / 同 id
并发广播 / 副本表淘汰，所以 读取计数时要容 `undefined`。）
“移入死信队列”不是内核行为：基类只给钩子，默认实现不接（`MemoryProvider` 需要显式
`enableDeadLetterQueue()`）。需要 DLQ 就在钩子里自己写。

**返回 Promise：`await` 完成才是「订阅可收投递」的时刻。** 与 Python `Mailbox.subscribe`
/ Rust `Mailbox::subscribe` 同形。「这条订阅已生效」是**每订阅**粒度的事实，而且只有管着这个
scheme 的 provider 答得上：进程内总线是登记完成那一刻；接了真实对端的，是它能按自己协议的
规矩确认的那一刻——**协议不给确认时，由 provider 决定怎么如实答，内核不替它编一个**。
正因为内核不知道也不该猜，它只能等 provider 回答——这件事因此挂在每个订阅上，
收不进 provider 级的 `init()`：那里只答得出「这个 provider 起来了」，答不出
「这条订阅现在能收投递」。
**不 await 等于未订阅**：回调可能根本没注册，错误也只会变成没人接的 rejection。

错误时机（两边都是刻意的，不要抹平）：
- 同步就能发现的错（地址语法、scheme 未注册、provider 的 `_subscribe` 直接 `throw`）
  **照旧同步 throw**，与 `post()` / `fetch()` 一致（I-4：同一个地址不能只在一个入口合法）；
- provider 回话拒绝（`_subscribe` reject）才是 rejection，与 `send()` 对称。

实现提示：继承 [MailboxProvider](../classes/MailboxProvider.md) 时，`_subscribe` **不要求 async**（v1 的同步钩子不改
也能跑），但基类会等它。在基类之外自己实现的 provider（不符合接口顶部的实现路径）请自己保证：
`await subscribe()` 返回后投递就能开始，而且订阅在 await 窗口里被退订时不要把 `undefined` 当句柄拆。

**关闭与建立交错时这条作废**（已判的语义，见 `wiki/delivery-semantics.md` §1）：登记必须在
`await` **之前**落表，否则 `close()` / `stop()` 在窗口里看不见它、没人负责拆；handle 迟到时
必须在 provider 答话那一刻补拆，句柄报 `closed` 而不是抛异常；`close()` 必须**有界**，
不等一个永不落地的 `_subscribe`。

#### Parameters

##### address

`URL`

##### onReceive

(`message`) => `void` \| `Promise`\<`void`\>

#### Returns

`Promise`\<[`Subscription`](Subscription.md)\>
