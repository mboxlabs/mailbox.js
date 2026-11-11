/**
 * `@mboxlabs/mailbox/testing` —— 子路径的出口。
 *
 * 单开一个子路径而不是塞进主入口：`TestProvider` 是给**测试**用的东西，不该出现在
 * `import { ... } from '@mboxlabs/mailbox'` 的自动补全里，也不该被生产代码顺手拿走。
 * 反过来，它必须是公开导出的：第三方 provider 作者要能拿它验自己有没有踩满 L0。
 */

export { createTestProvider, DEFAULT_TEST_PROTOCOL, TestProvider } from './test-provider'
export type { TestProviderOptions } from './test-provider'
