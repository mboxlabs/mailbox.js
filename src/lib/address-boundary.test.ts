/**
 * 地址折叠的**归属边界**（D5 + 拆包计划 §6.1）。
 *
 * 要钉住的是两件容易漂的事：
 *
 * 1. `mem:` 形状的折叠规则（把地址折成 `protocol//user@host/pathname`、并拒绝 query / hash）
 *    属于那个 scheme 的 provider，**不在核心导出面上**。它曾长期从 `src/index.ts` 泄漏
 *    （`export * from './lib'` → `export * from './utils'`），于是第三方拿去给自己的 provider
 *    做折叠——换一种 scheme 那就是错的（query 参与寻址的 scheme 会把两个信箱判成一个）。
 * 2. 内核只 `parseMailboxAddress`：不折叠、不判等、不禁 query / fragment。
 *
 * 用运行时 `in` 断言而不是读文件文本：导出面就是模块对象的键，扫描文本会漏（改名、re-export、
 * `export type`），而 `in` 不会说谎。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import * as publicApi from '../index'

const FOLDING = ['getCanonicalMailboxAddressIdentifier', 'assertLosslessMailboxAddress'] as const

/** 递归列出 src 下的非测试 .ts 文件。 */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      out.push(full)
    }
  }
  return out
}

describe('地址折叠的归属：`mem:` 的内部键写法不进核心导出面', () => {
  it('折叠规则不在导出面上（`in` 断言，不是文本扫描）', () => {
    for (const name of FOLDING) {
      expect(name in publicApi, `${name} 不该从 @mboxlabs/mailbox 取到`).toBe(false)
    }
  })

  it('内核那半边还在：`parseMailboxAddress` 仍然公开（它跟 scheme 语法无关）', () => {
    expect(typeof publicApi.parseMailboxAddress).toBe('function')
  })

  it('`src/lib/index.ts` 不把折叠模块导出出去（防止 `export *` 把它带回公共面）', () => {
    const barrel = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(barrel).not.toMatch(/scheme-address/)
  })

  it('除了 `mem:` 自己，核心代码没人调折叠（内核一次都不能用）', () => {
    const callers = sourceFiles(new URL('..', import.meta.url).pathname)
      .filter((file) => FOLDING.some((name) => readFileSync(file, 'utf8').includes(name)))
      .map((file) => relative(new URL('..', import.meta.url).pathname, file))
      .sort()

    // `providers/memory.ts` = 唯一使用者；`lib/scheme-address.ts` = 定义处本身。
    expect(callers).toEqual(['lib/scheme-address.ts', 'providers/memory.ts'])
  })

  it('内核门面只解析地址，不折叠字段', () => {
    const kernel = readFileSync(new URL('../mailbox.ts', import.meta.url), 'utf8')
    for (const name of FOLDING) {
      expect(kernel.includes(name), `mailbox.ts 不该调 ${name}`).toBe(false)
    }
    expect(kernel).toMatch(/parseMailboxAddress/)
  })
})
