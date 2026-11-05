/**
 * 实验 E1 的入口（论文 P4）。
 *
 * 它不是"正确性测试"，而是**结论的回归防线**：如果哪天内核默认行为或能力门控实现变了，
 * 导致 E1 的方向性结论不再成立，这里必须红。
 * 报告写到 `conformance/report/e1-irreversible-retry.md`（可直接贴进论文）。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const EXPERIMENTS = join(here, '../wiki/paper/conformance/experiments');
const REPORT = join(here, '../wiki/paper/conformance/report/e1-irreversible-retry.md');

/** E1 的格子形状（只声明这里要读的字段，不 import paper 仓库的类型）。 */
interface CellResult {
  cell: string;
  persistence: 'transient' | 'permanent';
  policy: 'baseline' | 'gated';
  externalSideEffects: number;
  deliverySucceeded: boolean;
  attempts: number;
  escalationEvents: number;
  requeued: boolean;
  pollerSideEffects: number;
  pollerSucceeded: boolean;
}

// 同 `conformance.test.ts`：paper 树在独立 clone 里不存在 ⇒ 守卫 + 动态 import，
// 静态 import 会在解析阶段就红，`skipIf` 拦不住。
const paperPresent = existsSync(EXPERIMENTS);
const experimentSpec = new URL(
  '../wiki/paper/conformance/experiments/e1-irreversible-retry.ts',
  import.meta.url,
).href;

describe.skipIf(!paperPresent)('experiment E1 [不可逆传输上的重试门控]', () => {
  it('能力门控把外部副作用从"重试链 + 兜底放大"降到 1 次，代价是放弃自动恢复', async () => {
    const { runExperiment, renderReport } = (await import(experimentSpec)) as {
      runExperiment: () => Promise<CellResult[]>;
      renderReport: (cells: CellResult[]) => string;
    };
    const cells = await runExperiment();

    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, renderReport(cells));

    const at = (policy: string, persistence: string) =>
      cells.find((c) => c.policy === policy && c.persistence === persistence)!;

    // 1) 永久失败：基线放大，门控只一次副作用
    expect(at('baseline', 'permanent').externalSideEffects).toBeGreaterThanOrEqual(3);
    expect(at('gated', 'permanent').externalSideEffects).toBe(1);

    // 2) 基线的回队兜底会再产生一次外部副作用（放大链），门控不回队
    expect(at('baseline', 'permanent').pollerSideEffects).toBe(1);
    expect(at('gated', 'permanent').requeued).toBe(false);

    // 3) 门控把失败显式化
    expect(at('gated', 'permanent').escalationEvents).toBeGreaterThanOrEqual(1);

    // 4) 代价：可恢复场景下基线救回来了，门控没有 ⇒ R1 必须与升级配套
    expect(at('baseline', 'transient').deliverySucceeded).toBe(true);
    expect(at('gated', 'transient').deliverySucceeded).toBe(false);

    // （用 process.stdout.write：eslint 只允许 warn/error）
    process.stdout.write(`\n[E1] 报告：${REPORT}\n`);
    for (const c of cells) {
      process.stdout.write(
        `  ${c.cell.padEnd(18)} 副作用 ${c.externalSideEffects} / 尝试 ${c.attempts}`
        + ` / 成功 ${c.deliverySucceeded} / 升级 ${c.escalationEvents} / 回队 ${c.requeued}\n`,
      );
    }
  }, 60_000);
});
