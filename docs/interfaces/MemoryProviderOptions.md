[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MemoryProviderOptions

# Interface: MemoryProviderOptions

Defined in: [packages/mailbox/src/providers/memory.ts:429](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/providers/memory.ts#L429)

`MemoryProvider` 的可选行为。

## Properties

### leaseSweepIntervalMs?

> `optional` **leaseSweepIntervalMs?**: `number`

Defined in: [packages/mailbox/src/providers/memory.ts:439](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/providers/memory.ts#L439)

**opt-in** 的租约清扫周期（ms）。不传 / `<= 0` / 非法 = 关（默认就是关）。

默认关是因为回收本来挂在“有人来 manualAck 取信”上，往默认路径里塞定时器会改变无轮询
场景的时序。开它的理由只有一个：那个 topic 再没人来取信（最后一个消费者崩了）——过期
租约就永远挂在 in-flight 里，那种时候应当直接调 `Mailbox#recover()`，或者开这个。

定时器 `unref()`（不拖住进程退出），`close()` / `Mailbox#stop()` 时拆掉。
