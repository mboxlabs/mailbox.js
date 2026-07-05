[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxProvider

# Abstract Class: MailboxProvider

Defined in: [providers/MailboxProvider.ts:23](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L23)

定义了所有具体通信方式必须实现的接口。
Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。

## Extended by

- [`MemoryProvider`](MemoryProvider.md)

## Implements

- [`IMailboxProvider`](../interfaces/IMailboxProvider.md)

## Constructors

### Constructor

> **new MailboxProvider**(`protocol`): `MailboxProvider`

Defined in: [providers/MailboxProvider.ts:27](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L27)

#### Parameters

##### protocol

`string`

#### Returns

`MailboxProvider`

## Properties

### protocol

> `readonly` **protocol**: `string`

Defined in: [providers/MailboxProvider.ts:24](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L24)

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`protocol`](../interfaces/IMailboxProvider.md#protocol)

***

### subscriptions

> `protected` `readonly` **subscriptions**: `Map`\<`string`, `ManagedSubscription`\>

Defined in: [providers/MailboxProvider.ts:25](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L25)

## Methods

### \_ack()?

> `protected` `optional` **\_ack**(`message`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:201](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L201)

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

Defined in: [providers/MailboxProvider.ts:195](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L195)

[Subclass Responsibility - Optional] Specific closing logic.

#### Returns

`Promise`\<`void`\>

***

### \_fetch()

> `abstract` `protected` **\_fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [providers/MailboxProvider.ts:187](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L187)

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

> `protected` **\_handleReceiveError**(`error`, `message`): `void`

Defined in: [providers/MailboxProvider.ts:235](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L235)

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

Defined in: [providers/MailboxProvider.ts:206](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L206)

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

Defined in: [providers/MailboxProvider.ts:168](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L168)

[Subclass Responsibility] Performs the actual sending logic.

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

***

### \_status()?

> `protected` `optional` **\_status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [providers/MailboxProvider.ts:211](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L211)

[Subclass Responsibility - Optional] Performs the actual status query logic.

#### Parameters

##### address

`URL`

#### Returns

`Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

***

### \_subscribe()

> `abstract` `protected` **\_subscribe**(`address`, `onReceive`): `any`

Defined in: [providers/MailboxProvider.ts:174](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L174)

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

Defined in: [providers/MailboxProvider.ts:182](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L182)

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

Defined in: [providers/MailboxProvider.ts:155](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L155)

#### Parameters

##### message

[`MailMessage`](../interfaces/MailMessage.md)

#### Returns

`Promise`\<`void`\>

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:47](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L47)

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

Defined in: [providers/MailboxProvider.ts:126](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L126)

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

Defined in: [providers/MailboxProvider.ts:127](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L127)

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

Defined in: [providers/MailboxProvider.ts:151](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L151)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`generateId`](../interfaces/IMailboxProvider.md#generateid)

***

### init()

> **init**(): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:39](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L39)

初始化 Provider。子类可重写此方法以建立真实的连接。

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`IMailboxProvider`](../interfaces/IMailboxProvider.md).[`init`](../interfaces/IMailboxProvider.md#init)

***

### nack()

> `protected` **nack**(`message`, `requeue`): `Promise`\<`void`\>

Defined in: [providers/MailboxProvider.ts:159](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L159)

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

Defined in: [providers/MailboxProvider.ts:72](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L72)

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

Defined in: [providers/MailboxProvider.ts:141](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L141)

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

Defined in: [providers/MailboxProvider.ts:90](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/providers/MailboxProvider.ts#L90)

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
