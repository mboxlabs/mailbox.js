[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxProvider

# Abstract Class: MailboxProvider

Defined in: [providers/MailboxProvider.ts:23](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L23)

定义了所有具体通信方式必须实现的接口。
Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。

## Extended by

- [`MemoryProvider`](MemoryProvider.md)

## Implements

- [`IMailboxProvider`](../interfaces/IMailboxProvider.md)

## Constructors

### Constructor

> **new MailboxProvider**(`protocol`): `MailboxProvider`

Defined in: [providers/MailboxProvider.ts:27](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L27)

#### Parameters

##### protocol

`string`

#### Returns

`MailboxProvider`

## Properties

### protocol

> `readonly` **protocol**: `string`

Defined in: [providers/MailboxProvider.ts:24](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L24)

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`protocol`](../interfaces/IMailboxProvider.md#protocol)

***

### subscriptions

> `protected` `readonly` **subscriptions**: `Map`\<`string`, `ManagedSubscription`\>

Defined in: [providers/MailboxProvider.ts:25](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L25)

## Methods

### \_ack()?

> `protected` `optional` **\_ack**(`message`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:165](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L165)

[Subclass Responsibility - Optional] Provides implicit ACK capability for the `subscribe` mode.
For providers that don't support ACK (like in-memory), this can be an empty async function.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

***

### \_fetch()

> `abstract` `protected` **\_fetch**(`address`, `options?`): `Promise`\<`null` \| [`MailMessage`](../interfaces/MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

Defined in: [providers/MailboxProvider.ts:156](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L156)

[Subclass Responsibility] Performs the actual message fetching logic.

#### Parameters

##### address

`URL`

##### options?

###### manualAck?

`boolean`

#### Returns

`Promise`\<`null` \| [`MailMessage`](../interfaces/MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

***

### \_handleReceiveError()

> `protected` **\_handleReceiveError**(`error`, `message`): `void`

Defined in: [providers/MailboxProvider.ts:199](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L199)

#### Parameters

##### error

`any`

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`void`

***

### \_nack()?

> `protected` `optional` **\_nack**(`message`, `requeue`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:170](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L170)

[Subclass Responsibility - Optional] Provides NACK capability.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

##### requeue

`boolean`

#### Returns

`Promise`\<`void`\>

***

### \_send()

> `abstract` `protected` **\_send**(`message`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:137](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L137)

[Subclass Responsibility] Performs the actual sending logic.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

***

### \_status()?

> `protected` `optional` **\_status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [providers/MailboxProvider.ts:175](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L175)

[Subclass Responsibility - Optional] Performs the actual status query logic.

#### Parameters

##### address

`URL`

#### Returns

`Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

***

### \_subscribe()

> `abstract` `protected` **\_subscribe**(`address`, `onReceive`): `any`

Defined in: [providers/MailboxProvider.ts:143](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L143)

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

Defined in: [providers/MailboxProvider.ts:151](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L151)

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

Defined in: [providers/MailboxProvider.ts:124](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L124)

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

***

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<`null` \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

Defined in: [providers/MailboxProvider.ts:95](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L95)

Fetches a message.
Delegates directly to the concrete provider's implementation.

##### Parameters

###### address

`URL`

###### options

###### manualAck

`true`

##### Returns

`Promise`\<`null` \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

##### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`fetch`](../interfaces/IMailboxProvider.md#fetch)

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<`null` \| [`MailMessage`](../interfaces/MailMessage.md)\>

Defined in: [providers/MailboxProvider.ts:96](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L96)

Fetches a message.
Delegates directly to the concrete provider's implementation.

##### Parameters

###### address

`URL`

###### options?

###### manualAck?

`false`

##### Returns

`Promise`\<`null` \| [`MailMessage`](../interfaces/MailMessage.md)\>

##### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`fetch`](../interfaces/IMailboxProvider.md#fetch)

***

### generateId()

> **generateId**(): `string`

Defined in: [providers/MailboxProvider.ts:120](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L120)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`generateId`](../interfaces/IMailboxProvider.md#generateid)

***

### nack()

> `protected` **nack**(`message`, `requeue`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:128](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L128)

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

Defined in: [providers/MailboxProvider.ts:41](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L41)

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

### status()

> **status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [providers/MailboxProvider.ts:110](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L110)

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

Defined in: [providers/MailboxProvider.ts:59](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L59)

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
