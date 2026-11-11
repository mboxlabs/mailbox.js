[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / copyForPeek

# Function: copyForPeek()

> **copyForPeek**\<`T`\>(`message`): `T`

Defined in: [packages/mailbox/src/lib/utils.ts:173](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/lib/utils.ts#L173)

给只读快照（peek）做一份消息副本。

副本是必需的：直接把队列里的对象交给调用方，调用方改一下字段就等于改了队列内容，
「只读」就成了空话。拷贝强度写清楚，不做「假装深拷贝」：

- 信封（`id` / `from` / `to` / `headers` / `meta` 等顶层字段）**总是**新对象，
  `from` / `to` 是新的 `URL` 实例；
- `body` / `headers` / `meta` 尽量深拷贝（`structuredClone`）；
  body 里带函数、类实例等克隆不了的东西时，只能共享引用（不抛错）——
  peek 保证的是「不出队、不建 in-flight、信封不被回写」，不是「body 绝对隔离」。

## Type Parameters

### T

`T`

## Parameters

### message

`T`

队列中保存的消息。

## Returns

`T`

与 `message` 不是同一个引用的副本。
