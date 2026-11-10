[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / bindConsumerHandle

# Function: bindConsumerHandle()

> **bindConsumerHandle**(`message`, `provider`, `address`): [`AckableMailMessage`](../type-aliases/AckableMailMessage.md)

Defined in: [packages/mailbox/src/lib/handle.ts:57](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/handle.ts#L57)

把 provider 交回来的句柄套成**内核句柄**（D3 + D4 的执行点）。

内核在 `Mailbox#fetch` 这一层执行词汇表与「一次取信 = 一次处置」，而不是指望每个 provider
自己记得：第三方 provider 只要给出 `ack` / `nack(requeue)`，句柄语义就由内核兜住。

三件事：

1. **处置值先校验后执行**（[assertDisposition](assertDisposition.md)）。自定义值没声明过就抛
   `UnsupportedCapabilityError`，而且**不消耗**这个句柄的那一次处置机会——调用方还能用
   合法值补救。反过来，先把消息处理掉再报「这值我不认」就等于让调用方永远不知道有没有生效。
2. **一次取信 = 一次处置**：第二次处置（含租约到期重投后拿着旧句柄来）返回 `false`，
   不动队列、不抛错。
3. **把结果回给调用方**：provider 句柄回什么就用什么（`true` / `false`）；它不报（`undefined`）
   我们就回 `undefined`——不替它编一个 `true`。

路由到 provider 句柄的老词汇：`handled` → `ack()`；`unhandled` → `nack(true)`；
`discard` → `nack(false)`。自定义处置只可能来自声明过它的 provider，直接把它交给句柄的
`ack(where)`——「这个值意味着什么」是 provider 的协议知识，内核不参与。

句柄上没有 `nack` 却要 `unhandled` / `discard`：显式报错，不降级成 `ack()`——
那等于把「退回队列」悄悄变成「丢弃」。

## Parameters

### message

[`MailMessage`](../interfaces/MailMessage.md)

provider 交回来的（带句柄的）消息；就地换掉 `ack` / `nack`，保持对象同一性

### provider

[`IMailboxProvider`](../interfaces/IMailboxProvider.md)

负责这个地址的 provider：处置值的合法性由它的**能力声明**决定

### address

`URL`

这次取信的地址：按地址而异的能力声明要用到

## Returns

[`AckableMailMessage`](../type-aliases/AckableMailMessage.md)
