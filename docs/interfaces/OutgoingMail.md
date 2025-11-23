[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / OutgoingMail

# Interface: OutgoingMail

Defined in: [interfaces.ts:15](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L15)

代表一封待发送的信件。
这是用户在调用 post() 方法时需要构建的对象。

## Properties

### body

> **body**: `any`

Defined in: [interfaces.ts:22](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L22)

***

### from

> **from**: `string` \| `URL`

Defined in: [interfaces.ts:20](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L20)

***

### headers?

> `optional` **headers**: `object`

Defined in: [interfaces.ts:28](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L28)

Mailbox 框架自身需要的用于消息路由、认证、关联、内容类型等控制信息，用于指导消息的传输和处理。
这是框架自身和 Provider 关心的“控制平面”数据。本质上它与消息的业务内容无关。
例如: mbx-reply-to, Authorization

#### Index Signature

\[`key`: `string`\]: `any`

#### mbx-reply-to?

> `optional` **mbx-reply-to**: `string`

#### mbx-sent-at?

> `optional` **mbx-sent-at**: `string`

***

### id?

> `optional` **id**: `string`

Defined in: [interfaces.ts:19](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L19)

可选的消息 ID。如果未提供，Mailbox 将自动生成。

***

### meta?

> `optional` **meta**: `object`

Defined in: [interfaces.ts:37](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L37)

本邮件消息的附加数据（邮件的数据平面），是消息的业务内容的补充元信息，由业务应用自定义和使用。
系统只负责透传，不进行解析和干预。本质上是邮件的一部分。

#### Index Signature

\[`key`: `string`\]: `any`

***

### to

> **to**: `string` \| `URL`

Defined in: [interfaces.ts:21](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/interfaces.ts#L21)
