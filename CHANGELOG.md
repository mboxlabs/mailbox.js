# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [2.0.0](https://github.com/mboxlabs/mailbox.js/compare/v1.0.0...v2.0.0) (2026-11-10)


### ⚠ BREAKING CHANGES

* `MessageQueue.ack/nack` now locate a COPY by its system key, not by the sender's message id. v1.0.0: `ack(messageId): void` and `nack(messageId, topic, requeue): void`. Now: `ack(key, leaseId?): boolean` and `nack(key, requeue, leaseId?): boolean`, where the key is `send:<mbx-send-id>` — the per-copy id the system writes at the send boundary — or `obj:<tag>` for a copy that carries no such header (8985c6a, d1dc9be). A three-argument `nack(id, topic, requeue)` no longer compiles: `topic: string` has nowhere to land. `queue.ack(message.id)` still compiles and silently returns `false`, because a sender-written id may repeat and would settle whichever copy happens to answer to it; the bare header value misses the same way, since the key is prefixed. Migrate: settle through the handle `fetch`/`subscribe` hands you, or resolve key and leaseId first with `queue.locate(...)`. Search the changelog under the exported class name `MailMessageQueue`; `MemoryEventBus` carries the same signatures but was not exported in v1.0.0, so for it this is an addition.
* an address the provider has no record of no longer reports `state: 'online'` (fe9b66e). `MemoryProvider` answers `state: 'unknown'` with `exists: false`; v1.0.0 answered online with `unreadCount: 0`, so "does not exist" and "idle" were indistinguishable on a diagnostics page. `MailboxStatus.lastActivityTime` is widened to `string | null`, and `mem:` fills `null` for "no activity" so the key survives `JSON.stringify` instead of vanishing. The field is still optional and the widened type is a ceiling, not a promise: a provider that leaves it out — or the fallback `status()` object for a provider without the `status` capability — serializes without the key. Additive on the same shape: `exists`, `inFlightCount`, and provider keys such as `mem.overdueInFlightCount`. Migrate: branch on `exists` / `state` rather than on `lastActivityTime === undefined`, and keep your `??` fallback on the timestamp.
* `mem:` addresses carrying a query or a hash are rejected instead of folded away (fe9b66e, issue#4). v1.0.0 folded `mem:inbox@host/thread?thread=1` down to `mem://inbox@host/thread`, so two addresses that looked distinct shared one queue. `getCanonicalMailboxAddressIdentifier` — and through it every `MemoryProvider` entry point, because `topicOf` folds the address into the queue key — now throws `InvalidMailboxAddressError`. Migrate: what takes part in addressing is the identity segment plus the path; query, fragment, and headers take no part. Keep the identity where it is and move the distinguishing part into the path (`mem:inbox@host/thread-1`). `mem:inbox@hostA/thread` and `mem:inbox@hostB/thread` stay two queues, and a header tags copies of one queue rather than splitting it. This is `mem:`'s own policy, not a kernel rule — `MemoryProvider.addressGrammar` declares query/fragment `rejected`, and another scheme may let the query address (see `MailboxAddressGrammar`).
* on `mem:`, a message now goes down one road instead of two (aa55ce9). v1.0.0's `publish` broadcast to subscribers *and* enqueued unconditionally, so an address with both a subscriber and a `fetch` consumer saw every message twice. Now an address with at least one subscriber delivers through the subscriber only: with no delivery failure, nothing enters the queue, `fetch()` on that address returns `null` from then on, and `status().unreadCount` reads 0 where v1.0.0 read 1 — no compile error, no runtime error, so the old push-plus-pull combination silently stops consuming. (On the failure road a queue copy can still appear; see the settlement note below.) The change is deliberate (a subscriber that never fetched grew `unreadCount` forever, and re-subscribing redelivered already-handled messages), but the migration is a design choice, not a rename: pick one road per address, or `unsubscribe` before draining the queue.
* a manual-ack fetch that omits a lease now takes a 30-second one and gets redelivered (aa55ce9). v1.0.0's `fetch` overloads declared only `{ manualAck?: boolean }`, but the published options type carried an open index signature and the implementation chain honoured `ackTimeout` end to end (`_fetch` → `staleTimeout` → a sweep that ran only on a truthy value): an explicit v1 `ackTimeout: 60000` really did lease, while an omitted or `0` value never swept — at-most-once, meaning taken is yours, no retry, no `mbx-round`. Now an omitted, negative, or non-finite `ackTimeout` becomes `DEFAULT_ACK_TIMEOUT` (30s), and every manual-ack fetch sweeps the leases whose own `expiresAt` has passed. The affected set is exactly those three — omitted, negative, `NaN`/`Infinity`; an explicit `ackTimeout: 0` or `null` still means "this lease never expires" and does not flip. Migrate: pass `ackTimeout: 0` or `null` to keep the v1 behaviour, or keep the default and make the handler idempotent.
* a subscriber callback that throws no longer reaches `post()` (e56a451). v1.0.0 invoked subscribers synchronously inside `publish`, so the throw unwound through `_send` and made `await mailbox.post(...)` reject — the sender could see the failure at the send site, and no copy reached the queue. Now the throw is normalised into a failed delivery and handed to the per-delivery settlement barrier: `post()` resolves either way (pinned by the test that reads "post() 不应 reject"), and the copy is picked up by settlement — requeued when every delivery failed and the failure is retriable, otherwise dead-lettered per policy. Two consequences: `try { await post() } catch` around a subscriber failure silently stops being an error channel, and on that failure road a queue copy CAN appear behind a subscribed address, so a consumer that mixes push and pull may handle the same business message twice. Migrate: watch delivery through the settlement API instead of around `post()`, and treat redelivery on that path as expected.
* **subscribe:** `Mailbox#subscribe()` and `IMailboxProvider#subscribe()` return
`Promise<Subscription>` instead of `Subscription`. `const sub = mailbox.subscribe(...)` now stores a
Promise, so `sub.unsubscribe()` throws and `sub.status` is `undefined`; an un-awaited `subscribe()` also
means the callback may never be registered at all — a silent no-op, not a slower yes. Errors split in
two: bad addresses and unknown schemes still throw synchronously, provider-side failures now reject.
`Subscription['status']` no longer includes `'connecting'`.

* declare the six published-surface breaks Step 1 carries ([c50ead9](https://github.com/mboxlabs/mailbox.js/commit/c50ead9f377b0613d9cb963442a77cbee9778b8d))


### Features

* **contract:** settle by disposition value, one disposition per fetch, capabilities as data ([787033d](https://github.com/mboxlabs/mailbox.js/commit/787033da69ae9206f1159a85603493f32e8c7ce5))
* **lease:** an explicit recovery path, so reclaim does not depend on a poller ([ed37d5a](https://github.com/mboxlabs/mailbox.js/commit/ed37d5a1176f04f31cea943c82e1c40636a15b40))
* make subscriber failures explicit with opt-in retry ([aa55ce9](https://github.com/mboxlabs/mailbox.js/commit/aa55ce97ddf06e213589f012d7b2bf5d3e3ee5d0))
* **subscribe:** the await completes before the subscription exists ([d69aad7](https://github.com/mboxlabs/mailbox.js/commit/d69aad77cf4f1c4be1634c52a44eb370bc5dc7f3))


### Bug Fixes

* **dead-letter:** parking is a third state, so nack(false) keeps its one promise ([ecb04f0](https://github.com/mboxlabs/mailbox.js/commit/ecb04f0e2a785c43f36e4604d7177990bfb06a3c))
* **delivery:** hand back the stamped copy, and give providers a countable round ([8830499](https://github.com/mboxlabs/mailbox.js/commit/8830499d59e4571746ac17739452b49ebfb8889f))
* **delivery:** the error summary must never throw — it sits on the settlement path ([9ced0dd](https://github.com/mboxlabs/mailbox.js/commit/9ced0dd399ecc49e1dc283045737407d4654cc57)), closes [issue#1](https://github.com/mboxlabs/issue/issues/1)
* **identity:** mint the copy id once at the send boundary; settle by our id ([d1dc9be](https://github.com/mboxlabs/mailbox.js/commit/d1dc9be2e35d5718817e661ceb74e1125bd099b5))
* **lease:** the lease records its own deadline; expired-but-unreclaimed is visible ([746f77c](https://github.com/mboxlabs/mailbox.js/commit/746f77c1d47d71ba7f6d060af60d51fe1a7949c0))
* **mailbox:** let the kernel express "give up", and ship a dead-letter reference wiring ([792151e](https://github.com/mboxlabs/mailbox.js/commit/792151e4dca467382c4c0904e4d97e7675aeb199))
* **mailbox:** make status honest, reject lossy addresses, add read-only peek ([fe9b66e](https://github.com/mboxlabs/mailbox.js/commit/fe9b66e41a0bd4d6a18322e5c5d6fd6238f9a143)), closes [#4](https://github.com/mboxlabs/mailbox.js/issues/4) [#4](https://github.com/mboxlabs/mailbox.js/issues/4)
* **mailbox:** settle broadcast deliveries per delivery, not per message ([e56a451](https://github.com/mboxlabs/mailbox.js/commit/e56a45130174c2d5f72f80cc7e118832fdbf0f67)), closes [#1](https://github.com/mboxlabs/mailbox.js/issues/1) [#2](https://github.com/mboxlabs/mailbox.js/issues/2)
* **memory:** keep the dead-letter topic nameable by the address that reads it back ([e986cc8](https://github.com/mboxlabs/mailbox.js/commit/e986cc8fa9e170835534d167800d109e25246af0)), closes [#4](https://github.com/mboxlabs/mailbox.js/issues/4)
* **memory:** key dead-letter archiving to the queue the message sat in ([fdb4f64](https://github.com/mboxlabs/mailbox.js/commit/fdb4f64edbb8f0925ab5fadf5eb0190c991c6493))
* **memory:** one give-up leaves one dead-letter record; settle first, archive second ([559ce36](https://github.com/mboxlabs/mailbox.js/commit/559ce36ca4924241102b84575467f4ca4467df86))
* **memory:** scope MemoryEventBus state per instance and make it purgeable ([ba84b22](https://github.com/mboxlabs/mailbox.js/commit/ba84b22a243ca33130f0083ca2e3482ca59ee314)), closes [#3](https://github.com/mboxlabs/mailbox.js/issues/3)
* **pkg:** the tarball gets its licence and its changelog — six phantom dependencies go ([b38c09e](https://github.com/mboxlabs/mailbox.js/commit/b38c09e2bf8e907a8897df2b3b9bc4f85b730ef9))
* **queue:** account per copy of a letter, not by the sender's id ([8985c6a](https://github.com/mboxlabs/mailbox.js/commit/8985c6aa56f47cb5555de1895b7daf3d3991b733))
* **retry:** the attempt budget is per delivery, and a delivery is subscriber × copy ([bfe897c](https://github.com/mboxlabs/mailbox.js/commit/bfe897c0a43d2a3e3adc214d7ce5a005d25e5aea))
* **subscribe:** 关闭落在订阅建立的中途时，这条订阅作废（迟到的句柄补拆） ([72c866c](https://github.com/mboxlabs/mailbox.js/commit/72c866cc97292d780d5e9233cb7afb411524072a)), closes [issue#11](https://github.com/mboxlabs/issue/issues/11)

## [1.0.0](https://github.com/mboxlabs/mailbox.js/compare/v0.2.0...v1.0.0) (2026-07-05)


### Features

* add lifecycle management (start/stop/init/close) across all implementations ([c16194a](https://github.com/mboxlabs/mailbox.js/commit/c16194a5b3a61150e366a8a9bc8fb587930c0012))
* expose providers and add getProvider method ([1b1d89a](https://github.com/mboxlabs/mailbox.js/commit/1b1d89a3dcf8c4639d67b33ce584849ce57c61ef))
* **interfaces:** refine OutgoingMail headers with detailed architectural semantics ([650c44d](https://github.com/mboxlabs/mailbox.js/commit/650c44dac3b4a70476099bced9ce825572e6e279))

## 0.2.0 (2025-11-23)


### ⚠ BREAKING CHANGES

* rename x-req-id to x-reply-to

### Features

* add abstract class MailboxProvider ([a761763](https://github.com/mboxlabs/mailbox.js/commit/a76176302c700d3c126a01826bcad0519ae1633b))
* add generateId, ack, nack methods etc ([28d175a](https://github.com/mboxlabs/mailbox.js/commit/28d175a20ed405a6d8eeeeb62255f0db29555d04))
* add input provider ([f4bad20](https://github.com/mboxlabs/mailbox.js/commit/f4bad20901ebab4473921054d5d1ba2123ecfef3))
* Add mailbox status query ([16d1767](https://github.com/mboxlabs/mailbox.js/commit/16d1767d5e0a78196c863ddeecfbaa06b0b92a2d))
* **build:** add @isdk/hash and util packages ([dc73d44](https://github.com/mboxlabs/mailbox.js/commit/dc73d44cb3fafc7661c1eaa8faaa81214fd8b527))
* **docs:** add docs ([9e976f7](https://github.com/mboxlabs/mailbox.js/commit/9e976f7a48d102f4c85b75c8efb4fd96869fbf75))
* **input-provider:** Refactor to use JSON Forms and introduce new engine ([478b68b](https://github.com/mboxlabs/mailbox.js/commit/478b68b4188225aef838db092954314b7450d9a8))
* **input:** Implement flexible date/time formatting in TerminalInputProvider ([f3b3ec8](https://github.com/mboxlabs/mailbox.js/commit/f3b3ec856dded8eb8995390505664b0e42c45ddf))
* **interfaces:** add generateId method ([5c2bf0f](https://github.com/mboxlabs/mailbox.js/commit/5c2bf0ffc2ce25a0b6ba025a39af5aed5f802aad))
* **mailbox:** Extract MessageQueue and getCanonicalMailboxAddressIdentifier ([b03b47e](https://github.com/mboxlabs/mailbox.js/commit/b03b47ef4abf9c785afc1b62132297141ead70b6))
* **mailbox:** Improve manualAck robustness and add JSDoc ([1ea05a9](https://github.com/mboxlabs/mailbox.js/commit/1ea05a98b0ba069abf9dd69d77a77d10b84b6758))
* **MailMessage:** add meta prop ([335af51](https://github.com/mboxlabs/mailbox.js/commit/335af5163aecca35cde690738c61a78cec90794e))


### Refactor

* **build:** change org and location ([8d11bb4](https://github.com/mboxlabs/mailbox.js/commit/8d11bb4788e039239951198b88ebe5ac2ff40841))
* change header prefix from `x-` to `mbx-` ([f198d28](https://github.com/mboxlabs/mailbox.js/commit/f198d28fd5a04b269b5ef5d1dcf3cc751f876400))
* **Mailbox:** adjust MailBox Fetch Options ([ab4c9bb](https://github.com/mboxlabs/mailbox.js/commit/ab4c9bb819ed90e4901282247911be6a28681d7a))
* rename MessageQueue to MailMessageQueue, Ackable to MailMessageAckable ([51f180d](https://github.com/mboxlabs/mailbox.js/commit/51f180ddb09c24144cfe33afe6ef2736a7da7887))
* rename x-req-id to x-reply-to ([ddd7e91](https://github.com/mboxlabs/mailbox.js/commit/ddd7e91063d9c9b23cad448d38840208b4a0c7ba))
* use the provider.generateId to generate mail id ([aa005e0](https://github.com/mboxlabs/mailbox.js/commit/aa005e017c49c21d2b14dfa009d56299117fd350))
