**@mboxlabs/mailbox**

***

# 📮 Mailbox — Rethinking Asynchronous Programming

> A lightweight, pluggable "mailbox/queue" kernel that treats all communication as "delivering a letter to an address." An address represents a unique mailbox, which can be accessed through various transport protocols (e.g., `mem:`, `mailto:`, `slack:`) handled by different Providers.
> Use Mailbox for asynchronous communication to build fault-tolerant, distributed, human-computer collaborative systems.

[![npm](https://img.shields.io/npm/v/@mboxlabs/mailbox)](https://www.npmjs.com/package/@mboxlabs/mailbox)
[![License](https://img.shields.io/npm/l/@mboxlabs/mailbox)](LICENSE-MIT)

## 🌟 Why Mailbox?

| Traditional Way | Mailbox Way |
|---|---|
| ❌ Shared State + Locks | ✅ Isolated Mailboxes + Messages |
| ❌ Callback Hell | ✅ Seamless `async/await` Integration |
| ❌ Complex Human-Machine Collaboration | ✅ Human = A Mailbox Address |
| ❌ Difficult Offline Scenarios | ✅ Automatic Message Buffering & Retry |

### Erlang Inspiration

> _🙏 A tribute to Erlang's Actor Model_
> _"When computers were the size of rooms,
> the creators of Erlang proposed a revolutionary idea:
> **Each process has its own mailbox, communicates via messages, and crashing is not a failure but part of the design.**"_
> — Joe Armstrong, Robert Virding, Mike Williams

Mailbox is **deeply inspired by the Erlang Actor Model**, but we've made key evolutions:

| Erlang (1986) | Mailbox (Today) | Why It Matters |
|---|---|---|
| `Pid ! Message` | `send({ to: 'protocol://address' })` | **Address as Identity, Protocol as Route**: The `address` part is the mailbox's unique ID. The `protocol` (e.g., `mem`, `mailto`) is for routing. The same address can be reached via different protocols. |
| In-process FIFO Mailbox | Pluggable Providers | **Transport Agnostic**: Seamlessly switch between memory/email/telegram/Mastodon |
| Intra-node Communication | Cross-network, Cross-organization | **Truly Distributed**: Humans and machines participate as equals |

> 💡 **Our Position**:
> **Not a JavaScript clone of Erlang, but a modern expression of the Actor philosophy** —
> Using TypeScript's type safety + JavaScript's ecosystem vitality to make "address as the destination" a reality.

## 🚀 Why is Mailbox Exciting?

### 📮 What Problems Do We Solve?

| Traditional World | Mailbox World |
|---|---|
| ❌ "Service must be online to be called" | ✅ **Delivery is Success** — Don't care about the recipient's state |
| ❌ "Humans must respond in real-time" | ✅ **Human = An Address** — Process at your own pace |
| ❌ "Cross-org collaboration requires API integration" | ✅ **Email is the API** — Zero integration cost |
| ❌ "Offline mobile app = Paralyzed functionality" | ✅ **Offline is the Norm** — Messages are automatically buffered |

### 💡 Fusing Inspirations: Erlang's Wisdom + The Real World

> _"Erlang taught us: **Message passing is the cornerstone of robust systems.**
> The real world reminds us: **The postal system has worked for 500 years because it doesn't assume the recipient is waiting at the door!**"_

Mailbox combines the two:

- **Actor's Rigor**: Each destination has an independent mailbox; messages are the only way to communicate.
- **Postal System's Inclusivity**: Unified addresses, pluggable transport protocols.

```mermaid
flowchart LR
  subgraph Erlang[1986: Erlang]
    A[Lightweight Process] --> B[Message Passing]
    B --> C[Mailbox Buffer]
  end

  subgraph RealWorld[Real World]
    D[Postal Address] --> E[Letter Delivery]
    E --> F[Post Office Buffer]
  end

  Erlang -->|Inspired| Mailbox
  RealWorld -->|Inspired| Mailbox

  subgraph Mailbox[Today: Mailbox]
    G[Address as Destination\nmem://, mailto://] --> H[Message as Interaction]
    H --> I[Provider Buffer]
  end
```

## 📪 The Mailbox Address

A Mailbox address, or **MailAddress**, is the cornerstone of the system, acting as a unique, universal identifier for any destination. It follows the [RFC 3986](https://tools.ietf.org/html/rfc3986) URI specification.

- **Format**: `protocol:user@physical_address[/logical_address]`
- **Example**: `mailto:api@myservice.com/utils/greeter`

A MailAddress is composed of three parts:

- **`protocol`**: Specifies the transport method (e.g., `mailto` for email, `mem` for in-memory bus). It tells the Mailbox which provider should handle the message.
- **`user@physical_address`**: The **Physical Mailbox Address**. This is the globally unique, protocol-independent ID for a logical mailbox or service. The same physical address can be accessed via different protocols (e.g., `mem:api@myservice.com` and `mailto:api@myservice.com` point to the same logical entity).
- **`/logical_address`** (Optional): An optional path that can be used for internal routing. For example, when used with `tool-rpc`, this can route a message to a specific tool within a larger service, allowing one physical address to serve as a unified gateway for multiple logical functions.

## 🚀 Quick Start

Get a taste of Mailbox's core power in just three steps:

1. **Installation**

    ```bash
    npm install @mboxlabs/mailbox
    ```

2. **Write Code**

    ```ts
    import { Mailbox, MemoryProvider } from '@mboxlabs/mailbox';

    // 1. Create a Mailbox instance and register a memory provider
    const mailbox = new Mailbox();
    mailbox.registerProvider(new MemoryProvider());

    // 2. Subscribe to an address and define how to handle messages
    const subscription = mailbox.subscribe('mem:service@example.com/inbox', message => {
      console.log(`Message received! From: ${message.from}`);
      console.log(`Body:`, message.body);
    });

    console.log("Mailbox is set up, listening on 'mem:service@example.com/inbox'...");

    // 3. Post a mail to that address
    await mailbox.post({
      from: 'mem:client@example.com/user-1',
      to: 'mem:service@example.com/inbox',
      body: { text: 'Hello, Mailbox!' },
    });

    // Clean up
    await subscription.unsubscribe();
    ```

3. **Run It**

If you run the code above using `ts-node` or a similar tool, you'll see:

```sh
Mailbox is set up, listening on 'mem:service@example.com/inbox'...
Message received! From: mem:client@example.com/user-1
Body: { text: 'Hello, Mailbox!' }
```

This example demonstrates the basic loop of Mailbox: **Subscribe to an address -> Post a message -> Receive and process**. The address `mem:service@example.com/inbox` tells the Mailbox to use the `mem` (in-memory) protocol to deliver the message to the physical address `service@example.com` at the logical path `/inbox`. This format allows for clear and flexible routing.

## 📦 Ecosystem

| Package | Description |
|---|---|
| [`@mboxlabs/mailbox`](https://github.com/mboxlabs/mailbox.js) | The core mailbox system |
| [`@mboxlabs/mailbox-input`](https://github.com/mboxlabs/mailbox-input.js) | Input Provider: An abstract class for human-computer interaction |
| [`@mboxlabs/mailbox-email`](https://github.com/mboxlabs/mailbox-email.js) | Mailbox Provider: Email (SMTP, IMAP/POP3) |

## 📚 Learn More

- [Erlang Inspiration Deep Dive](erlang-inspiration.md)
- [5 Real-world Scenario Examples](examples.md)
- [API Reference](docs/)

## 🤝 Contributing

See [CONTRIBUTING.md](_media/CONTRIBUTING.md) — we welcome all contributors!

> **Remember**: In the world of Mailbox, **every mailbox is an independent universe, and messages are the couriers that travel through spacetime** 🌌
