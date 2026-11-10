[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / MBX\_ROUND\_HEADER

# Variable: MBX\_ROUND\_HEADER

> `const` **MBX\_ROUND\_HEADER**: `"mbx-round"` = `'mbx-round'`

Defined in: [packages/mailbox/src/lib/delivery.ts:212](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/delivery.ts#L212)

投递**轮次**的 header 名（控制平面）：这条消息是第几轮被交到消费者手里（1 起算，字符串）。

为什么必须有它：内核把「重投几次 / 上限在哪」划给 provider，就得给 provider 可数的东西。
`mbx-attempt` 只数单条链内的趟数，跨回队就归零；轮次则随消息走（回队交回的就是那份打戳
副本），所以：
- `fetch()` 兜底消费者能看出「这条已经被投递过 N 轮」；
- provider 想在队列侧做 SQS 式 `maxReceiveCount`（内核自己不做终态，见 conformance 的
  `attempt-cap-terminal`）读它就能封顶。

递增规则只有一条：**谁把消息交给消费者，谁 +1**（基类在开始一次订阅投递时 +1；队列在把
消息交给 `fetch()` 消费者时 +1）。回队不 +1，只读快照更不 +1——`peek()` 是看一眼，不是交出去。
内核只会把它往上加，绝不把消息上已有的值改回小值：provider / broker 自己带回来的计数不会被
内核抹掉。
