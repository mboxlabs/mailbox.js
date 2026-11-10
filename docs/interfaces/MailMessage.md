[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailMessage

# Interface: MailMessage

Defined in: [packages/mailbox/src/interfaces.ts:104](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L104)

代表一封在系统内传递的、带有唯一标识的规范信件。
这是在 Mailbox 与 Provider 之间传递的主要对象。
消费者收到的也是此类型的消息。

## Extends

- `Omit`\<[`OutgoingMail`](OutgoingMail.md), `"from"` \| `"to"`\>

## Properties

### body

> **body**: `any`

Defined in: [packages/mailbox/src/interfaces.ts:51](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L51)

#### Inherited from

[`OutgoingMail`](OutgoingMail.md).[`body`](OutgoingMail.md#body)

***

### from

> `readonly` **from**: `URL`

Defined in: [packages/mailbox/src/interfaces.ts:106](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L106)

***

### headers?

> `optional` **headers?**: `object`

Defined in: [packages/mailbox/src/interfaces.ts:85](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L85)

Mailbox 框架及其生态约定的控制信息（控制平面），用于指导消息的传输、路由、认证和关联。

标准 Header 约定：
- `req-id`: 请求标识 (Request ID)。用于在异步交互中匹配请求与响应。
  在运输层，它是单次交互的关联键。**内核只透传它，不按它去重**：想挡住网络重传造成的
  重复请求，得由传输层或接收方自己实现（可以拿它当键），内核不替你做。
  每次请求应生成独立的 req-id 以确保当前闭环。
- `trace-id`: 全链路追踪标识 (Trace ID)。由业务源头生成并在整个生命周期中透传。
  用于跨多个 Request 串联起完整的业务流日志，是解决分布式复杂拓扑下可观测性问题的关键。
- `mbx-reply-to`: 邮箱系统标准的回复地址。指明响应消息应发往的 Mailbox 地址。
- `mbx-sent-at`: 发送时间戳 (ISO 8601)。由 Provider 在发送时自动注入。
  代表消息正式进入传输系统的时刻，是审计消息时效、监控传输延迟的权威标准。
- `mbx-attempt`: **本轮投递链内**是第几趟（1 起算，字符串）。由基类在把消息交给订阅回调前
  注入到投递**副本**上，所以重投中的回调、`_nack` 与死信记录都能看到「这一轮试了几次」。
  它是链内计数，**不是重投计数**：消息回队、下一轮投递重新从 `'1'` 数（跨轮累积看
  `mbx-round`）。没开重试策略时本轮恒为 `'1'`。
- `mbx-max-attempts`: 只在 provider 开了重试策略时注入（= `RetryPolicy.maxAttempts`）。
  上限归 provider，内核不自行发明。
- `mbx-round`: 这条消息是**第几轮**被交到消费者手里（1 起算，字符串，跨回队累积）。
  规则是「谁把消息交给消费者，谁给它 +1」：基类在每次开始订阅投递时 +1，队列在把消息交给
  `fetch()` 消费者时 +1；回队交回的始终是那份打戳副本，所以下一轮看得见累积值。
  **要在队列侧做 SQS 式 `maxReceiveCount` 上限，数的就是它，不是 `mbx-attempt`。**
- `mbx-send-id`: 「这一份信」的编号。在发送边界发一个（`MailboxProvider.send()`——`_send()`
  唯一的入口，全局唯一），随投递副本一路带着走。发号只有这一处：写在门面上第三方 provider 就得
  自己记得；让队列自己发更坏（每次 `enqueue` 一个新号 = 同一份信两本账）。
  为什么需要：`id` 会重复，而队列得分清「哪一份」——排队 / 在飞 / 回队去重 / 结算都按它。
  跳端移植注意：这个头必须随消息序列化（不能只存内存），否则一份信的副本会被当成另一份。

**自带的系统头一律不采信**（`send()` 统一剥，`post()` 也先剥一遍）：`mbx-send-id`、`mbx-round`、`mbx-attempt`、
`mbx-max-attempts`、`mbx-sent-at`，以及所有 `mbx-dead-letter*`。采信它们就等于把“重试几次”、
“要不要被封顶丢弃”、“这是不是死信记录”交给发送方定。`mbx-reply-to` 不在名单里——它是发送方自己的字段。

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

#### Inherited from

[`OutgoingMail`](OutgoingMail.md).[`headers`](OutgoingMail.md#headers)

***

### id

> `readonly` **id**: `string`

Defined in: [packages/mailbox/src/interfaces.ts:105](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L105)

消息标识。如果未提供，Mailbox 将自动生成。

**它是发送方给的名字，不是系统的状态键。** 名字重复是可以的：同一个 id 发两次、
两个发送方撞名、恶意发送方故意撞名，都不应该让系统把别人的信当成这一份丢掉。
队列、在飞表、回队去重、结算全部按「哪一份」记账（每份信一个 `mbx-send-id`，
在发送边界发一个：`MailboxProvider.send()`，发送方伪造不了），而不是按 id。

想要【内容级幂等】（同一份内容只投递一次）：那是**发送边界上的显式策略**，目前未实现——
发送侧**不会**按 id 丢弃重复信件。需要就自己在 `post()` 前判，并自己决定怎么告知调用方。

#### Overrides

[`OutgoingMail`](OutgoingMail.md).[`id`](OutgoingMail.md#id)

***

### meta?

> `optional` **meta?**: `object`

Defined in: [packages/mailbox/src/interfaces.ts:96](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L96)

本邮件消息的附加数据（邮件的数据平面），是消息的业务内容的补充元信息，由业务应用自定义和使用。
系统只负责透传，不进行解析和干预。本质上是邮件的一部分。

#### Index Signature

\[`key`: `string`\]: `any`

#### Inherited from

[`OutgoingMail`](OutgoingMail.md).[`meta`](OutgoingMail.md#meta)

***

### to

> `readonly` **to**: `URL`

Defined in: [packages/mailbox/src/interfaces.ts:107](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L107)
