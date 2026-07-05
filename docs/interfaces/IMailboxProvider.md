[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / IMailboxProvider

# Interface: IMailboxProvider

Defined in: [interfaces.ts:112](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L112)

定义了所有具体通信方式必须实现的接口。
Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。

## Properties

### protocol

> **protocol**: `string`

Defined in: [interfaces.ts:113](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L113)

## Methods

### close()?

> `optional` **close**(): `Promise`\<`void`\>

Defined in: [interfaces.ts:123](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L123)

关闭 Provider。用于释放资源、断开连接等。

#### Returns

`Promise`\<`void`\>

***

### fetch()

#### Call Signature

> **fetch**(`address`, `options`): `Promise`\<[`AckableMailMessage`](../type-aliases/AckableMailMessage.md) \| `null`\>

Defined in: [interfaces.ts:138](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L138)

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

Defined in: [interfaces.ts:139](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L139)

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

Defined in: [interfaces.ts:140](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L140)

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

Defined in: [interfaces.ts:153](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L153)

创建一个唯一标识符。主要是用于生成邮件的 ID。

#### Returns

`string`

***

### init()?

> `optional` **init**(): `Promise`\<`void`\>

Defined in: [interfaces.ts:118](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L118)

初始化 Provider。用于建立连接、验证配置等。

#### Returns

`Promise`\<`void`\>

***

### send()

> **send**(`message`): `Promise`\<[`MailMessage`](MailMessage.md)\>

Defined in: [interfaces.ts:125](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L125)

#### Parameters

##### message

[`MailMessage`](MailMessage.md)

#### Returns

`Promise`\<[`MailMessage`](MailMessage.md)\>

***

### status()?

> `optional` **status**(`address`): `Promise`\<[`MailboxStatus`](MailboxStatus.md)\>

Defined in: [interfaces.ts:148](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L148)

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

Defined in: [interfaces.ts:132](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L132)

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
