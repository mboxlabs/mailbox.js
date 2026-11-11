[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MailboxAddressGrammar

# Interface: MailboxAddressGrammar

Defined in: [packages/mailbox/src/interfaces.ts:321](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L321)

一个 scheme 的地址语法声明（D5）。

「`mem:` 与 `mem://` 是不是同一个信箱」「query 算不算寻址」「authority 有没有意义」——
这些是**某个 scheme 的知识**，不是 URL 的通用规则，也不该由内核统一强加：内核一旦折叠字段
或禁止 query，就等于把某一个 scheme 的折叠规则冒充成所有人的规则（`canonicalId` 曾干过这事）。

所以内核**不解析地址内部**：地址是一个不透明 URL，能不能等价、哪里非法，由该 scheme 的
provider 声明（这里）并在自己的每个入口执行。内核只保证**一致性**：同一个地址串在
`post` / `subscribe` / `fetch` / `status` / `recover` 每个入口都按同一方式解析、交给同一个
provider——不会出现「只在一个入口合法」。

这份声明不是用来改变内核行为的（内核不看它），而是让**调用方与诊断面能问到**：运维不必读
provider 源码就知道 `mem:` 会拒绝 query。声明与行为是否一致由 conformance 用例锁
（见 `wiki/paper/conformance/cases/address.json`）。

## Properties

### authority

> **authority**: `"required"` \| `"optional"` \| `"forbidden"`

Defined in: [packages/mailbox/src/interfaces.ts:325](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L325)

`//host` 那一段在这个 scheme 里有没有意义。

***

### equivalences

> **equivalences**: `string`[]

Defined in: [packages/mailbox/src/interfaces.ts:336](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L336)

这个 scheme 认为「同一个信箱」的等价写法（由 provider 实现，并保证所有入口一致）。
例：`mem:` 声明 `mem:a@h/i` ≡ `mem://a@h/i`——多写的 `//` 是容错写法，不是另一个信箱。

***

### fragment

> **fragment**: `"rejected"` \| `"addressing"` \| `"ignored"`

Defined in: [packages/mailbox/src/interfaces.ts:331](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L331)

fragment 同上。

***

### identity

> **identity**: `string`

Defined in: [packages/mailbox/src/interfaces.ts:327](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L327)

信箱身份在哪一段，一句人话（诊断页直接读）。

***

### query

> **query**: `"rejected"` \| `"addressing"` \| `"ignored"`

Defined in: [packages/mailbox/src/interfaces.ts:329](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L329)

query 参与不参与寻址；`rejected` = 带 query 的地址在该 scheme 的入口直接报错（不静默合并）。

***

### scheme

> **scheme**: `string`

Defined in: [packages/mailbox/src/interfaces.ts:323](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L323)

这个语法属于哪个 scheme（`mem:` / `amqp:` / `input:`…）。
