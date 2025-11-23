[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Mailbox

# Class: Mailbox

Defined in: [mailbox.ts:16](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/mailbox.ts#L16)

## Constructors

### Constructor

> **new Mailbox**(): `Mailbox`

#### Returns

`Mailbox`

## Methods

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<`null` \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

Defined in: [mailbox.ts:49](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/mailbox.ts#L49)

##### Parameters

###### address

`string` | `URL`

###### options

`ManualAckedMailBoxFetchOptions`

##### Returns

`Promise`\<`null` \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<`null` \| [`MailMessage`](../interfaces/MailMessage.md)\>

Defined in: [mailbox.ts:50](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/mailbox.ts#L50)

##### Parameters

###### address

`string` | `URL`

###### options?

`AutoAckedMailBoxFetchOptions`

##### Returns

`Promise`\<`null` \| [`MailMessage`](../interfaces/MailMessage.md)\>

***

### post()

> **post**(`mail`): `Promise`\<[`MailMessage`](../interfaces/MailMessage.md)\>

Defined in: [mailbox.ts:23](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/mailbox.ts#L23)

#### Parameters

##### mail

[`OutgoingMail`](../interfaces/OutgoingMail.md)

#### Returns

`Promise`\<[`MailMessage`](../interfaces/MailMessage.md)\>

***

### registerProvider()

> **registerProvider**(`provider`): `void`

Defined in: [mailbox.ts:19](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/mailbox.ts#L19)

#### Parameters

##### provider

[`IMailboxProvider`](../interfaces/IMailboxProvider.md)

#### Returns

`void`

***

### status()

> **status**(`address`): `Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

Defined in: [mailbox.ts:63](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/mailbox.ts#L63)

查询指定地址的状态信息。

#### Parameters

##### address

要查询的地址。

`string` | `URL`

#### Returns

`Promise`\<[`MailboxStatus`](../interfaces/MailboxStatus.md)\>

返回该地址的邮箱状态。

***

### subscribe()

> **subscribe**(`address`, `onReceive`): [`Subscription`](../interfaces/Subscription.md)

Defined in: [mailbox.ts:41](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/mailbox.ts#L41)

#### Parameters

##### address

`string` | `URL`

##### onReceive

(`message`) => `void`

#### Returns

[`Subscription`](../interfaces/Subscription.md)
