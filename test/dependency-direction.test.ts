/**
 * 拆包计划 §1 方向规则的闸门。
 *
 * 光查「现在没违规」不够：`violations = 0` 也可能是「什么都没扫到」。所以这里带一条**反向对照**——
 * 现场造一个故意违规的迷你 workspace，要求它必须报红、并且点名是哪条规则。没有这条，脚本改坏了
 * （路径写错、正则失效、范围筛空）全都表现为全绿。
 *
 * 命名标记：
 *   [现状] 今天这个 workspace 的真实方向。
 *   [反向控制] 脚本必须能抓到破坏，也不许误伤合法的参照实现用法。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(HERE, '../scripts/check-dependency-direction.mjs')

type Report = {
  root: string
  members: { dir: string; name: string; role: string }[]
  checksRun: number
  skipped: string[]
  violations: { id: string; subject: string; detail: string }[]
  checks: { id: string; subject: string; status: string; detail?: string }[]
}

/** `execFileSync` 在退出码非 0 时抛错，这里统一拿回 stdout + 退出码。 */
function check(root: string): { code: number; report: Report } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--json', '--root', root], { encoding: 'utf8' })
    return { code: 0, report: JSON.parse(stdout) as Report }
  } catch (err: any) {
    const stdout = typeof err.stdout === 'string' ? err.stdout : ''
    if (!stdout.trim()) throw err
    return { code: typeof err.status === 'number' ? err.status : 1, report: JSON.parse(stdout) as Report }
  }
}

const write = (root: string, rel: string, content: string) => {
  const full = join(root, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}
const pkg = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name, version: '0.0.0', ...extra }, null, 2)

describe('方向锁：今天的真实方向', () => {
  it('[现状] 家族内部零违规，而且检查确实跑了', () => {
    const { code, report } = check(resolve(HERE, '..', '..'))

    expect(report.violations, JSON.stringify(report.violations)).toEqual([])
    expect(code).toBe(0)

    // 防空转：核心那几条必须真的落到成员上
    expect(report.members.map((m) => m.dir)).toEqual(
      expect.arrayContaining([
        'mailbox',
        'mailbox-queue',
        'mailbox-memory',
        'mailbox/wiki',
        'mailbox-input',
        'mailbox-terminal',
        'tool-rpc',
      ]),
    )
    const ids = report.checks.map((c) => c.id)
    expect(ids).toContain('R1.core-dependencies')
    expect(ids).toContain('R1.core-production-imports')
    expect(ids).toContain('R5.paper-not-depended-on')
    expect(report.checksRun).toBeGreaterThanOrEqual(15)

    // 缺席要**说出来**，不许静默少查。拆到这里为止全家都在场（queue / memory / wiki 已建）；
    // 这条写成精确清单是有意的：目录被动了会直接响，而不是默默少查一项。
    expect(report.checks.filter((c) => c.status === 'skip:absent').map((c) => c.subject)).toEqual([])

    // 队列仓进图了 ⇒ 它自己的方向也得在查
    const queue = report.checks.find((c) => c.id === 'R2.derivative-deps' && c.subject === '@mboxlabs/mailbox-queue')
    expect(queue, '队列仓必须进方向图').toBeTruthy()
    expect(queue!.status).toBe('ok')
  })

  it('[现状] 核心生产码不 import 衍生包；核心 src 里也找不到 MessageQueue 之外的反向依赖', () => {
    const { report } = check(resolve(HERE, '..', '..'))
    const core = report.checks.find((c) => c.id === 'R1.core-production-imports')!
    expect(core.status).toBe('ok')
    expect(core.detail, '扫到了文件才叫扫过').toMatch(/个生产文件干净/)
  })
})

describe('方向锁：反向控制（脚本必须能抓到破坏）', () => {
  it('[反向控制] 五类破坏同时在场，五条规则必须全部点名', () => {
    const root = mkdtempSync(join(tmpdir(), 'direction-bad-'))
    try {
      // 核心 → 队列（运行期依赖）＋ 核心 devDep 指回 memory（任务环）＋ 核心 src import memory
      write(root, 'mailbox/package.json', pkg('@mboxlabs/mailbox', {
        dependencies: { '@mboxlabs/mailbox-queue': 'workspace:^' },
        devDependencies: { '@mboxlabs/mailbox-memory': 'workspace:^' },
      }))
      write(root, 'mailbox/src/sneaky.ts', "import { MemoryProvider } from '@mboxlabs/mailbox-memory'\nexport const x = MemoryProvider\n")
      // 队列 devDep 指回核心 ⇒ 任务环（ERR_PNPM_TASK_CYCLE 那条）
      write(root, 'mailbox-queue/package.json', pkg('@mboxlabs/mailbox-queue', { devDependencies: { '@mboxlabs/mailbox': 'workspace:^' } }))
      // memory 依赖下游 ⇒ 方向反了
      write(root, 'mailbox-memory/package.json', pkg('@mboxlabs/mailbox-memory', { dependencies: { '@mboxlabs/input': 'workspace:^' } }))
      // provider 包漏进下游 dependencies
      write(root, 'mailbox-input/package.json', pkg('@mboxlabs/input', { dependencies: { '@mboxlabs/mailbox-memory': 'workspace:^' } }))
      // 下游依赖论文仓（用例与报告）⇒ 核心编译程序会被 provider 包拖进来，方向锁的另一种破坏
      write(root, 'mailbox/wiki/package.json', pkg('@mboxlabs/mailbox-wiki', { private: true }))
      write(root, 'mailbox-terminal/package.json', pkg('@mboxlabs/input-inquirer', { devDependencies: { '@mboxlabs/mailbox-wiki': 'workspace:^' } }))

      const { code, report } = check(root)
      expect(code, '有违规必须非 0 退出').toBe(1)

      const fired = new Set(report.violations.map((v) => v.id))
      expect([...fired].sort()).toEqual(
        [
          'R1.core-dependencies',
          'R1.core-production-imports',
          'R2.derivative-deps',
          'R3.provider-not-in-runtime-deps',
          'R4.core-devdep-not-derivative',
          'R4.no-package-cycle',
          'R5.paper-not-depended-on',
        ].sort(),
      )
      // 没在场的包不许被凭空造出来
      expect(report.members.map((m) => m.dir).sort()).toEqual(
        ['mailbox', 'mailbox-input', 'mailbox-memory', 'mailbox-queue', 'mailbox/wiki', 'mailbox-terminal'].sort(),
      )
      // 缺席还是得点名：这个 fixture 里没建 tool-rpc
      expect(report.skipped).toEqual(['tool-rpc'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('[反向控制] 核心的**测试**拿 memory 当参照实现不算违规（§5 分派规则）', () => {
    const root = mkdtempSync(join(tmpdir(), 'direction-ok-'))
    try {
      write(root, 'mailbox/package.json', pkg('@mboxlabs/mailbox'))
      write(root, 'mailbox/src/producers.ts', "import { Mailbox } from './mailbox'\nexport const m = Mailbox\n")
      write(root, 'mailbox/src/mailbox.lease.test.ts', "import { MemoryProvider } from './providers/memory'\nexport const p = MemoryProvider\n")

      const { code, report } = check(root)
      expect(code).toBe(0)
      expect(report.violations).toEqual([])
      // 而且确实看到了那个生产文件（不是扫了个空目录）
      const core = report.checks.find((c) => c.id === 'R1.core-production-imports')!
      expect(core.detail).toBe('1 个生产文件干净')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('方向锁：脚本自己也在版本控制里', () => {
  it('[事实] 脚本存在、可执行文本可读、`package.json` 有入口', () => {
    expect(existsSync(SCRIPT)).toBe(true)
    const manifest = JSON.parse(readFileSync(resolve(HERE, '../package.json'), 'utf8'))
    expect(manifest.scripts['check:direction']).toContain('check-dependency-direction')
  })
})
