[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / AttemptLedger

# Class: AttemptLedger

Defined in: [packages/mailbox/src/lib/retry.ts:91](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/retry.ts#L91)

按**投递身份**记录已经尝试过几次：一个订阅者 × 一份信（`deliveryKey`）。

两个维度都必须在键里：
- 订阅者：订阅是广播，某个订阅者失败不代表其他订阅者也失败，次数不能混算。
- 哪一份信：`id` 是发送方的名字，可以重复。只按 id 记，两封同名信就共用一本预算——
  后到那封第一趟就被判「重试耗尽」，先到那封反倒多拿到一趟。

条目带 TTL，避免长期运行的进程里台账无限增长。

## Constructors

### Constructor

> **new AttemptLedger**(`ttlMs?`): `AttemptLedger`

Defined in: [packages/mailbox/src/lib/retry.ts:94](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/retry.ts#L94)

#### Parameters

##### ttlMs?

`number` = `300_000`

#### Returns

`AttemptLedger`

## Accessors

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/mailbox/src/lib/retry.ts:119](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/retry.ts#L119)

##### Returns

`number`

## Methods

### clear()

> **clear**(): `void`

Defined in: [packages/mailbox/src/lib/retry.ts:115](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/retry.ts#L115)

#### Returns

`void`

***

### count()

> **count**(`key`): `number`

Defined in: [packages/mailbox/src/lib/retry.ts:106](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/retry.ts#L106)

当前已尝试次数（未记录过则为 0）。

#### Parameters

##### key

`string`

#### Returns

`number`

***

### record()

> **record**(`key`): `number`

Defined in: [packages/mailbox/src/lib/retry.ts:97](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/retry.ts#L97)

记录一次尝试，返回这是第几次。

#### Parameters

##### key

`string`

#### Returns

`number`

***

### reset()

> **reset**(`key`): `void`

Defined in: [packages/mailbox/src/lib/retry.ts:111](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/retry.ts#L111)

处理成功后清零，让这一份日后还能重试。

#### Parameters

##### key

`string`

#### Returns

`void`
