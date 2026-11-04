/**
 * 文档卫生：那些“系统替你做了”的假承诺不许回来
 *
 * 这类句子在本仓库里活了很久（而且因为 docs 树里有一份 `interfaces.ts` 的引文副本，改了一处
 * 另一处还在）：
 *
 *   「邮箱系统通过此 ID 识别并丢弃内容重复的信件，确保同一份信息不会被物理重复投递」
 *
 * 两头都不对：发送侧从来没有按 id 去重，队列侧到是有过一段没写在文档上的按 id 抑制（F7）。
 * 内核的幂等承诺只有一句：**at-least-once + 投递级结算**；内容级幂等是发送边界上的显式策略，
 * 目前没有实现。所以这里钉一份禁区清单，写错一次就红，而不是靠人记得。
 *
 * 词是用拼接写的，免得这个测试把自己匹配进去。
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['src', 'wiki', 'conformance', 'README.md', 'README.cn.md']
const SKIP_DIRS = ['paper'] // 论文笔记里这些词是作为“不许这样主张”的反面例子出现的

const BANNED: Array<[string, string]> = [
  ['内容' + '重复的信件', '内核不按 id 丢弃重复信件（那是发送边界上未实现的显式策略）'],
  ['物理' + '重复投递', '同上：这句话两头都不对，见 issues.md 的 F7'],
  ['确保相同内容' + '的信件不会被重复投递', '同上'],
  ['用于处理网络重传导致的' + '【请求级去重】', '内核只透传 req-id，不按它去重'],
  ['绝对不会被' + '重复处理', 'at-least-once：慢消费者租约到期会被重投，幂等归消费者'],
]

const walk = (path: string, out: string[] = []): string[] => {
  const st = statSync(path)
  if (st.isDirectory()) {
    if (SKIP_DIRS.some((skip) => relative('.', path).split(/[\\/]/).includes(skip))) {
      return out
    }
    for (const entry of readdirSync(path)) {
      walk(join(path, entry), out)
    }
  } else if (/\.(ts|md)$/.test(path)) {
    out.push(path)
  }
  return out
}

describe('文档里的假承诺清单', () => {
  const files = ROOTS.flatMap((root) => walk(root))

  it('扫描范围不是空的（改了目录结构就先把这里更新）', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  for (const [phrase, why] of BANNED) {
    it(`不许再出现「${phrase}」`, () => {
      const hits: string[] = []
      for (const file of files) {
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, i) => {
          if (line.includes(phrase)) {
            hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`)
          }
        })
      }
      expect(hits, `为什么这句话是假的：${why}`).toEqual([])
    })
  }
})
