[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / AttemptLedger

# Class: AttemptLedger

Defined in: [lib/retry.ts:87](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L87)

按「订阅者 + 消息」维度记录已经尝试过几次。

键必须包含订阅者：订阅是广播，某个订阅者失败不代表其他订阅者也失败，重试次数不能混在一起算。
条目带 TTL，避免长期运行的进程里台账无限增长。

## Constructors

### Constructor

> **new AttemptLedger**(`ttlMs?`): `AttemptLedger`

Defined in: [lib/retry.ts:90](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L90)

#### Parameters

##### ttlMs?

`number` = `300_000`

#### Returns

`AttemptLedger`

## Accessors

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [lib/retry.ts:120](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L120)

##### Returns

`number`

## Methods

### clear()

> **clear**(): `void`

Defined in: [lib/retry.ts:116](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L116)

#### Returns

`void`

***

### count()

> **count**(`subscriptionId`, `messageId`): `number`

Defined in: [lib/retry.ts:107](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L107)

当前已尝试次数（未记录过则为 0）。

#### Parameters

##### subscriptionId

`string`

##### messageId

`string`

#### Returns

`number`

***

### record()

> **record**(`subscriptionId`, `messageId`): `number`

Defined in: [lib/retry.ts:97](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L97)

记录一次尝试，返回这是第几次。

#### Parameters

##### subscriptionId

`string`

##### messageId

`string`

#### Returns

`number`

***

### reset()

> **reset**(`subscriptionId`, `messageId`): `void`

Defined in: [lib/retry.ts:112](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/lib/retry.ts#L112)

处理成功后清零，让同 id 的消息日后还能重试。

#### Parameters

##### subscriptionId

`string`

##### messageId

`string`

#### Returns

`void`
