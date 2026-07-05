[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / OutgoingMail

# Interface: OutgoingMail

Defined in: [interfaces.ts:15](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L15)

代表一封待发送的信件。
这是用户在调用 post() 方法时需要构建的对象。

## Properties

### body

> **body**: `any`

Defined in: [interfaces.ts:25](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L25)

***

### from

> **from**: `string` \| `URL`

Defined in: [interfaces.ts:23](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L23)

***

### headers?

> `optional` **headers?**: `object`

Defined in: [interfaces.ts:39](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L39)

Mailbox 框架及其生态约定的控制信息（控制平面），用于指导消息的传输、路由、认证和关联。

标准 Header 约定：
- `req-id`: 请求标识 (Request ID)。用于在异步交互中匹配请求与响应。
  在运输层，它作为单次交互的关联键，同时用于处理网络重传导致的【请求级去重】。
  每次请求应生成独立的 req-id 以确保当前闭环。
- `trace-id`: 全链路追踪标识 (Trace ID)。由业务源头生成并在整个生命周期中透传。
  用于跨多个 Request 串联起完整的业务流日志，是解决分布式复杂拓扑下可观测性问题的关键。
- `mbx-reply-to`: 邮箱系统标准的回复地址。指明响应消息应发往的 Mailbox 地址。
- `mbx-sent-at`: 发送时间戳 (ISO 8601)。由 Provider 在发送时自动注入。
  代表消息正式进入传输系统的时刻，是审计消息时效、监控传输延迟的权威标准。

#### Index Signature

\[`key`: `string`\]: `any`

#### mbx-reply-to?

> `optional` **mbx-reply-to?**: `string`

#### mbx-sent-at?

> `optional` **mbx-sent-at?**: `string`

#### req-id?

> `optional` **req-id?**: `string`

#### trace-id?

> `optional` **trace-id?**: `string`

***

### id?

> `optional` **id?**: `string`

Defined in: [interfaces.ts:22](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L22)

消息的物理唯一标识。如果未提供，Mailbox 将自动生成。

建议与消息内容绑定（如使用内容的 Hash），以便实现【内容级幂等】。
邮箱系统通过此 ID 识别并丢弃内容重复的信件，确保同一份信息不会被物理重复投递。

***

### meta?

> `optional` **meta?**: `object`

Defined in: [interfaces.ts:50](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L50)

本邮件消息的附加数据（邮件的数据平面），是消息的业务内容的补充元信息，由业务应用自定义和使用。
系统只负责透传，不进行解析和干预。本质上是邮件的一部分。

#### Index Signature

\[`key`: `string`\]: `any`

***

### to

> **to**: `string` \| `URL`

Defined in: [interfaces.ts:24](https://github.com/isdk/mailbox.js/blob/9df3fcab2962ca4d6c19cdd4e424c87817029df8/src/interfaces.ts#L24)
