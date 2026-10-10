[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / RetryPolicy

# Interface: RetryPolicy

Defined in: [lib/retry.ts:17](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L17)

订阅失败后的重试策略。

注意：重试是 **opt-in** 的。默认（`null`）保持「失败只回队、不自动重投」的行为，
因为 AMQP / SQS 这类传输层自带重投与死信，库再重投就是双重投递。

## Properties

### baseDelay

> **baseDelay**: `number`

Defined in: [lib/retry.ts:21](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L21)

首次重试前的等待毫秒数。

***

### factor?

> `optional` **factor?**: `number`

Defined in: [lib/retry.ts:23](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L23)

退避倍数，默认 2。

***

### maxAttempts

> **maxAttempts**: `number`

Defined in: [lib/retry.ts:19](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L19)

总尝试次数，含首次。必须 >= 1；1 等价于不重试。

***

### maxDelay?

> `optional` **maxDelay?**: `number`

Defined in: [lib/retry.ts:25](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L25)

单次等待上限（毫秒），默认 30_000。
