[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / capabilitiesOf

# Function: capabilitiesOf()

> **capabilitiesOf**(`provider`): `Set`\<`string`\>

Defined in: [packages/mailbox/src/lib/capability.ts:88](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/capability.ts#L88)

这个 provider 现在能做什么（**读**的唯一入口）。

- 自己声明过能力的（基类子类）⇒ 照它的声明答；
- 直接实现 `IMailboxProvider` 的第三方（v1.0.0 就允许）⇒ 按已实现的方法推导一份视图。
  推导只作为兼容兜底存在：它把「实现了这个方法」当成「声明了这个能力」。
  包装 / 注入过 provider 的代码必须自己变成 [CapabilityDeclaration](../interfaces/CapabilityDeclaration.md)，否则声明会和
  注入后的实现漂移——而漂移不会报错，只会让内核做出 provider 其实做不到的事。

## Parameters

### provider

[`IMailboxProvider`](../interfaces/IMailboxProvider.md)

## Returns

`Set`\<`string`\>
