[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Ackable

# Interface: Ackable

Defined in: [packages/mailbox/src/interfaces.ts:158](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L158)

代表一个可被处置的信件句柄——它代表**这一次交付**，不是这封信。

**一次取信 = 一次处置**：句柄只生效一次。重复处置、租约到期重投后拿着旧句柄来处置，
都**不生效**，并把这个事实回给你（返回 `false`）——不抛错，也不静默 no-op。
要「先占着再定」用租约（`ackTimeout`、`ackTimeout: 0` 常驻租约），不是靠多按几次按钮。

为什么必须守住这条：重复处置若能生效，接了死信队列的 provider 就会为同一次放弃留下多条
记录（补偿脚本会重复补偿）；迟到的处置若能生效，就会误伤重投后新消费者手里的同一条消息。

## Methods

### ack()

> **ack**(`where?`): `Promise`\<`boolean` \| `void`\>

Defined in: [packages/mailbox/src/interfaces.ts:174](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L174)

结束这次交付，并说明怎么结束它（见 [CORE\_DISPOSITIONS](../variables/CORE_DISPOSITIONS.md)）。

省略 = `handled`：这一份到此为止，系统不留任何东西。`ack` 不是「处理成功了」的意思——
你怎么处理的、还是干脆判定这封信不合格，provider 不知道也不问。

#### Parameters

##### where?

[`Disposition`](../type-aliases/Disposition.md)

处置值。`handled` / `unhandled` / `discard`，或 provider 声明过的自定义值。

#### Returns

`Promise`\<`boolean` \| `void`\>

这次处置**有没有生效**：
  - `true`：生效了（消息按 `where` 收尾）；
  - `false`：没生效——这个句柄已经处置过，或它代表的那次交付已经不归它了（租约被回收、
    消息已被别的消费者处理 / 丢弃）。**调用方不该把 `false` 当成功。**
  - `undefined`：这个 provider 不报告处置结果（能力没到）。想知道就别忽略这个返回值。

处置值不被认得时**先抛错、不动消息**：句柄的「一次处置」机会不会被一个失败的调用消耗掉。

***

### ~~nack()~~

> **nack**(`requeue?`): `Promise`\<`boolean` \| `void`\>

Defined in: [packages/mailbox/src/interfaces.ts:189](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L189)

#### Parameters

##### requeue?

`boolean`

`true` = 放回队列（还会再交给我一次）；`false`（默认）= 结束它，
  **不会再交给我**，由 provider 按自己协议的规矩善后（死信 / bounce / 打标记…
  没实现就等同于丢弃，**不要指望 `nack(false)` 自带 DLQ**）。

#### Returns

`Promise`\<`boolean` \| `void`\>

语义同 [Ackable.ack](#ack)：这次处置有没有生效。

#### Deprecated

用 [Ackable.ack](#ack) 的处置值：`nack(true)` = `ack('unhandled')`，
  `nack(false)` = `ack('discard')`。

  为什么还留着：布尔参数在 `v1.0.0` 就发布了，直接把参数去掉会让老代码里的 `nack(false)`
  （= 丢弃）静默变成「退回队列」——从丢弃变成无限重投，这是语义漂移而不是编译错误。
  它会在拆包那一版（`3.0.0`）与拆包同时删除；整个 2.x 里它都是完整 alias。
