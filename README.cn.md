# 📮 Mailbox — 重新思考异步编程

> 轻量可插拔的“邮箱/队列”内核，把一切通信看作“给某个地址投递一封信”。每个地址背后是一个邮箱（队列），由不同 Provider 适配：mem://（内存）、mailto://（电子邮件）、slack://（聊天）……
> 用邮箱（Mailbox）进行异步通讯，构建容错、分布式、人机协同系统。

[![npm](https://img.shields.io/npm/v/@mboxlabs/mailbox)](https://www.npmjs.com/package/@mboxlabs/mailbox)
[![License](https://img.shields.io/npm/l/@mboxlabs/mailbox)](LICENSE)

## 🌟 为什么 Mailbox？

| 传统方式 | Mailbox 方式 |
|----------|--------------|
| ❌ 共享状态 + 锁 | ✅ 独立邮箱 + 消息 |
| ❌ 回调地狱 | ✅ `async/await` 无缝衔接 |
| ❌ 人机协作复杂 | ✅ 人 = 一个邮箱地址 |
| ❌ 离线场景难处理 | ✅ 消息自动缓冲重试 |

### Erlang 灵感

> _🙏 致敬：Erlang 的 Actor 模型_
> _“在 1980 年代，当计算机还像房间一样大时，
> Erlang 的创造者们就提出了一个革命性思想：
> **每个进程有自己的邮箱，通过消息通信，崩溃不是失败而是设计的一部分**”_
> —— Joe Armstrong, Robert Virding, Mike Williams

Mailbox **深受 Erlang Actor 模型启发**，但我们做了关键演进：

| Erlang (1986) | Mailbox (Today) | 为什么重要 |
|---------------|-----------------|------------|
| `Pid ! Message` | `send({ to: 'xxx://address' })` | **地址即协议**：URI 统一标识 + 传输 |
| 进程内 FIFO 邮箱 | Provider 可插拔 | **传输无关**：内存/邮件/Wechat/Mastodon 无缝切换 |
| 同一节点内通信 | 跨网络、跨组织 | **真正分布式**：人类和机器平等参与 |

> 💡 **我们的定位**：
> **不是 Erlang 的 JavaScript 复刻，而是 Actor 思想的现代化表达** ——
> 用 TypeScript 的类型安全 + JavaScript 的生态活力，让“地址即目标”触手可及。

## 🚀 为什么 Mailbox 让人激动？

### 📮 我们解决了什么？

| 传统世界 | Mailbox 世界 |
|----------|--------------|
| ❌ “服务必须在线才能调用” | ✅ **投递即成功** —— 不关心对方状态 |
| ❌ “人类必须实时响应” | ✅ **人类 = 一个地址** —— 按自己节奏处理 |
| ❌ “跨组织协作需要 API 对接” | ✅ **电子邮件就是 API** —— 零集成成本 |
| ❌ “移动端离线 = 功能瘫痪” | ✅ **离线是常态** —— 消息自动缓冲等待 |

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

## 🚀 快速开始

只需三步，即可体验 Mailbox 的核心魅力：

1. **安装**

   ```bash
   npm install @mboxlabs/mailbox
   ```

2. **编写代码**

   ```ts
   import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox';

   // 1. 创建邮箱实例并注册一个内存提供者
   const mailbox = new Mailbox();
   mailbox.registerProvider(new MemoryProvider());

   // 2. 订阅一个地址，并定义如何处理消息
   const subscription = mailbox.subscribe('mem://service/inbox', message => {
     console.log(`收到消息！来自: ${message.from}`);
     console.log(`内容:`, message.body);
   });

   console.log("邮箱已建立，正在监听 'mem://service/inbox'...");

   // 3. 向该地址投递一封邮件
   await mailbox.post({
     from: 'mem://client/user-1',
     to: 'mem://service/inbox',
     body: { text: '你好，Mailbox！' },
   });

   // 清理
   await subscription.unsubscribe();
   ```

3. **运行**

如果使用 `ts-node` 或类似工具运行上述代码，你将看到：

```sh
邮箱已建立，正在监听 'mem://service/inbox'...
收到消息！来自: mem://client/user-1
内容: { text: '你好，Mailbox！' }
```

这个例子展示了 Mailbox 的基本循环：**订阅地址 -> 投递消息 -> 接收处理**。`mem://` 协议表示这是一条在内存中传递的消息，非常适合入门和测试。

## 📦 生态系统

| 包 | 说明  |
|-----|------|
| [`@mboxlabs/mailbox`](https://github.com/mboxlabs/mailbox.js) | 核心邮箱系统 |
| [`@mboxlabs/mailbox-input`](https://github.com/mboxlabs/mailbox-input.js) | 输入提供者：人机输入交互抽象类 |
| [`@mboxlabs/mailbox-email`](https://github.com/mboxlabs/mailbox-email.js) | 邮箱提供者：电子邮件(SMTP, IMAP/POP3) |

## 📚 深入学习

- [Erlang 灵感详解](erlang-inspiration.md)
- [5 个真实场景示例](examples.md)
- [API 速查手册](docs/)

## 🤝 贡献指南

详见 [CONTRIBUTING.cn.md](CONTRIBUTING.cn.md) —— 我们欢迎所有贡献者！

> **记住**：在 Mailbox 的世界里，**每个邮箱都是一个独立宇宙，消息是穿越时空的信使** 🌌
