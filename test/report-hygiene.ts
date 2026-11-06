/**
 * 被跟踪的报告不许写运行时刻（issue 05）。
 *
 * 运行时刻让「跑一次测试」与「改文档」在 `git status` 里长得一模一样：review 里分不清
 * 「结果变了」和「只是又跑了一遍」，久而久之大家开始 `git checkout --`，真实漂移正是这样被
 * 顺手丢掉的。报告的身份由**契约版本**承担——它变了这份矩阵才需要重看；运行时刻属于 stdout。
 *
 * 判据是「内容里有没有运行时刻」，不是「有没有 diff」：短路成「永不写文件」等于关掉差异矩阵。
 */

// 模式用拼接构造，免得这份文件被自家扫描器扫到时撞上（同 doc-claims 的做法）。
const STAMP_WORD = '生成' + '时间'
const ISO_STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const IDENTITY_PREFIX = '契约版本' + '：'

/** 报告里带了运行时刻的行（空数组 = 干净）。 */
export function runtimeStampLines(report: string): string[] {
  return report.split('\n').filter((line) => line.includes(STAMP_WORD) || ISO_STAMP.test(line))
}

/** 报告的身份行（`契约版本：…`）；没有则返回空串——这样“缺身份”读起来就是一次普通的断言未命中。 */
export function contractIdentityLine(report: string): string {
  return report.split('\n').find((line) => line.startsWith(IDENTITY_PREFIX)) ?? ''
}
