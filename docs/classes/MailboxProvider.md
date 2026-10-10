[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxProvider

# Abstract Class: MailboxProvider

Defined in: [providers/MailboxProvider.ts:32](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L32)

定义了所有具体通信方式必须实现的接口。
Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。

## Extended by

- [`MemoryProvider`](MemoryProvider.md)

## Implements

- [`IMailboxProvider`](../interfaces/IMailboxProvider.md)

## Constructors

### Constructor

> **new MailboxProvider**(`protocol`, `retry?`): `MailboxProvider`

Defined in: [providers/MailboxProvider.ts:47](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L47)

#### Parameters

##### protocol

`string`

##### retry?

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null`

#### Returns

`MailboxProvider`

## Properties

### protocol

> `readonly` **protocol**: `string`

Defined in: [providers/MailboxProvider.ts:33](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L33)

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`protocol`](../interfaces/IMailboxProvider.md#protocol)

***

### retry

> `protected` **retry**: `Required`\<[`RetryPolicy`](../interfaces/RetryPolicy.md)\> \| `null` = `null`

Defined in: [providers/MailboxProvider.ts:41](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L41)

订阅失败后的重试策略。`null` 表示不重试（默认）：可重试失败只把消息退回队列，
由 `fetch()` 兜底。重试是 opt-in 的，因为 AMQP / SQS 这类传输自带重投与死信，
库再重投就是双重投递。

***

### subscriptions

> `protected` `readonly` **subscriptions**: `Map`\<`string`, `ManagedSubscription`\>

Defined in: [providers/MailboxProvider.ts:34](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L34)

## Methods

### \_ack()?

> `protected` `optional` **\_ack**(`message`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:236](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L236)

[Subclass Responsibility - Optional] Provides implicit ACK capability for the `subscribe` mode.
For providers that don't support ACK (like in-memory), this can be an empty async function.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

***

### \_close()?

> `protected` `optional` **\_close**(): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:230](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L230)

[Subclass Responsibility - Optional] Specific closing logic.

#### Returns

`Promise`\<`void`\>

***

### \_fetch()

> `abstract` `protected` **\_fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [providers/MailboxProvider.ts:222](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L222)

[Subclass Responsibility] Performs the actual message fetching logic.

#### Parameters

##### address

`URL`

##### options?

###### manualAck?

`boolean`

#### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

***

### \_handleReceiveError()

> `protected` **\_handleReceiveError**(`error`, `message`, `sub?`): `void`

Defined in: [providers/MailboxProvider.ts:279](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L279)

订阅回调抛错时的统一处理。

默认（`retry === null`）：可重试 → `nack(requeue=true)` 退回队列；不可重试 → 丢弃。
开启重试后：可重试且未超上限 → 只重投给失败的那个订阅者（不广播给其他已成功的订阅者，
否则它们的副作用会被执行两次）；超上限 → 清零台账、调 `_onRetryExhausted`，再退回队列
交给 `fetch()` 兜底。

#### Parameters

##### error

`any`

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### sub?

`ManagedSubscription`

#### Returns

`void`

***

### \_isRetriable()

> `protected` **\_isRetriable**(`error`): `boolean`

Defined in: [providers/MailboxProvider.ts:346](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L346)

#### Parameters

##### error

`any`

#### Returns

`boolean`

***

### \_nack()?

> `protected` `optional` **\_nack**(`message`, `requeue`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:241](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L241)

[Subclass Responsibility - Optional] Provides NACK capability.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### requeue

`boolean`

#### Returns

`Promise`\<`void`\>

***

### \_onRetryExhausted()?

> `protected` `optional` **\_onRetryExhausted**(`message`, `attempts`): `void`

Defined in: [providers/MailboxProvider.ts:327](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L327)

[Subclass Responsibility - Optional] 重试次数耗尽时的钩子（例如写死信队列 / 告警）。
调用后消息仍会退回队列，由 `fetch()` 兜底。

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### attempts

`number`

#### Returns

`void`

***

### \_send()

> `abstract` `protected` **\_send**(`message`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:203](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L203)

[Subclass Responsibility] Performs the actual sending logic.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

***

### \_status()?

> `protected` `optional` **\_status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [providers/MailboxProvider.ts:246](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L246)

[Subclass Responsibility - Optional] Performs the actual status query logic.

#### Parameters

##### address

`URL`

#### Returns

`Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

***

### \_subscribe()

> `abstract` `protected` **\_subscribe**(`address`, `onReceive`): `any`

Defined in: [providers/MailboxProvider.ts:209](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L209)

[Subclass Responsibility] Performs the actual subscription logic.

#### Parameters

##### address

`URL`

##### onReceive

(`message`) => `Promise`\<`void`\>

#### Returns

`any`

A handle that can be used later to unsubscribe (e.g., a listener function, a subscription ID).

***

### \_unsubscribe()

> `abstract` `protected` **\_unsubscribe**(`subscriptionId`, `unsubscribeHandle`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:217](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L217)

[Subclass Responsibility] Performs the actual un-subscription logic.

#### Parameters

##### subscriptionId

`string`

##### unsubscribeHandle

`any`

#### Returns

`Promise`\<`void`\>

***

### ack()

> `protected` **ack**(`message`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:190](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L190)

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:75](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L75)

关闭 Provider。
此方法会自动取消该 Provider 下所有活跃的订阅，然后调用子类的 `_close` 进行具体清理。

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`close`](../interfaces/IMailboxProvider.md#close)

***

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [providers/MailboxProvider.ts:161](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L161)

Fetches a message.
Delegates directly to the concrete provider's implementation.

##### Parameters

###### address

`URL`

###### options

###### manualAck

`true`

##### Returns

`Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

##### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`fetch`](../interfaces/IMailboxProvider.md#fetch)

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

Defined in: [providers/MailboxProvider.ts:162](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L162)

Fetches a message.
Delegates directly to the concrete provider's implementation.

##### Parameters

###### address

`URL`

###### options?

###### manualAck?

`false`

##### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

##### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`fetch`](../interfaces/IMailboxProvider.md#fetch)

***

### generateId()

> **generateId**(): `string`

Defined in: [providers/MailboxProvider.ts:186](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L186)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`generateId`](../interfaces/IMailboxProvider.md#generateid)

***

### init()

> **init**(): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:67](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L67)

初始化 Provider。子类可重写此方法以建立真实的连接。

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`init`](../interfaces/IMailboxProvider.md#init)

***

### nack()

> `protected` **nack**(`message`, `requeue`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:194](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L194)

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### requeue

`boolean`

#### Returns

`Promise`\<`void`\>

***

### send()

> **send**(`message`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md)\>

Defined in: [providers/MailboxProvider.ts:106](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L106)

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

Defined in: [providers/MailboxProvider.ts:58](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L58)

开启 / 关闭订阅重试。传 `null` 回到默认行为（失败只回队、不自动重投）。

#### Parameters

##### policy

[`RetryPolicy`](../interfaces/RetryPolicy.md) \| `null` \| `undefined`

#### Returns

`void`

***

### status()

> **status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [providers/MailboxProvider.ts:176](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L176)

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

> **subscribe**(`address`, `onReceive`): [`Subscription`](../interfaces/Subscription.md)

Defined in: [providers/MailboxProvider.ts:124](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/providers/MailboxProvider.ts#L124)

Subscribes to an address.
This method manages the creation and lifecycle of the subscription object,
including wrapping the callback for implicit ACK and centralized error handling.

#### Parameters

##### address

`URL`

##### onReceive

(`message`) => `void` \| `Promise`\<`void`\>

#### Returns

[`Subscription`](../interfaces/Subscription.md)

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`subscribe`](../interfaces/IMailboxProvider.md#subscribe)
