# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
