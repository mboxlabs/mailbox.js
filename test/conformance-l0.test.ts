/**
 * conformance 的第二个档案：拿 L0 基座 `TestProvider` 跑同一份用例集。
 *
 * 为什么要有这条（拆包计划 §6 步 2.0b）：`@mboxlabs/mailbox/testing` 声称自己「实现满了 L0」，
 * 但这句话原先只由 `src/testing/test-provider.test.ts` 自己论证——自己出题自己答。paper 的
 * 用例集才是第三方 provider 作者真正会拿去跑的东西，所以它必须在 `TestProvider` 上跑一遍，
 * 并且**红也要看得见红**。
 *
 * 判定与 `test/conformance.test.ts` 同规矩：
 *  - `FAIL` / `ERROR` ⇒ 要么修 `TestProvider`，要么这条用例不属于 L0（那就要在档案里显式撤回主张）；
 *  - `NOT-SUPPORTED` ⇒ 缺口清单，不是失败。但清单必须说清缺的是**特性**还是**观测通道**：
 *    用例断言了本 provider 根本给不出的观测量（比如 `mem.parkedCount`），runner 不许让它空转成 pass。
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { contractIdentityLine, runtimeStampLines } from './report-hygiene'

const here = dirname(fileURLToPath(import.meta.url))
const CASES_DIR = join(here, '../wiki/paper/conformance/cases')
const REPORT_DIR = join(here, '../wiki/paper/conformance/report')

interface CaseResult {
  id: string
  group: string
  title: string
  status: 'pass' | 'fail' | 'error' | 'not-supported'
  diffs: string[]
  missingFeatures: string[]
}

interface RunnerModule {
  runSuite: (casesDir: string, reportDir?: string, profileId?: string) => Promise<CaseResult[]>
  runSpec: (profileId: string, group: string, spec: unknown) => Promise<CaseResult>
  profileFeatures: (profileId: string) => Record<string, boolean>
}

// 同 conformance.test.ts：`wiki/` 是独立仓库，单独 clone 内核时没有 paper 树。
// 守卫之外不能有静态 import，所以路径留成运行期的值。
const suitePresent = existsSync(CASES_DIR)
const runnerSpec = new URL('../wiki/paper/conformance/runner/ts.ts', import.meta.url).href

/**
 * 「L0 主张」清单：这些用例在 `TestProvider` 上**必须**绿。
 *
 * 它们就是 `src/testing/test-provider.ts` 顶上那段「主张」的用例化版本——投递交接、发送边界、
 * 处置词汇表、一次取信一次处置、barrier、按份记账、退订取消、看门狗、回队副本带计数头、
 * in-flight 与 unread 分列。少一条就是「L0 基座其实没实现满 L0」，不许含糊过去。
 */
const L0_MUST_PASS = [
  // 处置词汇表与取信侧（D3 / D4）
  'disp-01',
  'disp-03',
  'disp-04',
  'disp-05',
  'disp-06',
  'disp-07',
  // 取信侧的可观测量（核心具名字段）
  'lease-03',
  // 投递侧：重试台账、退避、耗尽钩子、计数头
  'retry-02',
  'retry-03',
  'retry-06',
  'retry-07',
  'retry-08',
  // 结算 barrier、退订取消、看门狗、按份记账
  'settle-04',
  'settle-08',
  'settle-10',
  'settle-11',
]

describe.skipIf(!suitePresent)('conformance [L0 基座 `TestProvider` 跑同一份用例]', () => {
  it('已实现的 L0 特性覆盖到的用例必须符合规范（矩阵见 report/ts-testing.md）', async () => {
    const { runSuite } = (await import(runnerSpec)) as RunnerModule
    const results = await runSuite(CASES_DIR, REPORT_DIR, 'testing')

    const failures = results
      .filter((r) => r.status === 'fail' || r.status === 'error')
      .map((r) => `${r.id} [${r.group}] ${r.title}\n    - ${r.diffs.join('\n    - ')}`)

    const passIds = results.filter((r) => r.status === 'pass').map((r) => r.id)
    const missingClaims = L0_MUST_PASS.filter((id) => !passIds.includes(id))
    const notSupportedClaims = results
      .filter((r) => L0_MUST_PASS.includes(r.id) && r.status === 'not-supported')
      .map((r) => `${r.id} 被记成 not-supported，缺：${r.missingFeatures.join('、') || '（未列出）'}`)

    process.stdout.write(
      `\n[conformance:testing] 合计 ${results.length} 例：` +
        `pass ${passIds.length} / ` +
        `fail ${results.filter((r) => r.status === 'fail').length} / ` +
        `error ${results.filter((r) => r.status === 'error').length} / ` +
        `not-supported ${results.filter((r) => r.status === 'not-supported').length}` +
        `（L0 主张 ${L0_MUST_PASS.length} 条全绿 = ${missingClaims.length === 0}）\n`,
    )

    expect(failures, `语义偏差 ${failures.length} 条：\n  - ${failures.join('\n  - ')}`).toEqual([])
    // 主张不能靠「整组都没跑」蒙过去：主张清单本身必须被跑到并且绿。
    expect(notSupportedClaims, 'L0 主张被档案自己撤回了').toEqual([])
    expect(missingClaims, 'L0 主张的用例没跑到 / 没通过').toEqual([])

    // scheme 专属的那几组对 L0 就是缺口，必须显式记 not-supported，不许混在 pass 里充数。
    const schemeOnly = results.filter((r) => ['address', 'capability', 'producer'].includes(r.group))
    expect(
      schemeOnly.filter((r) => r.status === 'pass'),
      'scheme 政策组（地址语法取值 / 能力清单取值 / 源生入口）不该在 L0 上算 pass',
    ).toEqual([])
    expect(schemeOnly.every((r) => r.status === 'not-supported')).toBe(true)
  }, 180_000)

  it('观测通道给不出时记缺口，不空转成 pass', async () => {
    const { runSpec } = (await import(runnerSpec)) as RunnerModule
    // `parkedCount` 是 `mem:` 的命名空间扩展键；L0 没有停放，也没有这个观测量。
    // 用例不写 `requires` 就来断言它 ⇒ runner 必须报缺口，而不是拿 0 断 0 蒙成绿。
    const parked = await runSpec('testing', 'synthetic', {
      id: 'synthetic-parked',
      title: '断言了一个本档案给不出的观测量',
      given: { retry: null, subscribers: [] },
      when: [{ action: 'post', count: 1 }],
      then: { parkedCount: 0 },
    })
    expect(parked.status).toBe('not-supported')
    expect(parked.missingFeatures.join(' ')).toContain('parkedCount')

    // 反过来：L0 有的通道不能被误撤回（否则上面那条缺口过滤就成了「全都不是 pass」的后门）。
    const unread = await runSpec('testing', 'synthetic', {
      id: 'synthetic-unread',
      title: '断言的是核心具名观测量',
      given: { retry: null, subscribers: [] },
      when: [{ action: 'post', count: 1 }],
      then: { unreadCount: 1, postErrors: 0 },
    })
    expect(unread.diffs, unread.diffs.join('\n')).toEqual([])
    expect(unread.status).toBe('pass')

    // 反向控制：上面两条能绿，是因为档案真的在跑、在断。写错的期望必须红。
    const wrong = await runSpec('testing', 'synthetic', {
      id: 'synthetic-wrong',
      title: '期望着意写错',
      given: { retry: null, subscribers: [] },
      when: [{ action: 'post', count: 2 }],
      then: { unreadCount: 1 },
    })
    expect(wrong.status).toBe('fail')
    expect(wrong.diffs.join(' ')).toContain('unreadCount')
  }, 60_000)

  it('档案的特性清单不许把没有的东西写成 true', async () => {
    const { profileFeatures } = (await import(runnerSpec)) as RunnerModule
    const features = profileFeatures('testing')
    // L0 不主张的东西，清单里必须是 false（写成 true 就是谎报，缺口会被静默填掉）。
    for (const gap of [
      'fetch-lease',
      'stale-scan-lazy',
      'lease-deadline-per-lease',
      'ack-timeout-zero-never-expires',
      'lease-recover-api',
      'lease-sweeper-opt-in',
      'inflight-overdue-observable',
      'status-extension-keys',
      'requeue-dedup-guard',
      'missing-barrier-fallback',
      'dead-letter-default',
      'dead-letter-parks-not-requeues',
      'dead-letter-observable-by-subclass',
      'scheme-address-policy',
      'canonical-equivalence',
      'origin-production',
      'attempt-cap-terminal',
      'requeue-position-policy',
      'withdraw',
      'queue-capacity',
      'protocol-independent-identity',
    ]) {
      expect(features[gap], `L0 档案把 ${gap} 写成了 true`).toBe(false)
    }
  })

  it('L0 矩阵带身份行、不写运行时刻', async () => {
    const fs = await import('node:fs')
    const version = (
      JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    ).version
    // 只断自己写的这一份：`ts.md` 的身份行由 `test/conformance.test.ts` 把住（它写那个文件）。
    // 跨文件去读别人刚写的报告既有竞态，又会让本测试依赖另一个档案的新旧。
    for (const runnerId of ['ts-testing']) {
      const report = fs.readFileSync(join(REPORT_DIR, `${runnerId}.md`), 'utf8')
      const json = JSON.parse(fs.readFileSync(join(REPORT_DIR, `${runnerId}.json`), 'utf8')) as {
        runner: string
        contractVersion?: string
      }
      expect(runtimeStampLines(report), `${runnerId}.md 里出现了运行时刻`).toEqual([])
      expect(contractIdentityLine(report), `${runnerId}.md 缺身份行`).toContain(`@mboxlabs/mailbox@${version}`)
      expect(json.contractVersion, `${runnerId}.json 缺 contractVersion`).toBe(version)
      expect(json.runner).toBe(runnerId)
    }
  })
})
