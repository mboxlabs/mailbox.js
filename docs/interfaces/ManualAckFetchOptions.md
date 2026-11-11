[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / ManualAckFetchOptions

# Interface: ManualAckFetchOptions

Defined in: [packages/mailbox/src/interfaces.ts:207](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L207)

`fetch()` 的手动 ACK 形式：消息进 in-flight，直到 ack / nack 或超时重投。

## Indexable

> \[`name`: `string`\]: `any`

## Properties

### ackTimeout?

> `optional` **ackTimeout?**: `number` \| `null`

Defined in: [packages/mailbox/src/interfaces.ts:220](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L220)

**这份租约**的时长（ms）：取走那一刻就定下并记在租约上，之后不由别人改。

省略（或负数 / 非法值）用 [DEFAULT\_ACK\_TIMEOUT](../variables/DEFAULT_ACK_TIMEOUT.md)；`0` / `null` = 这份租约永不过期，
只能由它自己的句柄 ack / nack（别的消费者再怎么清扫都不能把它抖回队列）。

注意它**不是**“清扫阈值”：到期回收扫的是每条租约自己的到期时刻。所以一个消费者拿 1ms
来取信，不会提前接管别人未到期的租约；拿 60s 来取信，也不会拖后一条早已到期的租约。
回收是惰性的（无后台定时器，只有下一次 manualAck 取信才扫）：过期未收回的份数在
provider 的扩展键里可见（`mem:` 是 `status()['mem.overdueInFlightCount']`）。

***

### manualAck

> **manualAck**: `true`

Defined in: [packages/mailbox/src/interfaces.ts:208](https://github.com/isdk/mailbox.js/blob/8da5b2e09b0f63b7665c7c5ca124fbb072ddc9a7/src/interfaces.ts#L208)
