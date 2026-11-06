/**
 * 排版卫生：Markdown 表格按原文输出，插件不许把 printer 的能力面写歪
 *
 * `pnpm format` 覆盖所有 `.md`（glob 见 package.json 的 format 脚本），而 prettier 的 mdast printer 会把每栏填充到该列最宽单元格的
 * 长度。README 的能力表、状态表单格就 100+ 字符，于是一次 `format:fix` 把整张表的每一行都补成
 * 同样宽的长尾空格：diff 全是纯空格，逐字推敲过的正文被冲散，md 在 `git diff` 里彻底没法读。
 * `prettier-plugin-md-raw-table.mjs` 就是关掉这件事——prettier 没有「表格不格式化」的开关。
 *
 * 插件另起一个 astFormat（内置 printer 不接受用户按 astFormat 覆盖），所以要自己声明 printer。
 * 这里钉的就是这件事的四个失败面：
 *
 * 1. **表格按原文**——对照组是同一输入走内置 printer：它**会**把表填平。少了对照组，这条断言
 *    会在 printer 哪天不填表格时空转，而「永远绿的守卫」正是这条文件要防的东西。
 * 2. **`<!-- prettier-ignore -->` 不许炸**（回归）：手写转发表 `key: (...a) => base.key?.(...a)`
 *    等于把 base **没有**的 key 也声明成「我有」。prettier 只要看见 `printPrettierIgnored`
 *    是个函数就调它，拿到 `undefined` 当 doc，直接 `InvalidDocError: Unexpected doc 'undefined'`。
 *    3.8.3 的 mdast printer 没有这个 key，3.9.6 才有——同一份插件就是这样在两个版本之间坏的
 *    （本包吃 3.8.3，plan-executor 吃 3.9.6）。现在的写法是 `...base` 展开，能力面永远等于 base。
 * 3. **内嵌 ```ts / ```yaml 照常按项目配置格式化**：换 parser 不能把内嵌那轮的选项继承弄丢，
 *    否则 README 里的代码示例会被格式化成与代码库相反的引号/分号风格。
 * 4. **幂等**：`format(format(x)) === format(x)`。不幂等 = `pnpm format` 永远红，
 *    而一条永远红的检查会被所有人主动绕过（issue 06 的病因就是这个）。
 *
 * 顺带钉接线：`.prettierrc` 里真的引用了这个插件文件，且 `format` 与 `format:fix` 覆盖同一批
 * 文件——`format` 管 md 而 `format:fix` 不管，`pnpm style:fix` 就修不好 `pnpm style` 报的东西。
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as prettier from 'prettier'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = 'prettier-plugin-md-raw-table.mjs'

const scripts = (JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>
}).scripts

/** 走仓库自己的 `.prettierrc`：选项与插件都从那里来，接线断了这里就红。 */
async function config() {
  const cfg = await prettier.resolveConfig(resolve(ROOT, 'README.md'))
  if (!cfg) throw new Error('.prettierrc 没被 prettier 读到')
  return cfg
}

async function format(source: string, usePlugin = true): Promise<string> {
  const cfg = await config()
  return prettier.format(source, {
    ...cfg,
    plugins: usePlugin ? cfg.plugins : [],
    parser: 'markdown',
    filepath: 'fixture.md',
  })
}

/** 同一张表，故意不齐：列宽、分隔行都不 canonical */
const RAGGED_TABLE = [
  '| 能力 | 说明 |',
  '| --- | --- |',
  '| status | 很长很长很长很长很长很长很长很长很长很长很长很长的一段说明 |',
  '| peek | 短 |',
  '',
].join('\n')

/**
 * README.cn.md 现在就是这个形状：列表项里的段落有一行没缩进（markdown 的 lazy
 * continuation），后面的表就被 remark 归到另一个位置形状里——切片的首行开始带原文缩进。
 * 不剔那个缩进就是表头 6 空格、表体 3 空格：表格散架，且不幂等。
 */
const LAZY_CONTINUATION = [
  '2. 编写代码',
  '',
  '   可重试指 `x`，或 `y` 属于 `503 /',
  'ETIMEDOUT`。其余就是**放弃**。',
  '',
  '   | 动作 | API |',
  '   | --- | --- |',
  '   | 发布 | `post()` |',
  '',
].join('\n')

/** 连续的表格行算一组；组内行首缩进必须一致，否则那张表在渲染器里就散了 */
function tableGroups(text: string): { lines: number; indents: number[] }[] {
  const runs: { lines: number; indents: number[] }[] = []
  let cur: { lines: number; indents: number[] } | null = null
  for (const line of text.split('\n')) {
    if (/^\s*\|/.test(line)) {
      if (!cur) {
        cur = { lines: 0, indents: [] }
        runs.push(cur)
      }
      cur.lines++
      cur.indents.push(line.match(/^ */)![0].length)
    } else cur = null
  }
  return runs
}

describe('Markdown 表格按原文输出', () => {
  it('接线在位：.prettierrc 引用的插件文件真的存在', async () => {
    const cfg = await config()
    expect((cfg.plugins ?? []).map((p) => String(p).split('/').pop())).toContain(PLUGIN)
    expect(existsSync(resolve(ROOT, PLUGIN)), `${PLUGIN} 没提交进仓库：.prettierrc 会直接让 prettier 报错`).toBe(true)
  })

  it('[语义] 表格不被填平，其余照常格式化', async () => {
    const src = `正文   与  表格。\n\n${RAGGED_TABLE}\n- 项目\n`
    const out = await format(src)
    expect(out).toContain(RAGGED_TABLE.trimEnd())
    expect(out).not.toMatch(/ {20,}/)
    expect(out, '正文/列表应当照常被排版').not.toBe(src)
  })

  it('对照组：内置 printer 会把同一张表填平（否则上面的断言是空转）', async () => {
    const builtin = await format(RAGGED_TABLE, false)
    expect(builtin).not.toContain(RAGGED_TABLE.trimEnd())
    // 填到该列最宽单元格的**显示宽度**（CJK 按双宽算），于是短行拖出一条长尾空格
    expect(builtin).toMatch(/ {20,}/)
  })

  it('[回归] <!-- prettier-ignore --> 不许炸：base 没有的能力不许自己造', async () => {
    const src = [
      '<!-- prettier-ignore -->',
      '| 原样 | 保留 |',
      '| ---- | --- |',
      '|   x  |  y  |',
      '',
    ].join('\n')
    // 手写转发表的下场：InvalidDocError: Unexpected doc 'undefined'
    await expect(format(src)).resolves.toContain('|   x  |  y  |')
  })

  it('[语义] 内嵌 ```ts 仍按 .prettierrc 格式化（singleQuote / semi:false）', async () => {
    const out = await format('```ts\nconst x = { a: "b" };\n```\n')
    expect(out).toContain("const x = { a: 'b' }")
    expect(out, '分号被加回来 = 内嵌那轮丢了项目配置').not.toMatch(/const x = \{ a: 'b' \};/)
  })

  it('[语义] ```md 围栏连围栏标记一起按原文（内嵌那轮绕开本插件）', async () => {
    const fence = '```md\n' + RAGGED_TABLE.trimEnd() + '\n```'
    expect(await format(fence + '\n')).toContain(RAGGED_TABLE.trimEnd())
  })

  it('[语义] 嵌在列表项里的表不被缩进弄散', async () => {
    const out = await format(LAZY_CONTINUATION)
    const groups = tableGroups(out)
    expect(groups.map((g) => g.lines), '表格行数不许变（变了就是表头与表体被拆开）').toEqual([3])
    for (const g of groups) expect(new Set(g.indents).size, `表体缩进不齐：${g.indents.join('/')}`).toBe(1)
  })

  it('[语义] 幂等：格式化一次与两次必须一样，否则 format 永远红', async () => {
    const src = [
      '# 标题',
      '',
      RAGGED_TABLE,
      LAZY_CONTINUATION,
      '<!-- prettier-ignore -->',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```ts',
      'const x = { a: "b" };',
      '```',
      '',
    ].join('\n')
    const once = await format(src)
    expect(await format(once)).toBe(once)
  })
})

describe('format 与 format:fix 必须管同一批文件', () => {
  /** 从脚本里取出 glob 的扩展名集合 */
  function extensions(script: string): string[] {
    const m = script.match(/\*\*\/\*\.\{([^}]*)\}/)
    return m ? m[1].split(',').map((ext) => ext.trim()).sort() : []
  }

  it('两个脚本覆盖同一组扩展名', () => {
    expect(
      extensions(scripts['format:fix'] ?? ''),
      `format = ${JSON.stringify(scripts.format)} / format:fix = ${JSON.stringify(scripts['format:fix'])}：` +
        '只有一边管 md，pnpm style:fix 就修不好 pnpm style 报的东西',
    ).toEqual(extensions(scripts.format ?? ''))
  })

  // 自检：正则烂掉的话上面那条永远绿
  it('检测器自己有效', () => {
    expect(extensions('prettier --check "**/*.{md,json}"')).toEqual(['json', 'md'])
    expect(extensions('prettier --write "**/*.{json}"')).toEqual(['json'])
    expect(extensions('prettier --check "**/*.md"')).toEqual([])
  })
})
