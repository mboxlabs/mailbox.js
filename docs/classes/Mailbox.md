[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Mailbox

# Class: Mailbox

Defined in: [mailbox.ts:16](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L16)

## Constructors

### Constructor

> **new Mailbox**(): `Mailbox`

#### Returns

`Mailbox`

## Accessors

### providers

#### Get Signature

> **get** **providers**(): `ReadonlyMap`\<`string`, [`IMailboxProvider`](../interfaces/IMailboxProvider.md)\>

Defined in: [mailbox.ts:22](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L22)

获取所有已注册的 Provider。返回只读 Map 以确保安全性。

##### Returns

`ReadonlyMap`\<`string`, [`IMailboxProvider`](../interfaces/IMailboxProvider.md)\>

## Methods

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [mailbox.ts:88](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L88)

##### Parameters

###### address

`string` \| `URL`

###### options

`ManualAckedMailBoxFetchOptions`

##### Returns

`Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

Defined in: [mailbox.ts:89](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L89)

##### Parameters

###### address

`string` \| `URL`

###### options?

`AutoAckedMailBoxFetchOptions`

##### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md) \| `null`\>

***

### getProvider()

#### Call Signature

> **getProvider**(`protocol`, `raiseErrorIfFailed`): [`IMailboxProvider`](../interfaces/IMailboxProvider.md)

Defined in: [mailbox.ts:31](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L31)

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

Defined in: [mailbox.ts:32](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L32)

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

Defined in: [mailbox.ts:64](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L64)

#### Parameters

##### mail

[`OutgoingMail`](../interfaces/OutgoingMail.md)

#### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md)\>

***

### registerProvider()

> **registerProvider**(`provider`): `void`

Defined in: [mailbox.ts:60](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L60)

#### Parameters

##### provider

[`IMailboxProvider`](../interfaces/IMailboxProvider.md)

#### Returns

`void`

***

### start()

> **start**(): `Promise`\<`void`\>

Defined in: [mailbox.ts:46](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L46)

启动所有注册的 Provider。
建议在应用初始化阶段调用此方法，以确保所有通信通道准备就绪。

#### Returns

`Promise`\<`void`\>

***

### status()

> **status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [mailbox.ts:101](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L101)

查询指定地址的状态信息。

#### Parameters

##### address

`string` \| `URL`

要查询的地址。

#### Returns

`Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

返回该地址的邮箱状态。

***

### stop()

> **stop**(): `Promise`\<`void`\>

Defined in: [mailbox.ts:55](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L55)

关闭所有注册的 Provider，并释放资源。
建议在应用关闭阶段调用此方法。

#### Returns

`Promise`\<`void`\>

***

### subscribe()

> **subscribe**(`address`, `onReceive`): [`Subscription`](../interfaces/Subscription.md)

Defined in: [mailbox.ts:81](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/mailbox.ts#L81)

#### Parameters

##### address

`string` \| `URL`

##### onReceive

(`message`) => `void`

#### Returns

[`Subscription`](../interfaces/Subscription.md)
