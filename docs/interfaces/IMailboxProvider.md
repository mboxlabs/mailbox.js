[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / IMailboxProvider

# Interface: IMailboxProvider

Defined in: [interfaces.ts:120](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L120)

定义了所有具体通信方式必须实现的接口。
Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。

## Properties

### protocol

> **protocol**: `string`

Defined in: [interfaces.ts:121](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L121)

## Methods

### close()?

> `optional` **close**(): `Promise`\<`void`\>

Defined in: [interfaces.ts:131](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L131)

关闭 Provider。用于释放资源、断开连接等。

#### Returns

`Promise`\<`void`\>

***

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [interfaces.ts:146](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L146)

【拉取模式】从指定地址主动拉取一封信件。
支持自动ACK (默认) 和手动ACK两种模式。

##### Parameters

###### address

`URL`

###### options

###### manualAck

`true`

##### Returns

`Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](MailMessage.md) \| `null`\>

Defined in: [interfaces.ts:147](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L147)

##### Parameters

###### address

`URL`

###### options?

###### manualAck?

`false`

##### Returns

`Promise`\<[`MailMessage`](MailMessage.md) \| `null`\>

#### Call Signature

> **fetch**(`address`, `options?`): `Promise`\<[`MailMessage`](MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [interfaces.ts:148](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L148)

##### Parameters

###### address

`URL`

###### options?

###### manualAck?

`boolean`

##### Returns

`Promise`\<[`MailMessage`](MailMessage.md) \| [`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

***

### generateId()

> **generateId**(): `string`

Defined in: [interfaces.ts:161](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L161)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

***

### init()?

> `optional` **init**(): `Promise`\<`void`\>

Defined in: [interfaces.ts:126](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L126)

初始化 Provider。用于建立连接、验证配置等。

#### Returns

`Promise`\<`void`\>

***

### send()

> **send**(`message`): `Promise`\<[`MailMessage`](MailMessage.md)\>

Defined in: [interfaces.ts:133](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L133)

#### Parameters

##### message

[`MailMessage`](MailMessage.md)

#### Returns

`Promise`\<[`MailMessage`](MailMessage.md)\>

***

### status()?

> `optional` **status**(`address`): `Promise`\<[`MailboxStatus`](MailboxStatus.md)\>

Defined in: [interfaces.ts:156](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L156)

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

Defined in: [interfaces.ts:140](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L140)

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
