[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / parseMailboxAddress

# Function: parseMailboxAddress()

> **parseMailboxAddress**(`input`, `context?`): `URL`

Defined in: [packages/mailbox/src/lib/utils.ts:80](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/utils.ts#L80)

把地址解析成 URL。**内核对地址只做这一件事**（D5）。

内核不折叠字段、不判等、不禁止 query / fragment：那些都是 scheme 的语法知识，由该 scheme
的 provider 声明（[MailboxAddressGrammar](../interfaces/MailboxAddressGrammar.md)）并实现。内核能保证的是**一致性**：
同一个地址串在 `post` / `subscribe` / `fetch` / `status` / `recover` 每个入口都按同样的方式
解析、喂给同一个 provider——不会出现「只在一个入口合法」。

地址内部是否合法（`mem:` 就拒绝 query / hash，因为它的折叠会丢掉它们）由 provider 在
自己的入口判，错误照样从 `post()` 传回调用方。

## Parameters

### input

`string` \| `URL`

地址字符串或 URL 对象。

### context?

`string` = `'mailbox address'`

出错信息里带上的调用点名字。

## Returns

`URL`

解析后的 URL。

## Throws

连 URL 都解析不了（这跟地址语法无关）。
