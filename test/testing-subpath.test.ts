/**
 * 发包卫生：子路径 `@mboxlabs/mailbox/testing` 必须真的接得上
 *
 * `exports` 里写了一条、构建却没产出那个文件，是这类接线**最安静**的失败：本地测试全绿（测试从
 * `src/` 里 import），装包的下游一 `import` 就 `ERR_MODULE_NOT_FOUND`。所以这里同时钉三头：
 * `exports` 的指向、`tsup` 的入口、以及两边对得上。
 *
 * 顺带钉一条反向主张：测试基座**不在**主入口里。`import { TestProvider } from '@mboxlabs/mailbox'`
 * 能补全出来，就等于对生产代码说「拿这个当 provider 用吧」——那是 `@mboxlabs/mailbox-memory` 的事。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

/** 剔注释（`//` 前缀不看 `:`，不切 `https://`），再把真 import 的模块路径抽出来。 */
const importSpecifiers = (source: string): string[] =>
  [
    ...source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
  ].map((match) => match[1])

describe('@mboxlabs/mailbox/testing 的出口接线', () => {
  const pkg = JSON.parse(read('../package.json'))

  it('[exports] ./testing 三个条件都指向 dist/testing', () => {
    expect(pkg.exports['./testing']).toMatchObject({
      types: './dist/testing/index.d.ts',
      require: './dist/testing/index.js',
      import: './dist/testing/index.mjs',
    })
  })

  it('[build] tsup 真的产出这个入口（exports 指了但没构建 = 装上就 import 不到）', () => {
    expect(read('../tsup.config.ts')).toMatch(/src\/testing\/index\.ts/)
  })

  it('[boundary] 主入口不顺手把 testing 带出去', () => {
    const barrel = read('../src/index.ts')
    expect(barrel).not.toMatch(/testing/)
    expect(barrel).not.toMatch(/TestProvider/)
  })

  it('[boundary] 子路径只转 ./test-provider，不绕道核心 barrel 或 memory', () => {
    // `export {}` 与 `export type {}` 两行同一个路径，所以看集合而不看列表。
    expect(new Set(importSpecifiers(read('../src/testing/index.ts')))).toEqual(new Set(['./test-provider']))
  })
})
