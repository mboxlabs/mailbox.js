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
 * 拆包后这条门更强：核心仓里连折叠规则的**定义**都没有（`src/lib/scheme-address.ts` 已搬到
 * `@mboxlabs/mailbox-memory`）。所以本测试钉的是「核心零调用 + 零定义」；memory 仓自己钉
 * 「不把内部键导出出去」。
 *
 * 用运行时 `in` 断言而不是读文件文本：导出面就是模块对象的键，扫描文本会漏（改名、re-export、
 * `export type`），而 `in` 不会说谎。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

  it('[现状] 核心仓里没有折叠模块，也没有一处折叠调用', () => {
    // 定义不在核心：它是 memory 的内部键写法（§11 政策出核）。
    expect(existsSync(new URL('./scheme-address.ts', import.meta.url)), '折叠定义不该在核心仓').toBe(false)

    const src = new URL('..', import.meta.url).pathname
    const callers = sourceFiles(src)
      .filter((file) => FOLDING.some((name) => readFileSync(file, 'utf8').includes(name)))
      .map((file) => relative(src, file))
      .sort()

    // 拆包前这里是 `['lib/scheme-address.ts', 'providers/memory.ts']`；搬走之后核心应当**零**。
    // 不是「越少越好」——是内核没有能力判断 scheme 语法，调一次就是越权。
    expect(callers).toEqual([])
  })

  it('内核门面只解析地址，不折叠字段', () => {
    const kernel = readFileSync(new URL('../mailbox.ts', import.meta.url), 'utf8')
    for (const name of FOLDING) {
      expect(kernel.includes(name), `mailbox.ts 不该调 ${name}`).toBe(false)
    }
    expect(kernel).toMatch(/parseMailboxAddress/)
  })
})
