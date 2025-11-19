/**
 * Generates a canonical string identifier for a mailbox address.
 * This function normalizes the input URL by stripping sensitive information (like password)
 * and irrelevant parts (like search parameters and hash fragments). This ensures that
 * different URL representations of the same conceptual mailbox address resolve to

 * the same unique identifier within the messaging system.
 *
 * @param address The URL object representing the mailbox address.
 * @returns A canonical string identifier for the mailbox address.
 */
export function getCanonicalMailboxAddressIdentifier(address: URL): string {
  const userInfo = address.username ? `${address.username}@` : '';
  return `${address.protocol}//${userInfo}${address.host}${address.pathname}`;
}
