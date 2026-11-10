[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Subscription

# Interface: Subscription

Defined in: [packages/mailbox/src/interfaces.ts:7](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L7)

代表一个活跃的订阅会话。

它是在 `await subscribe(...)` **完成之后**才递到调用方手上的：await 就是
「provider 确认这条订阅已生效」的时刻。

## Properties

### address

> `readonly` **address**: `URL`

Defined in: [packages/mailbox/src/interfaces.ts:9](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L9)

***

### id

> `readonly` **id**: `string`

Defined in: [packages/mailbox/src/interfaces.ts:8](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L8)

***

### status

> **status**: `"active"` \| `"paused"` \| `"closed"`

Defined in: [packages/mailbox/src/interfaces.ts:21](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L21)

订阅状态。

- `active` / `closed`：继承 [MailboxProvider](../classes/MailboxProvider.md) 的实现能给出的两个值（按“还在不在
  订阅表里”推导，不靠 provider 自己上报）。
- `paused`：**留给 provider 扩展的类型约定**。内核不实现 pause / resume，也不会在任何
  时刻产出它——把它当成“系统支持暂停”就错了；只实现了暂停语义的 provider 才能返它。

这里没有 `connecting`：订阅建立是一个 `await` 点，await 完成前根本拿不到本对象，
所以不存在「已拿到对象但还在连接中」这个可观察中间态。

## Methods

### unsubscribe()

> **unsubscribe**(): `Promise`\<`void`\>

Defined in: [packages/mailbox/src/interfaces.ts:29](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/interfaces.ts#L29)

退订。

在「handle 还在 `await` 里」的窗口里调用也安全：登记先于 await，所以退订看得见它；
拆 handle 的动作则后移到 handle 落地时（基类保证不把 `undefined` 当句柄递给 provider）。
代价是那条补拆发生在 `subscribe()` 那一侧、而不是本方法里——本方法会先返回。

#### Returns

`Promise`\<`void`\>
