// @vitest-environment node
/**
 * 流程卫生：`pnpm test` 必须把类型检查跑在测试前面
 *
 * `typecheck` 脚本一直都在，但**没有任何地方会自动跑它**：`vitest run` 走 esbuild 转译，不做类型
 * 检查；`style` 里没有它；`release` 是 clean → build → 文档 → 版本号，连测试都不跑。于是它降级成
 * 「谁想起来谁跑」的脚本。而 `subscribe()` 从同步改成返回 Promise 这一轮恰好说明类型是这个契约
 * 最便宜的探测器：下游 `subscription: any` 加一个漏掉的 `await` 编译不报错，只在 `stop()` 时炸一句
 * `unsubscribe is not a function`；类型不在环上的那几天，抓它靠的是人肉 tsc 加语义测试。
 *
 * 钉的是**接线本身**，不是「现在有几条类型错」：`test` 谁都能顺手「优化」回 `vitest run`——它快
 * 好几秒——而一旦摘掉，漂移就又回到没人看见的那一档（mailbox-input 那条 `noUnusedLocals` 红了很久
 * 无人发现，成因就是这个）。守卫优先于记忆。
 *
 * 这里刻意**不**新加一条 `verify`（typecheck + test + lint）：这个坑的病因就是「有脚本、没有地方
 * 会跑」，再造一条脚本是复制病因，不是治病。
 *
 * 另一半坑：`typecheck` 只能跑 `tsconfig.json`。`tsconfig.release.json` 是 tsup `--dts` /
 * typedoc 的**构建输入**，那份 `noEmit: false` 且没有 `outDir`，`tsc -p` 会把 JS 就地吐进
 * `src/`（在隔壁 tool-rpc 跑过一次，吐了 32 个未跟踪文件）。所以下面除了「接上了」，还钉住「接的是哪一份」。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = (JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>
}).scripts

// `pnpm run typecheck` / `npm run typecheck` / 直接写 `tsc -p tsconfig.json` 都算
const TYPECHECK = /(?:^|\s)(?:(?:pnpm|npm) run typecheck|tsc)(?:\s|$)/
const RUNNER = /(?:^|\s)(?:vitest|jest)(?:\s|$)/

/** 类型检查存在、并且在测试运行器**之前**——顺序也算，跑在后面的类型检查只是收尾。 */
function typecheckBeforeTests(testScript: string): boolean {
  const steps = testScript.split('&&').map((step) => step.trim())
  const check = steps.findIndex((step) => TYPECHECK.test(step))
  const run = steps.findIndex((step) => RUNNER.test(step))
  return check !== -1 && (run === -1 || check < run)
}

describe('typecheck 在测试的必经之路上', () => {
  it('scripts.typecheck 真的是 tsc 跑本项目', () => {
    expect(scripts.typecheck).toMatch(/tsc\b.*-p tsconfig\.json/)
    // 发布面那份不是检查面：`noEmit: false` 且无 `outDir`，跑一次就把 JS 就地吐进 src/
    expect(
      scripts.typecheck ?? '',
      'tsconfig.release.json 是 tsup --dts / typedoc 的构建输入，会就地 emit；发布面要跑 pnpm build',
    ).not.toMatch(/tsconfig\.release\.json/)
  })

  it('scripts.test 在测试运行器之前先跑类型检查', () => {
    expect(
      typecheckBeforeTests(scripts.test ?? ''),
      `scripts.test = ${JSON.stringify(scripts.test)}：类型检查不在测试前面，` +
        '类型错误就只会被人肉 tsc 抓到（或者抓不到）',
    ).toBe(true)
  })

  // 自检：正则烂掉的话上面那条会永远绿，而「永远绿的守卫」正是这条测试要防的东西
  it('检测器自己有效：摘掉或者放后面都必须判 false', () => {
    expect(typecheckBeforeTests('vitest run')).toBe(false)
    expect(typecheckBeforeTests('FORCE_COLOR=1 vitest run')).toBe(false)
    expect(typecheckBeforeTests('vitest run && pnpm run typecheck')).toBe(false)
    expect(typecheckBeforeTests('pnpm run typecheck && vitest run')).toBe(true)
    expect(typecheckBeforeTests('pnpm run typecheck && FORCE_COLOR=1 vitest run')).toBe(true)
  })
})
