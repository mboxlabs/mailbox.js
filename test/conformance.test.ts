/**
 * conformance 套件入口。
 *
 * 语义规范见 `wiki/delivery-semantics.md`；用例在 `conformance/cases/*.json`。
 *
 * 判定规则：
 *  - `FAIL` / `ERROR` ⇒ 必须处理：要么修实现，要么改用例并在规范里写清理由。不许改测试迁就实现。
 *  - `NOT-SUPPORTED` ⇒ 不算失败，它是**缺口清单**（报告里逐条列出缺哪个特性）。
 *
 * 报告写到 `conformance/report/ts.md`（差异矩阵，可直接贴进论文 P2 与 issue 正文）。
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const CASES_DIR = join(here, '../wiki/paper/conformance/cases')
const REPORT_DIR = join(here, '../wiki/paper/conformance/report')

/** runner 回给测试的结果形状（只声明这里要读的字段，不 import paper 仓库的类型）。 */
interface CaseResult {
  id: string
  group: string
  title: string
  status: 'pass' | 'fail' | 'error' | 'not-supported'
  diffs: string[]
}

// `wiki/` 是独立仓库：内核单独 clone 时没有 paper 树，这里跳过而不是红。
// 守卫之外**不能有静态 import**——静态 import 在模块解析阶段就炸，`skipIf` 来不及生效。
// 所以路径拼成运行期的值，由守卫决定要不要去解析它。
const suitePresent = existsSync(CASES_DIR)
const runnerSpec = new URL('../wiki/paper/conformance/runner/ts.ts', import.meta.url).href
describe.skipIf(!suitePresent)('conformance [投递语义用例]', () => {
  it('已实现特性覆盖到的用例必须符合规范（差异矩阵见 conformance/report/ts.md）', async () => {
    const { runSuite } = (await import(runnerSpec)) as {
      runSuite: (casesDir: string, reportDir: string) => Promise<CaseResult[]>
    }
    const results = await runSuite(CASES_DIR, REPORT_DIR)

    const counts = {
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      error: results.filter((r) => r.status === 'error').length,
      notSupported: results.filter((r) => r.status === 'not-supported').length,
    }

    const failures = results
      .filter((r) => r.status === 'fail' || r.status === 'error')
      .map(
        (r) =>
          `${r.id} [${r.group}] ${r.title}\n    - ${r.diffs.join('\n    - ')}`
      )

    // 让矩阵在测试输出里直接可见，省一次打开报告文件
    // （用 process.stdout.write：eslint 只允许 warn/error）
    process.stdout.write(
      `\n[conformance] 合计 ${results.length} 例：` +
        `pass ${counts.pass} / fail ${counts.fail} / error ${counts.error} / not-supported ${counts.notSupported}\n`
    )

    expect(
      failures,
      `语义偏差 ${failures.length} 条：\n  - ${failures.join('\n  - ')}`
    ).toEqual([])
  }, 180_000)
})
