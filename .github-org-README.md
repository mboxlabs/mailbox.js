# 📮 MboxLabs

> **Building the future of distributed communication, one mailbox at a time.**

MboxLabs is dedicated to creating lightweight, pluggable communication infrastructure inspired by the timeless principles of the Erlang Actor Model and the simplicity of the postal system.

## 🌟 Our Philosophy

In the 1980s, Erlang's creators proposed a revolutionary idea: **Each process has its own mailbox, communicates via messages, and crashes are part of the design, not failures.**

We believe this model is more relevant than ever. MboxLabs extends these principles to modern distributed systems, enabling:

- ✅ **Independent mailboxes** instead of shared state + locks
- ✅ **Async/await** seamless integration instead of callback hell
- ✅ **Human-machine collaboration** where humans are just another mailbox address
- ✅ **Offline-first** scenarios with auto-buffered and retried messages

## 🚀 Projects

### [mailbox.js](https://github.com/mboxlabs/mailbox.js)
**TypeScript/JavaScript Implementation**

The original implementation featuring:
- 🎯 Multiple communication patterns (Push/Pull/RPC)
- 🔌 Pluggable provider architecture
- 🌐 Browser and Node.js support
- 📝 JSON Forms integration for human input

```bash
npm install @mboxlabs/mailbox
```

### [mailbox.py](https://github.com/mboxlabs/mailbox.py)
**Python Implementation**

Pure Python implementation with:
- 🐍 Python 3.7+ support
- ⚡ Async/await native support
- 🧪 Zero external dependencies
- 📦 Easy pip installation

```bash
pip install mboxlabs-mailbox
```

### [mailbox.rust](https://github.com/mboxlabs/mailbox.rust)
**Rust Implementation**

High-performance Rust implementation featuring:
- 🦀 Memory-safe and blazingly fast
- 🌐 WASM support for browser/Node.js
- 🔒 Thread-safe by design
- 📊 Zero-cost abstractions

```bash
cargo add mboxlabs-mailbox
```

## 📦 Package Naming Convention

Different package registries have different naming capabilities. Here's how we maintain consistency across platforms:

| Platform | Naming Format | Examples |
|----------|--------------|----------|
| **npm** | `@mboxlabs/<name>` | `@mboxlabs/mailbox`, `@mboxlabs/input`, `@mboxlabs/email` |
| **PyPI** | `mboxlabs-<name>` | `mboxlabs-mailbox`, `mboxlabs-input`, `mboxlabs-email` |
| **crates.io** | `mboxlabs-<name>` | `mboxlabs-mailbox`, `mboxlabs-input`, `mboxlabs-email` |

### Why Different Names?

- **npm** supports scoped packages (`@scope/name`), which provides clear namespacing
- **PyPI** and **crates.io** don't support scopes, so we use the `mboxlabs-` prefix
- This ensures all our packages are easily discoverable and clearly branded

### Rust Note

In Rust code, hyphens in package names are automatically converted to underscores:

```rust
// Cargo.toml
[dependencies]
mboxlabs-mailbox = "0.1"

// In your code
use mboxlabs_mailbox::Mailbox;
```

## 🎯 Core Concepts

### Mailbox Address

Every destination is identified by a universal address following [RFC 3986](https://tools.ietf.org/html/rfc3986):

```
protocol:user@physical_address[/logical_address]
```

**Examples:**
- `mem:api@myservice.com/utils/greeter` - In-memory local service
- `mailto:support@company.com` - Email-based communication
- `slack:team@workspace/channel` - Slack integration

### Communication Patterns

| Pattern | Use Case | Example |
|---------|----------|---------|
| **Subscribe (Push)** | Real-time notifications | Chat messages, alerts |
| **Fetch (Pull)** | Work queue processing | Job queues, batch processing |
| **RPC** | Request-response | API calls, service invocation |

### Provider Architecture

Providers implement the transport layer, making the system truly protocol-agnostic:

```
┌─────────────┐
│   Mailbox   │  ← Universal API
└──────┬──────┘
       │
   ────┼────────────────────
       │
   ┌───┴────┬────────┬──────┐
   │ Memory │ Email  │ HTTP │  ← Pluggable Providers
   └────────┴────────┴──────┘
```

## 🌍 Use Cases

- **Distributed AI Agents**: Coordinate multiple AI agents with message passing
- **Microservices**: Decouple services with async messaging
- **Human-in-the-Loop**: Seamlessly integrate human input into automated workflows
- **Offline-First Apps**: Build resilient applications that work offline
- **Event-Driven Systems**: Implement pub/sub patterns across different transports

## 🤝 Why MboxLabs?

| Traditional Approach | MboxLabs Approach |
|---------------------|-------------------|
| Tight coupling between services | Loose coupling via addresses |
| Protocol-specific code | Protocol-agnostic design |
| Complex error handling | Built-in retry and buffering |
| Humans as special cases | Humans as first-class participants |

## 📚 Documentation

Each project has comprehensive documentation:

- [mailbox.js Documentation](https://github.com/mboxlabs/mailbox.js#readme)
- [mailbox.py Documentation](https://github.com/mboxlabs/mailbox.py#readme)
- [mailbox.rust Documentation](https://github.com/mboxlabs/mailbox.rust#readme)

## 🙏 Inspiration

MboxLabs is inspired by:

- **Erlang/OTP** - The Actor Model and "let it crash" philosophy
- **The Postal System** - 500 years of reliable message delivery without assuming the recipient is waiting at the door
- **REST** - The power of addressable resources
- **Email** - Universal, asynchronous, and human-friendly communication

## 🛠️ Contributing

We welcome contributions to all our projects! Each repository has its own contribution guidelines:

- Check the `CONTRIBUTING.md` in each project
- Open issues for bugs or feature requests
- Submit pull requests with improvements

## 📄 License

All MboxLabs projects are licensed under the MIT License.

---

<div align="center">

**Remember**: In the Mailbox world, **every mailbox is an independent universe, and messages are messengers traveling through space and time** 🌌

Made with ❤️ by the MboxLabs Team

</div>
