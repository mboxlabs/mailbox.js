# 📮 Mailbox — 重新思考异步编程

> 轻量可插拔的“邮箱/队列”内核，把一切通信看作“给某个地址投递一封信”。一个地址代表一个唯一的邮箱，它可以通过不同的 Provider 适配的多种传输协议（如 `mem:`、`mailto:`、`slack:`）来访问。
> 用邮箱（Mailbox）进行异步通讯，构建容错、分布式、人机协同系统。

[![npm](https://img.shields.io/npm/v/@mboxlabs/mailbox)](https://www.npmjs.com/package/@mboxlabs/mailbox)
[![License](https://img.shields.io/npm/l/@mboxlabs/mailbox)](LICENSE)

## 🌟 为什么 Mailbox？

| 传统方式          | Mailbox 方式              |
| ----------------- | ------------------------- |
| ❌ 共享状态 + 锁  | ✅ 独立邮箱 + 消息        |
| ❌ 回调地狱       | ✅ `async/await` 无缝衔接 |
| ❌ 人机协作复杂   | ✅ 人 = 一个邮箱地址      |
| ❌ 离线场景难处理 | ✅ 消息自动缓冲重试       |

### Erlang 灵感

> _🙏 致敬：Erlang 的 Actor 模型_
> _“在 1980 年代，当计算机还像房间一样大时，
> Erlang 的创造者们就提出了一个革命性思想：
> **每个进程有自己的邮箱，通过消息通信，崩溃不是失败而是设计的一部分**”_
> —— Joe Armstrong, Robert Virding, Mike Williams

Mailbox **深受 Erlang Actor 模型启发**，但我们做了关键演进：

| Erlang (1986)    | Mailbox (Today)                      | 为什么重要                                                                                                                              |
| ---------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Pid ! Message`  | `send({ to: 'protocol://address' })` | **地址即身份，协议即路由**：`address` 部分是邮箱的唯一 ID。`protocol`（例如 `mem`, `mailto`）决定路由方式。同一地址可通过不同协议访问。 |
| 进程内 FIFO 邮箱 | Provider 可插拔                      | **传输无关**：内存/邮件/Wechat/Mastodon 无缝切换                                                                                        |
| 同一节点内通信   | 跨网络、跨组织                       | **真正分布式**：人类和机器平等参与                                                                                                      |

> 💡 **我们的定位**：
> **不是 Erlang 的 JavaScript 复刻，而是 Actor 思想的现代化表达** ——
> 用 TypeScript 的类型安全 + JavaScript 的生态活力，让“地址即目标”触手可及。

## 🚀 为什么 Mailbox 让人激动？

### 📮 我们解决了什么？

| 传统世界                     | Mailbox 世界                             |
| ---------------------------- | ---------------------------------------- |
| ❌ “服务必须在线才能调用”    | ✅ **投递即成功** —— 不关心对方状态      |
| ❌ “人类必须实时响应”        | ✅ **人类 = 一个地址** —— 按自己节奏处理 |
| ❌ “跨组织协作需要 API 对接” | ✅ **电子邮件就是 API** —— 零集成成本    |
| ❌ “移动端离线 = 功能瘫痪”   | ✅ **离线是常态** —— 消息自动缓冲等待    |

### 💡 灵感融合：Erlang 智慧 + 现实世界

> _“Erlang 教会我们：**消息传递是构建健壮系统的基石**
> 现实世界提醒我们：**邮政系统运转 500 年，因为它不假设收件人此刻在家门口等待！**”_

Mailbox 将二者结合：

- **Actor 的严谨**：每个目标独立邮箱，消息是唯一通信方式
- **邮政的包容**：地址统一标识，传输协议可插拔

```mermaid
flowchart LR
  subgraph Erlang[1986: Erlang]
    A[轻量进程] --> B[消息传递]
    B --> C[邮箱缓冲]
  end

  subgraph RealWorld[现实世界]
    D[邮政地址] --> E[信件投递]
    E --> F[邮局缓冲]
  end

  Erlang -->|Inspired| Mailbox
  RealWorld -->|Inspired| Mailbox

  subgraph Mailbox[Today: Mailbox]
    G[地址即目标\nmem://, mailto://] --> H[消息即交互]
    H --> I[Provider 缓冲]
  end
```

## 📪 邮箱地址

邮箱地址（**MailAddress**）是整个系统的基石，作为任何目的地的唯一通用标识符。它遵循 [RFC 3986](https://tools.ietf.org/html/rfc3986) URI 规范。

- **格式**: `protocol:user@physical_address[/logical_address]`
- **示例**: `mailto:api@myservice.com/utils/greeter`

一个邮箱地址由三部分组成：

- **`protocol`（协议）**: 指定消息的**传输方式**（例如 `mailto` 代表通过邮件发送，`mem` 代表通过内存总线发送）。它告诉 `Mailbox` 应该由哪个提供者处理消息。
- **`user@physical_address`（物理邮箱地址）**: 这是逻辑邮箱或服务的**全球唯一、与协议无关的 ID**。同一个物理地址可以通过不同的协议访问（例如 `mem:api@myservice.com` 和 `mailto:api@myservice.com` 指向同一个逻辑实体）。
- **`/logical_address`（逻辑地址）** (可选): 一个可选的路径，可用于内部路由。例如，当与 `tool-rpc` 结合使用时，它可以将消息路由到更庞大服务中的特定工具，允许一个物理地址作为多个逻辑功能的统一网关。
  - 注意：不是所有的提供者都支持。

**query 与 fragment 不属于地址。** 地址在成为 topic 之前会被规范化为 `protocol://user@host/path`，
`?` 与 `#` 后面的内容会被静默丢掉——`mem:sales@example.com/inbox?thread=1` 和
`mem:sales@example.com/inbox` 会溻成同一个 topic，共用一条队列与一条投递路径。库不会把两个逻辑
地址合并，而是在**每个**入口（`post()` / `subscribe()` / `fetch()` / `status()`）直接拒绝这种写法
（`InvalidMailboxAddressError`）。逻辑分区的区别请写进 path：`mem:sales@example.com/inbox/thread-1`。

## 🚀 快速开始

只需三步，即可体验 Mailbox 的核心魅力：

1. **安装**

   ```bash
   npm install @mboxlabs/mailbox
   ```

2. **编写代码**

   ```ts
   import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox'

   // 1. 创建 Mailbox 实例并注册内存 Provider
   const mailbox = new Mailbox()
   mailbox.registerProvider(new MemoryProvider())

   // 2. 启动 Mailbox (初始化 Provider)
   await mailbox.start()

   // 3. 订阅一个地址并定义消息处理方式
   const subscription = mailbox.subscribe(
     'mem:service@example.com/inbox',
     (message) => {
       console.log(`收到消息！来自: ${message.from}`)
       console.log(`正文:`, message.body)
     }
   )

   console.log("Mailbox 已就绪，正在监听 'mem:service@example.com/inbox'...")

   // 4. 发送一封邮件到该地址
   await mailbox.post({
     from: 'mem:client@example.com/user-1',
     to: 'mem:service@example.com/inbox',
     body: { text: 'Hello, Mailbox!' },
   })

   // 清理：取消订阅并停止 Mailbox (释放资源)
   await subscription.unsubscribe()
   await mailbox.stop()
   ```

   1. **运行**

   如果你使用 `ts-node` 或类似工具运行上述代码，你将看到：

   ```sh
   Mailbox 已就绪，正在监听 'mem:service@example.com/inbox'...
   收到消息！来自: mem:client@example.com/user-1
   正文: { text: 'Hello, Mailbox!' }
   ```

   该示例演示了 Mailbox 的基本闭环：**初始化 -> 启动 -> 订阅 -> 发送 -> 停止**。

   ## 🎯 核心功能

   ### 1. 状态查询

   ```ts
   const status = await mailbox.status('mem:service@example.com/inbox')
   console.log(`状态: ${status.state}`) // 'online' | 'unknown' | 'degraded' | 'offline'
   console.log(`存在性: ${status.exists}`) // provider 到底认不认这个地址
   console.log(`未读数量: ${status.unreadCount}`) // 仍在队列里等待
   console.log(`in-flight: ${status.inFlightCount}`) // 已取出、尚未 ack/nack
   console.log(`订阅数: ${status.subscriberCount}`)
   console.log(`最后活动: ${status.lastActivityTime}`) // ISO 8601，没有记录时是 null
   ```

   `unreadCount` 只统计队列里等待的消息。用 `manualAck: true` 取出的消息已经离开队列但尚未
   处理完，它单独计入 `inFlightCount`；如果一直不 ack，会回到队列。

   `state` 描述的是 provider 对**这个地址**的看法。从未被碰过的地址（没投过、没订阅过、没有
   活动记录）会报 `state: 'unknown'` + `exists: false`——统一报 `online` + 0 会让诊断页分不出
   “这个地址不存在”和“这个地址空闲”。取空但确实存在的地址仍然 `online`；只有订阅者的地址也仍然
   `online`。provider 完全不支持状态查询时不会设 `exists`：“问不到”不等于“不存在”。
   `lastActivityTime` 没有记录时是 `null`，而不是 `undefined`——后者在 `JSON.stringify` 后会让整个
   字段消失。

   诊断页与测试通常要一次看到全局面。不带地址调用 `status()`（或同义的 `snapshot()`）就能拿到所有
   已注册 provider 的所有 topic：

   ```ts
   const snap = await mailbox.status()
   console.log(snap.state) // 'online' | 'degraded' | 'unknown'
   console.log(snap.addressCount) // 已注册 provider 认得的 topic 数
   console.log(snap.unreadCount, snap.inFlightCount)
   for (const entry of snap.addresses) {
     console.log(entry.canonicalId, entry.state, entry.unreadCount)
   }
   ```

   `addresses` 按 `canonicalId` 排序，快照因此可重复。AMQP / SQS 这类消息不在本地的 broker 无法枚举
   自己的 topic，它们会被列进 `unsupportedProviders`，快照降级为 `state: 'degraded'`，而不是假装
   队列为空。

   ### 2. 取消息的两种方式：订阅与取回

   四个动作对应四个 API，文档与代码里统一用这几个词：

   | 动作     | API                           | 谁在做                           |
   | -------- | ----------------------------- | -------------------------------- |
   | **发布** | `post()` / `send()`           | 生产者把一封信写进地址           |
   | **订阅** | `subscribe()`                 | 消费者登记回调，消息到达时被调用 |
   | **取回** | `fetch()`                     | 消费者自己主动取下一条           |
   | **只读** | `fetch(addr, { peek: true })` | 观察者看一眼队列，不消耗任何东西 |

   发布只是写入。一条消息只会进两个入口的**其中一个**，在 `post()` 执行那一刻定：

   | `post()` 执行时地址的状态 | 消息的去向                                              |
   | ------------------------- | ------------------------------------------------------- |
   | 至少有一个活跃订阅者      | 交给每个订阅者的回调；**不**入队，所以 `fetch()` 取不到 |
   | 没有任何订阅者            | 入队；`fetch()` 能取到，订阅者收不到                    |

   两条路对同一条消息是互斥的：已经订阅到的消息再也取回不到；已经入队的消息也不会回放给
   后来才订阅的人。

   两条路都走会让 `unreadCount` 永远增长（订阅者从不取回），还会在退订后把已处理过的消息
   再交给下一个取回者。

   唯一的例外是回调失败：回调抛可重试错误、而且没有任何订阅者处理成功时，消息会回到队列，
   这时 `fetch()` 能取到——见下一节。

   ```ts
   // subscribe：消息到达时跑回调
   const sub = mailbox.subscribe(addr, (message) => {
     console.log(message.body)
   })

   // fetch：自己主动取下一条
   const message = await mailbox.fetch(addr)

   // peek：只读地看队列——不出队、不建 in-flight、不刷活动时间
   const pending = await mailbox.fetch(addr, { peek: true, limit: 5 })
   ```

   `peek` 以**副本**形式返回队列里的消息（数组，队列空时是 `[]`），且什么都不改：`unreadCount` /
   `inFlightCount` 不动，`lastActivityTime` 不会被刷新，改返回的东西也改不到队列里那一份。在 `peek`
   之前最接近的做法是 `fetch(addr, { manualAck: true })` 然后不 ack——那会把消息卡进 in-flight
   （默认 30s 超时后重投），既不是只读，也会干扰正常消费者看到的计数。`peek` 不会列出已被别的
   消费者取走的消息，那些只体现在 `inFlightCount` 里。`peek` 与 `manualAck` 同时给出会报错
   （`InvalidFetchOptionsError`）；不支持只读快照的 provider 会报 `UnsupportedCapabilityError`，
   不会静默退化成会取信的 `fetch`。

   ### 3. 订阅失败时

   回调抛出的错误决定消息的去向：

   ```ts
   mailbox.subscribe(addr, async (message) => {
     throw Object.assign(new Error('upstream down'), { isRetriable: true }) // → 回到队列
   })

   mailbox.subscribe(addr, async (message) => {
     throw new Error('bad payload') // → 丢弃，避免一条坏消息被无限重试
   })
   ```

   可重试指 `error.isRetriable === true`，或 `error.code` 属于 `503 / 504 / ECONNRESET /
ETIMEDOUT`。可重试失败会把消息退回队列（计入 `unreadCount`，可用 `fetch()` 取回）；其余就是
   **放弃**——在自带 provider 上默认是丢弃（只有开了死信队列才会归档），而在队列 / 传输型
   provider 上，内核会先告诉传输层别再重投（`nack(message, false)`）。
   [Rust 移植版](https://github.com/mboxlabs/mailbox.rust)对回调返回的 `Result<()>`
   做同样的判定。

   一个地址可以有多个订阅者，而订阅是**广播**：一条消息对每个订阅者就是一次*投递*，每次投递
   各自结算（`deliveryId = subscriptionId + messageId`）。订阅者意见不一致时（A 成功、B 抛
   可重试错误），去向由投递级判定决定：

   | 广播结果           | 邮箱的处理                                                       |
   | ------------------ | ---------------------------------------------------------------- |
   | 有投递成功         | 消息已处理——**不**回队；失败的投递交给 `_onDeliveryDeadLettered` |
   | 全部失败且可重试   | 消息退回队列头部，由 `fetch()` 取回（只有一份）                  |
   | 全部失败且不可重试 | 直接丢弃，避免一条坏消息被无限重试                               |

   把“已经有人处理过”的消息退回队列，等于让 `fetch()` 消费者把同一段副作用再跑一遍——所以
   部分失败按投递结算，不整条回队。

   结算发生在全部投递（含重试链）落定之后。`post()` 只等派发、不等结算，因此 `post()` 之后立刻
   读 `status()` 看不出结果；要观察被丢弃的投递，就重写 `_onDeliveryDeadLettered(message,
   failedDeliveries)`（继承 `MemoryProvider`）。

   **内核不裁决的三件事。** 内核只决定要不要把投递交回去（`_nack(message, requeue)` +
   `shouldRequeueAfterBroadcast`）；重投几次、回到队列的哪个位置、放弃之后留下什么，都是
   provider 的事。几个直接后果：
   - 队列 / 传输型 provider（`broadcastDeliveries = false`，基类默认）上，不可重试失败会发出
     放弃信号：`nack(message, false)`。不发这个信号，真实 broker 就会在 visibility timeout
     后把同一条毒药消息无限重投。
   - 完全没实现 `_nack` 的 provider 收不到任何处置决定：基类会告警一次，而不是让决定静默落空。
   - 死信队列默认不存在，除非你接上。`MemoryProvider#enableDeadLetterQueue()` 就是随包提供的
     参考接法；钩子在处置（`nack`）**之后**被调，因此消息不会同时出现在队列和 DLQ 里；钩子自己
     抛错 / reject 会被记录，且不会吞掉处置判定。
   - 每次投递都在 `headers['mbx-attempt']` 上带尝试次数（开了重试策略还带
     `mbx-max-attempts`），`DeliveryResult` 也带 `attempts` 与 `error` 摘要——死信记录因此能回答
     “为什么死的、试了几次”。

   > [Python](https://github.com/mboxlabs/mailbox.py) 与 [Rust](https://github.com/mboxlabs/mailbox.rust)
   > 移植版正是这样按投递结算广播的。各移植版的 README（“Subscriber Failures and Retry”）给出
   > 自己语言的 API 名称；上面这套规则就是它们共同遵循的规范。

   ### 4. 订阅重试（opt-in）

   默认行为下，可重试失败只是把消息退回队列：没有任何东西会再次调用订阅回调，后续怎么办由
   `fetch()` 消费者决定。想让库自己重投，就显式开启重试：

   ```ts
   import { MemoryProvider } from '@mboxlabs/mailbox'

   const provider = new MemoryProvider({ maxAttempts: 3, baseDelay: 1_000 }) // 毫秒
   mailbox.registerProvider(provider)
   ```

   |            | 默认（不传 `retry`）        | 传入策略                |
   | ---------- | --------------------------- | ----------------------- |
   | 可重试失败 | 回队一次，由 `fetch()` 取回 | 按指数退避重新调用回调  |
   | 尝试次数   | 1                           | `maxAttempts`（含首次） |
   | 次数耗尽   | —                           | 没有任何投递成功时回队  |

   三条规则保证它不会造成重复投递：
   - **只重投给失败的那个订阅者。** 订阅是广播；重新广播会让已经成功的订阅者把副作用再跑
     一次。
   - **同一条消息不会在队列里出现两份。** `requeue()` 遇到已在队列或已在 in-flight 的消息就
     跳过，因此 N 个订阅者各自失败也只留一份副本。
   - **已经处理过的消息不会回队。** 只要广播里有一次投递成功，失败的投递就走死信
     （`_onDeliveryDeadLettered`），不把整条消息退回队列；回队只留给“全部订阅者都失败”。

   重试是 opt-in 的，因为 AMQP / SQS 这类传输本身就会重投、还自带死信队列，库再重投就是双重
   投递；自己负责投递的 provider 应当保持关闭。`provider.setRetryPolicy(null)` 回到默认行为，
   子类可以用 `_onRetryExhausted` 钩子告警（注意：次数耗尽 ≠ 放弃，消息仍会回队），
   用 `_onDeliveryDeadLettered` 落库那些不回队的失败投递。

   不想自己写钩子，可以直接用随包提供的接法：

   ```ts
   const provider = MemoryProvider.createIsolated()
   provider.enableDeadLetterQueue() // 默认后缀 '_dlq'；可传 { suffix: '.dlq' }
   mailbox.registerProvider(provider)

   // 每一条“被放弃而不是被回队”的投递都会归档到 <topic>_dlq：
   const dead = await mailbox.fetch(
     provider.deadLetterTopic('mem://sales@bus/inbox')!
   )
   // dead.headers['mbx-dead-letter-reason']   -> 'fatal' | 'retriable' | 'consumer-nack'
   // dead.headers['mbx-dead-letter-attempts'] -> '3'
   // dead.headers['mbx-dead-letter-error']    -> 'Error: bad payload'
   // dead.headers['mbx-dead-letter-topic']    -> 它原来所在的队列
   ```

   它是 opt-in 的：死信队列是运维决定，不是内核默认——它会往一个总得有人消费的 topic 里多写
   一份消息。关掉时行为照旧（直接丢弃）。它覆盖两种放弃：订阅侧的失败投递，以及 `fetch()`
   消费者自己 `nack(false)`。

   同一套策略——相同的可重试判定、相同的退避公式、相同的“永不重复入队”规则——在
   [Python](https://github.com/mboxlabs/mailbox.py) 与 [Rust](https://github.com/mboxlabs/mailbox.rust)
   移植版里都有实现，各语言的具体构造写法见各自 README。

   策略本身也是导出的：`RetryPolicy`、`isRetriableError`、`nextRetryDelay`、`AttemptLedger`——
   其他包（比如 RPC 传输层）可以直接复用同一套「可重试判定 + 退避」，不必各写一份。
   投递记账同样是导出的：`DeliveryResult`、`shouldRequeueAfterBroadcast`。

   ### 5. ACK 超时

   `fetch(address, { manualAck: true })` 会把消息置为 in-flight。没有超时的话，崩溃的消费者会
   永久泄漏这条消息，因此未 ack 的消息默认在 `DEFAULT_ACK_TIMEOUT`（30 秒）后重新入队：

   ```ts
   import { DEFAULT_ACK_TIMEOUT } from '@mboxlabs/mailbox'

   await mailbox.fetch(addr, { manualAck: true }) // 默认 30 秒
   await mailbox.fetch(addr, { manualAck: true, ackTimeout: 5_000 }) // 自定义
   await mailbox.fetch(addr, { manualAck: true, ackTimeout: 0 }) // 永不重投
   ```

   [Python](https://github.com/mboxlabs/mailbox.py) 与 [Rust](https://github.com/mboxlabs/mailbox.rust)
   移植版保持同样的三态：缺省超时、自定义超时、永不重投。

   ### 6. 结算兜底与 provider 契约（超时、竞态）

   一条广播只有当**每一次投递都结算**之后才算结算——§3 那套投递级回队规则止因此成立，隐患也正好藏
   在这里。四道兜底：
   - **卡死的回调不会让消息隐形。** 每次投递*尝试*都被 `provider.deliverySettleTimeout` 监控
     （默认 `DEFAULT_DELIVERY_SETTLE_TIMEOUT` = 30 秒）。到期后该尝试按 `cancelled` 结算：消息回到
     `fetch()` 兜底（或死信钩子），并记一条告警。看门狗只对单次尝试计时，退避等待不计时，因此不会
     掐断健康的重试链。`provider.deliverySettleTimeout = 0` 则显式退出：生命周期由调用方负责，
     永不返回的回调会让这条消息在任何队列里都看不见。
   - **`unsubscribe()` / `stop()` 不替正在执行的回调下结论。** 只取消停在重试退避里的投递。还在跑的
     回调自己结算；提前当成失败会让整条广播被误判为“无人成功”，从而把同一段副作用交给 `fetch()`
     消费者再跑一次。
   - **同 `id` 的并发投递各自独立结算。** `post({ id })` 允许调用方指定 id，因此同一个订阅者上并发的
     两次投递绝不共用结算记账。该去重的地方仍然去重：已在队列或 in-flight 的消息不会被二次入队。
   - **漏实现 `_nack` 不会静默致命。** 所有处置决定（`requeue = true` 回队、`requeue = false` 放弃）
     都走 `nack()`。完全不实现 `_nack` 的 provider 一个都收不到，消息会停在传输层把它放的地方；
     基类会按 provider 告警一次，而不是假装决定已经执行。

   自己实现**广播型** provider（`broadcastDeliveries = true`）时，`_send` 必须挂上结算 barrier——而且
   是同步挂上（在任何 `await` 之前）：

   ```ts
   protected async _send(message: MailMessage): Promise<void> {
     const deliveries = this.bus.publish(topic, message) // 每次投递一个 promise
     this._trackBroadcastSettlement(message, deliveries)
   }
   ```

   漏接 barrier 的 provider 不会静默丢消息：基类会兜底整条回队，并告警提醒接上。自己组装消息再投给
   本地订阅者的生产者型 provider，必须走 `_deliverToLocalSubscription(subscriptionId, message)`，
   否则那次投递根本不进记账。

   ### 7. 访问 Provider

   你可以通过 `providers` Getter 或 `getProvider` 方法优雅地访问已注册的 Provider：

   ```ts
   // 获取所有 Provider (返回一个 ReadonlyMap)
   const allProviders = mailbox.providers
   if (allProviders.has('mem')) {
     console.log('内存 Provider 已注册')
   }

   // 获取特定 Provider
   // protocol 可以是 "mem" 或 "mem:"
   const provider = mailbox.getProvider('mem')

   // 获取 Provider，如果不存在则抛出错误
   const slackProvider = mailbox.getProvider('slack', true)
   ```

   ## 🔄 生命周期管理

   对于健壮的生产系统，显式的生命周期管理至关重要：
   - **`mailbox.start()`**: 并行初始化所有已注册的 Provider。使用它来预热连接（如 Redis、RabbitMQ）并在处理流量前验证配置。
   - **`mailbox.stop()`**: 并行关闭所有 Provider。它会自动执行以下操作：
   - 取消该 Mailbox 实例下所有活跃的订阅。
   - 释放底层资源（TCP 连接、文件句柄等）。
   - 确保通信层的优雅关闭（Graceful Shutdown）。

   它不会销毁积压消息：关闭后重新 `start()` 的 Provider，队列里的残留依旧可见。需要一并清掉用
   `mailbox.stop({ purge: true })`。

   ## 🧵 实例隔离与状态重置（`mem:` Provider）

   `MemoryProvider` 用内存总线模拟一个“服务端”。默认情况下，所有 `MemoryProvider` 共用进程级
   单例总线，因此同进程里所有 `Mailbox` 实例看到的是同一份 `mem:` 队列与订阅表，而且这份状态
   在 `stop()` 之后仍然存在。这是有意的设计——跨 `Mailbox` 投递就靠它——但当你需要彼此独立
   （宿主 + 插件、kernel + provider、不得互相串台的测试）时，必须显式选定边界：

   ```ts
   // 1. 自带私有总线 —— 同进程里没人看得到它的队列与订阅。
   const isolated = MemoryProvider.createIsolated()

   // 2. 命名空间 —— 同 scope 内共享，跨 scope 互不可见。
   const tenant = MemoryProvider.forScope('tenant-a')

   // 3. 自己传总线 —— 例如两个就是需要共享一个“服务端”的 Mailbox。
   const shared = new MemoryProvider(null, new MemoryEventBus())
   ```

   重置状态而不拆订阅：

   ```ts
   await mailbox.clear() // 丢弃各 provider 的积压消息（等待中 + in-flight）
   await mailbox.stop({ purge: true }) // 先拆订阅，再清空积压
   provider.bus.clear('mem://inbox@example.com') // 只清一个 topic，返回被丢弃的消息数
   ```

   需要注意的代价：
   - `clear()` 只丢消息，不拆订阅。拆连接是 `unsubscribe()` / `stop()` 的职责。
   - 在默认总线上，`clear()` 清的是全进程的 `mem:` 命名空间——共享“服务端”就是这个含义。
     不想这样就用 `createIsolated()` / `forScope()`。
   - 同一个 provider 实例不得注册到两个 Mailbox：订阅表挂在 provider 上，一边的 `stop()` 会拆掉
     另一边的订阅。看到这种复用时库会告警一次。
   - scope 注册表不会自动回收：带时间戳/随机后缀的 scope 名会把那份总线钉到进程结束。
     用完就丢的场景用 `createIsolated()`。

   ## 📦 生态系统

| 包                                                                          | 说明                                                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`@mboxlabs/mailbox`](https://github.com/mboxlabs/mailbox.js)               | 核心邮箱系统                                                                                    |
| [`@mboxlabs/mailbox-input`](https://github.com/mboxlabs/mailbox-input.js)   | 输入提供者：人机输入交互抽象类                                                                  |
| [`@mboxlabs/mailbox-email`](https://github.com/mboxlabs/mailbox-email.js)   | 邮箱提供者：电子邮件(SMTP, IMAP/POP3),待实现                                                    |
| [`mboxlabs-mailbox`（crates.io）](https://github.com/mboxlabs/mailbox.rust) | Rust 移植版 — `cargo add mboxlabs-mailbox`（v0.1.0，可编译为 WASM）                             |
| [`mailbox.py`](https://github.com/mboxlabs/mailbox.py)                      | Python 移植版 — `pip install git+https://github.com/mboxlabs/mailbox.py.git`（尚未发布到 PyPI） |

> **一份规范，三种实现。** 地址格式、订阅与取回二选一、投递级结算、opt-in 重试与 ACK 超时只在本
> README 里定义一次，TypeScript、Python、Rust 三端等价实现；改动语义时三套测试（`vitest` / `pytest`
> / `cargo test`）必须同时通过。

## 📚 深入学习

- [API 速查手册](docs/)

## 🤝 贡献指南

详见 [CONTRIBUTING.cn.md](CONTRIBUTING.cn.md) —— 我们欢迎所有贡献者！

> **记住**：在 Mailbox 的世界里，**每个邮箱都是一个独立宇宙，消息是穿越时空的信使** 🌌
