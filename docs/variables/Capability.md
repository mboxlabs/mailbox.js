[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Capability

# Variable: Capability

> `const` **Capability**: `object`

Defined in: [packages/mailbox/src/lib/capability.ts:9](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/capability.ts#L9)

能力名（capability id）。**内核只认这个名字，不认方法存在性。**

名字是稳定的公开契约：provider 声明它、诊断面读它、上层策略用它选路、
conformance runner 拿它决定该跑哪些用例。加新能力 = 加一个字符串，不改类型。

## Type Declaration

### Clear

> `readonly` **Clear**: `"clear"` = `'clear'`

provider 能丢弃自己持有的积压消息（`clear()`）。

### DeadLetter

> `readonly` **DeadLetter**: `"dead-letter"` = `'dead-letter'`

provider 会把判死的投递按**自己协议**归档（`mem:` 是死信 topic；SMTP 是 bounce…）。

这条必须跟着配置走：`MemoryProvider` 只在 `enableDeadLetterQueue()` 之后声明它。
声明与开关漂移 = 声明说谎（`cap-01` / `cap-02` 钉的就是这个）。

### disposition

> `readonly` **disposition**: (`where`) => `string`

处置词汇的扩展名：`disposition:<where>`。

`handled` / `unhandled` / `discard` 是内核词汇，不用声明；provider 想接受别的处置值
（人类端点的 `answered`、`expired`……）就必须显式声明它，否则内核在把处置交下去之前
就报错。声明 = 「我认这个值，而且我知道怎么处理」。

#### Parameters

##### where

`string`

#### Returns

`string`

### ListAddresses

> `readonly` **ListAddresses**: `"listAddresses"` = `'listAddresses'`

provider 能列出自己认得的地址（消息确实在本地）。

### Parked

> `readonly` **Parked**: `"parked"` = `'parked'`

provider 有「**停放**」这一态：判死、不再交付、但没被丢弃，能在状态里数出来、能读出来。

声明它 = 「`ack('discard')` 之后有一条记录留在那里可查」。没有这个能力，
`discard` 就是纯丢弃、零痕迹——那也合法，只是别指望查得到。

### Peek

> `readonly` **Peek**: `"peek"` = `'peek'`

`fetch({ peek: true })` 是只读的（不会把消息取走）。

### RecoverLeases

> `readonly` **RecoverLeases**: `"recoverLeases"` = `'recoverLeases'`

provider 有「租约」概念，能把到期未回的在飞信收回队列。

### Settle

> `readonly` **Settle**: `"settle"` = `'settle'`

provider 接了处置钩子 `_settle(message, where)`（新的处置入口）。

### Status

> `readonly` **Status**: `"status"` = `'status'`

`status(address)` 能给出真实答复（而不是「问不到」）。
