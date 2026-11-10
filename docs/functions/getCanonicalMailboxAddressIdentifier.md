[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / getCanonicalMailboxAddressIdentifier

# ~~Function: getCanonicalMailboxAddressIdentifier()~~

> **getCanonicalMailboxAddressIdentifier**(`address`): `string`

Defined in: [packages/mailbox/src/lib/utils.ts:117](https://github.com/isdk/mailbox.js/blob/9a9ab648c6685904ec3d46d73ed38e14ca1b5eef/src/lib/utils.ts#L117)

Generates a canonical string identifier for a mailbox address.
This function normalizes the input URL by stripping sensitive information (like password)
and irrelevant parts (like hash fragments).

**它不是内核的寻址规则**（D5）：内核不用它，也不用 `canonicalId` 判等或排序。它只是
`mem:` 这类 scheme 的**内部键写法**——「`mem:a@h/i` 与 `mem://a@h/i` 是同一个信箱」是
`mem:` 的语法声明，不是 URL 的通用规则。别的 scheme 完全可以拿整套 href 当键、或让 query
参与寻址（那时这个函数会把它判成同一个信箱，正是错的）。

曾有的坑：折叠会丢掉 query / hash，于是带它们的地址**静默**并入另一条队列（issue#4）；
`mem:` 的对策是在折叠前先拒绝（见 [assertLosslessMailboxAddress](assertLosslessMailboxAddress.md)）。换成别的 scheme，
对策就得由那个 scheme 自己写。

## Parameters

### address

`URL`

The URL object representing the mailbox address.

## Returns

`string`

A canonical string identifier for the mailbox address.

## Deprecated

公开契约里不该有它（`MailboxAddressSnapshot.canonicalId` 已移除）。
`MemoryProvider` 内部仍用它给队列取键；第三方 provider 需要同款折叠就自带一份。
拆包那一版（`3.0.0`）会从核心导出面移除——`mailbox-input` 已经不再调它（实测）。

## Throws

地址带 query / hash（它们无法在这个折叠里保留）。
