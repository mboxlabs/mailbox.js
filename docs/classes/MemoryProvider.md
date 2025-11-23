[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MemoryProvider

# Class: MemoryProvider

Defined in: [providers/memory.ts:138](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/memory.ts#L138)

定义了所有具体通信方式必须实现的接口。
Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。

## Extends

- [`MailboxProvider`](MailboxProvider.md)

## Constructors

### Constructor

> **new MemoryProvider**(): `MemoryProvider`

Defined in: [providers/memory.ts:141](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/memory.ts#L141)

#### Returns

`MemoryProvider`

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`constructor`](MailboxProvider.md#constructor)

## Properties

### protocol

> `readonly` **protocol**: `string`

Defined in: [providers/MailboxProvider.ts:24](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L24)

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`protocol`](MailboxProvider.md#protocol)

***

### subscriptions

> `protected` `readonly` **subscriptions**: `Map`\<`string`, `ManagedSubscription`\>

Defined in: [providers/MailboxProvider.ts:25](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L25)

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`subscriptions`](MailboxProvider.md#subscriptions)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`_ack`](MailboxProvider.md#_ack)

***

### \_fetch()

> `protected` **\_fetch**(`address`, `options?`): `Promise`\<`null` \| [`MailMessage`](../interfaces/MailMessage.md) \| [`MailMessageAckable`](../type-aliases/MailMessageAckable.md)\<[`MailMessage`](../interfaces/MailMessage.md)\>\>

Defined in: [providers/memory.ts:168](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/memory.ts#L168)

[Subclass Responsibility] Performs the actual message fetching logic.

#### Parameters

##### address

`URL`

##### options?

###### ackTimeout?

`number`

###### manualAck?

`boolean`

#### Returns

`Promise`\<`null` \| [`MailMessage`](../interfaces/MailMessage.md) \| [`MailMessageAckable`](../type-aliases/MailMessageAckable.md)\<[`MailMessage`](../interfaces/MailMessage.md)\>\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_fetch`](MailboxProvider.md#_fetch)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`_handleReceiveError`](MailboxProvider.md#_handlereceiveerror)

***

### \_nack()

> `protected` **\_nack**(`message`, `requeue`): `Promise`\<`void`\>

Defined in: [providers/memory.ts:198](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/memory.ts#L198)

[Subclass Responsibility - Optional] Provides NACK capability.

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

### \_send()

> `protected` **\_send**(`message`): `Promise`\<`void`\>

Defined in: [providers/memory.ts:145](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/memory.ts#L145)

[Subclass Responsibility] Performs the actual sending logic.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_send`](MailboxProvider.md#_send)

***

### \_status()

> `protected` **\_status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [providers/memory.ts:185](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/memory.ts#L185)

[Subclass Responsibility - Optional] Performs the actual status query logic.

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

Defined in: [providers/memory.ts:150](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/memory.ts#L150)

[Subclass Responsibility] Performs the actual subscription logic.

#### Parameters

##### address

`URL`

##### onReceive

(`message`) => `Promise`\<`void`\>

#### Returns

`any`

A handle that can be used later to unsubscribe (e.g., a listener function, a subscription ID).

#### Overrides

[`MailboxProvider`](MailboxProvider.md).[`_subscribe`](MailboxProvider.md#_subscribe)

***

### \_unsubscribe()

> `protected` **\_unsubscribe**(`subscriptionId`, `unsubscribeHandle`): `Promise`\<`void`\>

Defined in: [providers/memory.ts:159](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/memory.ts#L159)

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

### ack()

> `protected` **ack**(`message`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:124](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L124)

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`ack`](MailboxProvider.md#ack)

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

##### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`fetch`](MailboxProvider.md#fetch)

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

##### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`fetch`](MailboxProvider.md#fetch)

***

### generateId()

> **generateId**(): `string`

Defined in: [providers/MailboxProvider.ts:120](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/providers/MailboxProvider.ts#L120)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`generateId`](MailboxProvider.md#generateid)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`nack`](MailboxProvider.md#nack)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`send`](MailboxProvider.md#send)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`status`](MailboxProvider.md#status)

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

#### Inherited from

[`MailboxProvider`](MailboxProvider.md).[`subscribe`](MailboxProvider.md#subscribe)
