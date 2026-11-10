[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / withAttemptHeaders

# Function: withAttemptHeaders()

> **withAttemptHeaders**\<`T`\>(`message`, `attempt`, `maxAttempts?`, `round?`): `T`

Defined in: [packages/mailbox/src/lib/delivery.ts:316](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L316)

给投递副本打上尝试次数（不改动原对象）。

**必须返回副本**：广播里同一条消息会被投给 N 个订阅者，只有失败的那个在重投。
直接改共享对象就会把 A 的尝试次数串给 B（B 明明只被投递过一次）。
只拷信封（浅拷贝）：body / meta 引用保持不变，别在投递热路径上做深拷贝。

## Type Parameters

### T

`T` *extends* `object`

## Parameters

### message

`T`

### attempt

`number`

本轮链内的第几趟（[MBX\_ATTEMPT\_HEADER](../variables/MBX_ATTEMPT_HEADER.md)）。

### maxAttempts?

`number`

本轮链的上限；省略 = 不注入 `mbx-max-attempts`（未开重试策略）。

### round?

`number`

本轮投递轮次（[MBX\_ROUND\_HEADER](../variables/MBX_ROUND_HEADER.md)）；省略 = 不改写已有的轮次头。

## Returns

`T`
