[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / IMailboxProvider

# Interface: IMailboxProvider

Defined in: [interfaces.ts:99](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L99)

定义了所有具体通信方式必须实现的接口。
Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。

## Properties

### protocol

> **protocol**: `string`

Defined in: [interfaces.ts:100](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L100)

## Methods

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<`null` \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

Defined in: [interfaces.ts:115](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L115)

【拉取模式】从指定地址主动拉取一封信件。
支持自动ACK (默认) 和手动ACK两种模式。

##### Parameters

###### address

`URL`

###### options

###### manualAck

`true`

##### Returns

`Promise`\<`null` \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<`null` \| [`MailMessage`](MailMessage.md)\>

Defined in: [interfaces.ts:116](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L116)

##### Parameters

###### address

`URL`

###### options?

###### manualAck?

`false`

##### Returns

`Promise`\<`null` \| [`MailMessage`](MailMessage.md)\>

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<`null` \| [`MailMessage`](MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

Defined in: [interfaces.ts:117](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L117)

##### Parameters

###### address

`URL`

###### options?

###### manualAck?

`boolean`

##### Returns

`Promise`\<`null` \| [`MailMessage`](MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)\>

***

### generateId()

> **generateId**(): `string`

Defined in: [interfaces.ts:130](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L130)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

***

### send()

> **send**(`message`): `Promise`\<[`MailMessage`](MailMessage.md)\>

Defined in: [interfaces.ts:102](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L102)

#### Parameters

##### message

[`MailMessage`](MailMessage.md)

#### Returns

`Promise`\<[`MailMessage`](MailMessage.md)\>

***

### status()?

> `optional` **status**(`address`): `Promise`\<[`MailboxStatus`](MailboxStatus.md)\>

Defined in: [interfaces.ts:125](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L125)

查询指定地址的状态。
这是一个可选实现的方法。如果 Provider 不支持，可以抛出 "Not Implemented" 错误或返回一个默认状态。

#### Parameters

##### address

`URL`

要查询状态的地址。

#### Returns

`Promise`\<[`MailboxStatus`](MailboxStatus.md)\>

返回地址的状态信息。

***

### subscribe()

> **subscribe**(`address`, `onReceive`): [`Subscription`](Subscription.md)

Defined in: [interfaces.ts:109](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L109)

【订阅模式】订阅一个地址，当有信件到达时触发回调。
确认机制为隐式ACK：当 onReceive 函数成功执行，消息被自动确认。
发生异常时，将根据错误类型决定是重试还是移入死信队列。

#### Parameters

##### address

`URL`

##### onReceive

(`message`) => `void` \| `Promise`\<`void`\>

#### Returns

[`Subscription`](Subscription.md)
