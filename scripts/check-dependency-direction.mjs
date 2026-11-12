#!/usr/bin/env node
/**
 * 拆包计划 §1 的「方向规则」编译器——一条命令查完，不靠人肉 review。
 *
 * 为什么必须有：拆完之后包之间的方向是**约定**，不是类型。破坏它的方式都很安静：
 *   - 核心 import 衍生包 ⇒ 包环。pnpm 12.15 实测报 `ERR_PNPM_TASK_CYCLE`；开
 *     `ignoreWorkspaceCycles` 只是不报错，任务按任意序跑 ⇒ 「旧 dist 假绿」回来。
 *   - provider 包漏进下游 `dependencies` ⇒ 已发布的 `@mboxlabs/input` 运行期拖一个
 *     provider 实现，正是拆包要消灭的那件事。
 *
 * 输出是一份**清单**（跑了哪些检查、跳过了哪些包），不是「没报错就没事」：
 * `--json` 给测试用，缺的包会显式记成 `skip:absent`，测试据此断言「检查没空转」。
 *
 * 用法：
 *   node scripts/check-dependency-direction.mjs                 # 人读
 *   node scripts/check-dependency-direction.mjs --json          # 机读
 *   node scripts/check-dependency-direction.mjs --root <dir>    # 指别的 workspace 根（测试用）
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(HERE, '..', '..')

/** 拆包计划里点过名的成员：目录名 ⇒ 角色。多出来的目录按「未知包」收进图里一起查环。 */
const ROLE = {
  mailbox: 'core',
  'mailbox-queue': 'queue',
  'mailbox-memory': 'memory',
  'mailbox-input': 'downstream',
  'mailbox-terminal': 'downstream',
  'tool-rpc': 'downstream',
}
const PROVIDER_PACKAGES = new Set(['@mboxlabs/mailbox-memory'])
/** 允许出现在衍生包 `dependencies` 里的上游（§1 依赖图）。 */
const ALLOWED_DEPS = {
  '@mboxlabs/mailbox': new Set(),
  '@mboxlabs/mailbox-queue': new Set(['@mboxlabs/mailbox']),
  '@mboxlabs/mailbox-memory': new Set(['@mboxlabs/mailbox', '@mboxlabs/mailbox-queue']),
}

const args = process.argv.slice(2)
const json = args.includes('--json')
const rootIdx = args.indexOf('--root')
const root = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : DEFAULT_ROOT

/** 只扫非测试的 `src/**\/*.ts`：核心**测试**用 `MemoryProvider` 当参照实现是合法的（§5 分派规则）。 */
function productionSourceFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist' || name === 'docs') continue
        walk(full)
      } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full)
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

/** 剔掉注释后再抽 import 说明符，否则文档里举的 `from '...'` 例子会自打。 */
function importSpecifiers(file) {
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
}

/**
 * 只看 mailbox 家族（§1 点过名的那几个）。整个 workspace 有 85 个包，把它们拉进图里只会
 * 挖出与拆包无关的既有环（实测 `@isdk/match-ex ⇄ @isdk/match-ex-schema`）⇒ 闸门长红，
 * 下次就有人直接把它关掉了。范围小、能说清，比「什么都查」有用。
 */
const members = []
for (const [dir, role] of Object.entries(ROLE)) {
  const pkgDir = join(root, dir)
  const manifest = join(pkgDir, 'package.json')
  if (!existsSync(pkgDir) || !statSync(pkgDir).isDirectory() || !existsSync(manifest)) continue
  let pkg
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch (err) {
    pkg = { name: `<无法解析 ${manifest}: ${err.message}>` }
  }
  members.push({ dir, role, name: pkg.name ?? `<无 name: ${dir}>`, pkg, manifest })
}

const byName = new Map(members.map((m) => [m.name, m]))
const checks = []
const violations = []

const record = (id, subject, status, detail) => {
  checks.push({ id, subject, status, detail })
  if (status === 'violation') violations.push({ id, subject, detail })
}

for (const m of members) {
  const deps = Object.keys(m.pkg.dependencies ?? {})
  const devDeps = Object.keys(m.pkg.devDependencies ?? {})

  // R1：核心不得依赖 / import 任何衍生包（这是包环的源头）
  if (m.role === 'core') {
    const bad = deps.filter((d) => ALLOWED_DEPS[d] && d !== m.name)
    record('R1.core-dependencies', m.name, bad.length ? 'violation' : 'ok', bad.join(', ') || '无衍生依赖')
    const hits = []
    for (const file of productionSourceFiles(join(root, m.dir, 'src'))) {
      for (const spec of importSpecifiers(file)) {
        if (/@mboxlabs\/mailbox-(queue|memory)/.test(spec)) hits.push(`${file}: ${spec}`)
      }
    }
    record('R1.core-production-imports', m.name, hits.length ? 'violation' : 'ok', hits.slice(0, 5).join(' | ') || `${productionSourceFiles(join(root, m.dir, 'src')).length} 个生产文件干净`)
  }

  // R2：衍生包的 `dependencies` 只能是允许的上游
  if (ALLOWED_DEPS[m.name]) {
    const allowed = ALLOWED_DEPS[m.name]
    const bad = deps.filter((d) => d.startsWith('@mboxlabs/mailbox') && d !== m.name && !allowed.has(d))
    record('R2.derivative-deps', m.name, bad.length ? 'violation' : 'ok', bad.length ? `不该依赖：${bad.join(', ')}` : `允许：${[...allowed].join(', ') || '（无上游）'}`)
  }

  // R3：provider 包只进下游 devDependencies
  const inDeps = deps.filter((d) => PROVIDER_PACKAGES.has(d))
  if (m.role === 'downstream' || m.role === 'queue') {
    record('R3.provider-not-in-runtime-deps', m.name, inDeps.length ? 'violation' : 'ok', inDeps.length ? `dependencies 里有 provider 包：${inDeps.join(', ')}` : 'provider 包未进 dependencies')
  }

  // R4：workspace 内部依赖图不许有环
  for (const d of [...deps, ...devDeps]) {
    if (!byName.has(d) || d === m.name) continue
    const target = byName.get(d)
    const back = [...Object.keys(target.pkg.dependencies ?? {}), ...Object.keys(target.pkg.devDependencies ?? {})]
    if (back.includes(m.name)) {
      record('R4.no-package-cycle', `${m.name} ⇄ ${target.name}`, 'violation', `${m.name} → ${target.name} 且反向也在`)
    }
  }
}

// 环检查的兜底：即便上游清单不全，也不许出现「核心 → 衍生 → 核心」这种两跳
for (const m of members) {
  if (m.role !== 'core') continue
  for (const d of Object.keys(m.pkg.devDependencies ?? {})) {
    if (byName.has(d) && ALLOWED_DEPS[d]) {
      record('R4.core-devdep-not-derivative', `${m.name} devDep ${d}`, 'violation', '核心 devDep 指回衍生包 = 任务环（ERR_PNPM_TASK_CYCLE）')
    }
  }
}

const absent = Object.entries(ROLE)
  .filter(([, role]) => role !== 'core')
  .filter(([dir]) => !members.some((m) => m.dir === dir))
  .map(([dir]) => dir)
for (const dir of absent) record('R0.presence', dir, 'skip:absent', `${root} 下没有这个目录（单仓检出时正常）`)

const ran = checks.filter((c) => c.status !== 'skip:absent').length
const report = { root, members: members.map((m) => ({ dir: m.dir, name: m.name, role: m.role })), checksRun: ran, skipped: absent, violations, checks }

if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`方向锁：root=${root}`)
  for (const m of report.members) console.log(`  成员 ${m.dir} (${m.name}) 角色=${m.role}`)
  for (const c of checks) console.log(`  [${c.status}] ${c.id} ${c.subject}${c.detail ? ` — ${c.detail}` : ''}`)
  console.log(`合计：跑了 ${ran} 项检查，跳过 ${absent.length} 个缺席包，违规 ${violations.length} 条`)
}

process.exit(violations.length ? 1 : 0)
