[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / assertLosslessMailboxAddress

# ~~Function: assertLosslessMailboxAddress()~~

> **assertLosslessMailboxAddress**(`address`, `context?`): `void`

Defined in: [packages/mailbox/src/lib/utils.ts:38](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/utils.ts#L38)

校验一个地址在规范化时不会**静默丢掉**信息——**这是 scheme 可以采用的策略，不是内核规则**。

背景：[getCanonicalMailboxAddressIdentifier](getCanonicalMailboxAddressIdentifier.md) 把地址折成
`protocol//user@host/pathname`，query / hash 会被丢掉。于是
`mem:inbox@host/thread?thread=1` 与 `mem:inbox@host/thread` 塌成同一条队列
（issue#4：「看起来能用、实际共用一条队列」）。`mem:` 这个 scheme 对此选的策略是
**拒绝**：邮箱语义必须留在 path 里。

但这条规则**不该由内核统一强加**（D5）：换一种折叠方式（比如 query 参与寻址、或整套
href 都是键），query 就完全可以合法。内核只保证「同一个 provider 的每个入口给出同一个
判定」；策略在哪定义、怎么声明，见 [MailboxAddressGrammar](../interfaces/MailboxAddressGrammar.md)。

因此这里只剩一个 provider 侧 helper：**要采用「拒绝 query / hash」这条 scheme 策略的实现
在自己的入口调它**（`MemoryProvider` 就是这么做的）。

## Parameters

### address

`URL`

待校验的地址。

### context?

`string` = `'mailbox address'`

出错信息里带上的调用点名字（例如 `'peekParked()'`），便于定位。

## Returns

`void`

## Deprecated

内核不再调用它（`src/mailbox.ts` 一次都不用）。它随
[getCanonicalMailboxAddressIdentifier](getCanonicalMailboxAddressIdentifier.md) 一起属于 `mem:` 形状的折叠规则；
拆包那一版（`3.0.0`）会从核心导出面移除，provider 需要就自带一份。

## Throws

地址带 query 或 hash 时抛出。
