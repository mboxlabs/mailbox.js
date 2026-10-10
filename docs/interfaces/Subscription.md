[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / Subscription

# Interface: Subscription

Defined in: [interfaces.ts:4](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L4)

代表一个活跃的订阅会话。

## Properties

### address

> `readonly` **address**: `URL`

Defined in: [interfaces.ts:6](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L6)

***

### id

> `readonly` **id**: `string`

Defined in: [interfaces.ts:5](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L5)

***

### status

> **status**: `"active"` \| `"connecting"` \| `"paused"` \| `"closed"`

Defined in: [interfaces.ts:7](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L7)

## Methods

### unsubscribe()

> **unsubscribe**(): `Promise`\<`void`\>

Defined in: [interfaces.ts:8](https://github.com/isdk/mailbox.js/blob/b2cd56b816fefad5a76735a170d05ff4d9372952/src/interfaces.ts#L8)

#### Returns

`Promise`\<`void`\>
