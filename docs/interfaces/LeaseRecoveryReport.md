[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / LeaseRecoveryReport

# Interface: LeaseRecoveryReport

Defined in: [packages/mailbox/src/interfaces.ts:358](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L358)

`Mailbox#recover()` 的报告。

## Properties

### byAddress?

> `optional` **byAddress?**: `Record`\<`string`, `number`\>

Defined in: [packages/mailbox/src/interfaces.ts:365](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L365)

不带地址调用时：每个地址收回了几份（key = provider 自己列出的地址串）。

***

### reclaimed

> **reclaimed**: `number`

Defined in: [packages/mailbox/src/interfaces.ts:361](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L361)

实际收回了几份（幂等：紧接着再调一次通常是 0）。
 注意：`reclaimed === 0` 本身不等于“没事”——要看 `supported`。

***

### supported

> **supported**: `boolean`

Defined in: [packages/mailbox/src/interfaces.ts:363](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L363)

被调到的 provider 到底有没有“租约可回收”这个概念。

***

### unreachableProviders?

> `optional` **unreachableProviders?**: `string`[]

Defined in: [packages/mailbox/src/interfaces.ts:367](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L367)

不带地址调用时：本次碰不到的 provider（没有 `recoverLeases`，或不能枚举自身地址）。
