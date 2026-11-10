[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / CapabilityDeclaration

# Interface: CapabilityDeclaration

Defined in: [packages/mailbox/src/lib/capability.ts:56](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/capability.ts#L56)

能力声明的形状（D6）。

**能力是运行期可变的数据 + 谓词，不是类型化字段。** 为什么不是 `canPeek: boolean` 这类字段：
provider 的能力会被运行期改变——包装 / 注入（AoP）、配置开关（`enableDeadLetterQueue()`）、
按地址而异（本地队列型能枚举，代理型不能）。类型化字段表达不了「谁注入了谁更新」，
而字段与实现漂移后编译器也不会报错。

规矩只有一条：**未声明 = 没有这个操作**；谁给 provider 注入能力，谁就更新它的声明。

## Properties

### supports

> `readonly` **supports**: `Set`\<`string`\>

Defined in: [packages/mailbox/src/lib/capability.ts:58](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/capability.ts#L58)

可变的能力集合。读它 = 看这个 provider 现在能做什么；改它 = 声明变了。

## Methods

### can()

> **can**(`operation`, `address?`): `boolean`

Defined in: [packages/mailbox/src/lib/capability.ts:65](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/capability.ts#L65)

这个 provider 现在能不能做 `operation`。

`address` 是给按地址而异的实现留的口（同一 provider 的不同 scheme / 不同信箱能力不同）。
默认实现就是 `supports.has(operation)`。

#### Parameters

##### operation

`string`

##### address?

`URL`

#### Returns

`boolean`
