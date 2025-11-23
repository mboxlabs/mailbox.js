[**@mboxlabs/mailbox**](../README.md)

***

[@mboxlabs/mailbox](../globals.md) / getCanonicalMailboxAddressIdentifier

# Function: getCanonicalMailboxAddressIdentifier()

> **getCanonicalMailboxAddressIdentifier**(`address`): `string`

Defined in: [lib/utils.ts:12](https://github.com/isdk/mailbox.js/blob/1e8a61dbb4de95dd24f8cbd844f69aacb91df06c/src/lib/utils.ts#L12)

Generates a canonical string identifier for a mailbox address.
This function normalizes the input URL by stripping sensitive information (like password)
and irrelevant parts (like search parameters and hash fragments). This ensures that
different URL representations of the same conceptual mailbox address resolve to

the same unique identifier within the messaging system.

## Parameters

### address

`URL`

The URL object representing the mailbox address.

## Returns

`string`

A canonical string identifier for the mailbox address.
