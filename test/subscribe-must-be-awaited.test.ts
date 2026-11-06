/**
 * 文档卫生：`subscribe()` 不许不带 await
 *
 * `subscribe()` 从 v1 的同步返回变成 `Promise<Subscription>`（对齐 Python `Mailbox.subscribe`
 * / Rust `Mailbox::subscribe`）。这次改动**唯一没法靠类型系统兜住的失败模式**是「忘记 await」：
 *
 * ```
 * mailbox.subscribe(addr, cb)          // 编译通过（返回值没人用）
 * await mailbox.post({ to: addr, … })  // cb 可能根本没注册；错误也只是个 unhandled rejection
 * ```
 *
 * 编译器只抓得住「用了返回值」的调用点（`Property 'unsubscribe' does not exist on type
 * 'Promise<Subscription>'`）。剩下那类——语句位置、结果不接——只能钉在这里，写错一次就红，
 * 而不是靠人记得。README 里的示例同样在扫描范围内：**文档教错写法比代码写错更持久**。
 *
 * 顺带钉住两条同源的坑：
 * - **mock 必须 `mockResolvedValue`**：`await` 一个非 Promise 是合法的，所以
 *   `mockReturnValue({ unsubscribe })` 会让测试全绿、同时建模的还是 v1 契约。
 * - `MemoryEventBus.subscribe` **不在**管辖范围：它是进程内总线的同步登记，不是
 *   `IMailboxProvider` 契约的一部分，把它异步化没有任何收益。
 *
 * 已知不豁免的写法：`mailbox.subscribe(…).then(…)`——本仓库统一 async/await，订阅上混
 * `.then()` 链本来就该被推到台上重写。
 *
 * 词用拼接写，免得这个测试把自己匹配进去。
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src', 'test', 'README.md', 'README.cn.md', 'CONTRIBUTING.md', 'CONTRIBUTING.cn.md']

/** 进程内总线：同步登记是它的设计（见 memory.ts `MemoryEventBus.subscribe`）。 */
const SYNC_BY_DESIGN = /\b(?:this\.)?bus$/

const CALL = /\.subscribe\(/g

interface Finding {
  file: string
  line: number
  text: string
  why: string
}

/**
 * 从调用点往回找「有没有一个还没闭合的 await」。
 *
 * 为什么要按括号深度而不是按行：`await expect(mailbox.subscribe(…)).rejects…` 与
 * `await Promise.all([ mailbox.subscribe(a, cb), … ])` 的 await 都不在调用点所在的那一段
 * 文本里——前者在开括号外，后者甚至在前一行。按行判断会把这两种正确写法报成违规，
 * 一个天天误报的守卫最后的下场就是被加 `// eslint-disable`。
 */
function awaitedAncestor(source: string, at: number): boolean {
  let depth = 0
  let awaitDepth = Number.POSITIVE_INFINITY
  let armed = false // 已经进到那个 await 的括号里了
  for (let i = 0; i < at; i++) {
    const ch = source[i]
    if (ch === '(' || ch === '[') {
      depth++
      if (depth > awaitDepth) armed = true
      continue
    }
    if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1)
      // await 的表达式已经闭合：不能继续罩后面的调用
      if (armed && depth <= awaitDepth) {
        awaitDepth = Number.POSITIVE_INFINITY
        armed = false
      }
      continue
    }
    if (source.startsWith('await', i) && !/[\w$.]/.test(source[i - 1] ?? ' ')) {
      awaitDepth = Math.min(awaitDepth, depth)
      i += 4
    }
  }
  return awaitDepth < depth
}

/** 找出「调用了 mailbox / provider 的 subscribe，但没人 await 它」的行。 */
function findUnawaitedCalls(file: string, source: string): Finding[] {
  const findings: Finding[] = []
  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') lineStarts.push(i + 1)
  }
  const lineAt = (index: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const lineText = (index: number): string => {
    const start = lineStarts[lineAt(index) - 1]
    const end = source.indexOf('\n', start)
    return source.slice(start, end < 0 ? undefined : end).trim()
  }

  for (const m of source.matchAll(CALL)) {
    const at = m.index ?? 0
    // 接收者：从 `.` 往回吃标识符（含 `!` 断言与链式的 `.`）
    let s = at
    while (s > 0 && /[A-Za-z0-9_$.!]/.test(source[s - 1])) s--
    const receiver = source.slice(s, at)
    if (!receiver || SYNC_BY_DESIGN.test(receiver)) continue
    if (/\bunsubscribe$/.test(receiver)) continue

    const text = lineText(at)
    if (/^(\/\/|\*|\/\*|`)/.test(text)) continue // 注释与 tsdoc 正文
    const before = source.slice(0, s)
    const beforeColumn = source.slice(lineStarts[lineAt(at) - 1], s)

    if (/\b(?:await|return|void)\s*$/.test(before)) continue // 就地交给 await / 交上去 / 显式丢弃
    if (/[=>]\s*$/.test(beforeColumn)) continue // `addr => mailbox.subscribe(…)`：promise 交给上游
    if (/[=]\s*$/.test(beforeColumn)) continue // 赋值：类型系统 + noUnusedLocals 兜住
    if (awaitedAncestor(source, at)) continue

    findings.push({
      file,
      line: lineAt(at),
      text,
      why: 'subscribe() 返回 Promise，必须 await（不 await 等于未订阅）',
    })
  }
  return findings
}

/** mock 建模的还是旧契约：`subscribe` 的 mock 用了 mockReturnValue。 */
function findStaleSubscribeMocks(file: string, source: string): Finding[] {
  const findings: Finding[] = []
  const re = new RegExp(`subscribe[^\\n]*mock${'Return'}Value\\s*\\(`, 'i')
  source.split('\n').forEach((text, i) => {
    const trimmed = text.trim()
    if (/^(\/\/|\*|\/\*)/.test(trimmed)) return
    if (re.test(text)) {
      findings.push({
        file,
        line: i + 1,
        text: trimmed,
        why: 'await 一个非 Promise 合法：这样的 mock 会让测试全绿而建模的还是旧契约，请用 mockResolvedValue',
      })
    }
  })
  return findings
}

const walk = (path: string, out: string[] = []): string[] => {
  const st = statSync(path)
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === 'dist') continue
      walk(join(path, entry), out)
    }
  }
  else if (/\.(ts|md)$/.test(path)) {
    out.push(path)
  }
  return out
}

const render = (findings: Finding[]): string[] =>
  findings.map(f => `${f.file}:${f.line}  ${f.why}\n    ${f.text}`)

describe('subscribe() 的 await 纪律', () => {
  const files = ROOTS.flatMap(root => walk(root))
  const read = files.map(file => ({ file, source: readFileSync(file, 'utf8') }))

  it('扫描范围不是空的（改了目录结构就先把这里更新）', () => {
    expect(files.length).toBeGreaterThan(30)
    // 守卫自己也在扫描范围内：规则对它误报就会被追到，而不是靠人试
    expect(files.some(f => f.includes('subscribe-must-be-awaited'))).toBe(true)
  })

  it('源码里确实有 await subscribe 的用法（防止规则被空扫描蒙过去）', () => {
    const awaited = read.reduce(
      (n, { source }) => n + (source.match(/\bawait\s+[\w$.!]*\.subscribe\(/g) ?? []).length,
      0,
    )
    expect(awaited).toBeGreaterThan(50)
  })

  it('检测器本身有效（规则写坏了不能悄悄变绿）', () => {
    // 访问器用拼接写，免得这些样例被自己的扫描当成违规
    const C = `${'sub'}scribe`
    const snippet = [
      `mailbox.${C}(addr, cb)`, // 1 违规：结果没人接，回调可能根本没注册
      `await mailbox.${C}(addr, cb)`, // 2 ok：就地 await
      `const sub = await mailbox.${C}(addr, cb)`, // 3 ok
      `const p = mailbox.${C}(addr, cb)`, // 4 赋值：类型系统 + noUnusedLocals 兜
      `this.bus.${C}(topic, cb)`, // 5 进程内总线，设计就是同步
      `await sub.un${C}()`, // 6 退订不是订阅
      `await expect(`, // 7 await 在开括号外
      `  mailbox.${C}(addr, cb)`, // 8   ok
      `).rejects.toThrow()`,
      `await Promise.all([`, // 10 并发派发
      `  mailbox.${C}(a, cb),`, // 11  ok
      `])`,
      `Promise.all([`, // 13 违规：没人等这批订阅
      `  mailbox.${C}(b, cb),`, // 14  ↑ 命中在调用点这一行
      `])`,
    ].join('\n')
    expect(findUnawaitedCalls('snippet.ts', snippet).map(f => f.line)).toEqual([1, 14])
  })

  it('没有未 await 的 subscribe() 调用', () => {
    expect(
      render(read.flatMap(({ file, source }) => findUnawaitedCalls(file, source))),
      '未 await 的 subscribe()：回调可能根本没注册，错误也只是个没人接的 rejection',
    ).toEqual([])
  })

  it('subscribe 的 mock 用的是 mockResolvedValue（不是旧契约的 mockReturnValue）', () => {
    expect(
      render(read.flatMap(({ file, source }) => findStaleSubscribeMocks(file, source))),
      '过期的 subscribe mock',
    ).toEqual([])
  })
})
