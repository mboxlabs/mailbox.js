/**
 * 死信链（DLQ 的 DLQ）—— 「谁被放弃」与「放弃的东西去哪」
 *
 * 这里锁两条独立的契约，它们各自对应一个真实的故障形状：
 *
 *   A. [语义] **归档目标 = 消息实际所在的那条队列**，不是 `message.to`。
 *      归档副本的 `to` 必须保持业务地址（重放契约），所以「它现在躺在哪条队列里」与
 *      「它的 `to` 写着什么」在死信那一跳之后**就是两件事**。用 `to` 算目标就会：
 *        - 把 DLQ 里被放弃的记录又写回**同一条 DLQ**（毒记录永不出局，补偿 worker 空转）；
 *        - 让 `deadLetterTopic()` 报出一个永远不会被写入的队列（诊断页骗人）。
 *      队列层本来就是这个口径（`MailMessageQueue.nack` 用 `flight.topic`），provider 必须一致。
 *
 *   B. [语义] **链必须有上限**：`enableDeadLetterQueue({ maxNesting })`，默认 1 层。
 *      封顶之后不是「再造一层后缀」，而是**原地停放**（park）：记录留在它被放弃的那条
 *      就地**停放**（不再交付、不在 unreadCount 里、`['mem.parkedCount']` 数得出来），打
 *      `mbx-dead-letter-terminal: 'true'`，并大声记一条 CRITICAL。
 *      为什么不静默丢弃、也不无限拼后缀：地址空间必须有限（`_dlq` × N 会把 topic
 *      数量与地址长度变成无界增长），而「被放弃的消息凭空消失」违反本库的留痕原则。
 *      深度按 **topic 名字**算（后缀反复剥离），与 {@link MemoryProvider.deadLetterTopic}
 *      同一个函数：写进去的 key 和读路径报出的 key 不允许漂移。
 *
 * 附带锁定的事实：归档走 `enqueue` 而非 `publish` —— 死信不会自动投给死信 topic 上的
 * 订阅者，所以链**不会自我放大**，每一层都要有人主动消费 + 再放弃一次才会出现。
 *
 * 命名标记：[语义] 契约；[事实] 附带锁定的行为。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Mailbox } from '../mailbox';
import { MemoryProvider, DEFAULT_DEAD_LETTER_SUFFIX, DEFAULT_MAX_DEAD_LETTER_NESTING } from './memory';
import { InvalidDeadLetterNestingError } from '../error';
import { getCanonicalMailboxAddressIdentifier } from '../lib/scheme-address';

const fatal = (message = 'bad payload') => new Error(message);
const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let seq = 0;
const addrOf = (name: string): string => `mem://nest${seq++}-${name}@bus/inbox`;

let mailbox: Mailbox;
let provider: MemoryProvider;

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  provider = MemoryProvider.createIsolated();
  mailbox = new Mailbox();
  mailbox.registerProvider(provider);
  await mailbox.start();
});

afterEach(async () => {
  await mailbox.stop();
  vi.restoreAllMocks();
});

/** 把某条队列头部的记录「拉取 + 放弃」（补偿消费者处理失败后不再回队）。 */
const giveUpIn = async (topic: string) => {
  const taken = await mailbox.fetch(topic, { manualAck: true });
  if (!taken) {
    return null;
  }
  await taken.nack(false);
  return taken;
};

const unreadOf = async (topic: string): Promise<number> =>
  (await mailbox.status(topic)).unreadCount ?? 0;

const peekOf = async (topic: string) => mailbox.fetch(topic, { peek: true });

describe('[语义] 归档目标是「消息实际所在的队列」，不是 message.to', () => {
  it('[语义] 从 X_dlq 里被放弃的记录进 X_dlq_dlq，不会回到 X_dlq（毒记录必须出局）', async () => {
    provider.enableDeadLetterQueue({ maxNesting: 2 });
    const base = addrOf('source-key');

    await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 1 } }); // 无订阅者 → 入队
    const first = await giveUpIn(base);
    expect(first).not.toBeNull();

    const dlq1 = provider.deadLetterTopic(base)!;
    expect(dlq1).toBe(`${base}${DEFAULT_DEAD_LETTER_SUFFIX}`);
    expect(await unreadOf(dlq1)).toBe(1);

    const record = await giveUpIn(dlq1); // 补偿消费者崩了：对死信记录本身判放弃
    expect(record).not.toBeNull();

    const dlq2 = provider.deadLetterTopic(dlq1)!;
    expect(dlq2).toBe(`${dlq1}${DEFAULT_DEAD_LETTER_SUFFIX}`);

    // 关键：来源是 dlq1，所以目标必须是 dlq2；回到 dlq1 就是自环（同一条队列既进又出）
    expect(await unreadOf(dlq1)).toBe(0);
    expect(await unreadOf(dlq2)).toBe(1);
  });

  it('[语义] 归档写入的 key 与 deadLetterTopic(来源队列) 是同一个，而且是规范形式', async () => {
    provider.enableDeadLetterQueue({ maxNesting: 2 });
    const base = addrOf('nameable');
    await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 1 } });
    await giveUpIn(base);

    const dlq1 = provider.deadLetterTopic(base)!;
    await giveUpIn(dlq1);
    const dlq2 = provider.deadLetterTopic(dlq1)!;

    const written = (await peekOf(dlq2))[0];
    expect(written).toBeTruthy();
    expect(getCanonicalMailboxAddressIdentifier(new URL(dlq2))).toBe(dlq2);
    expect(await peekOf(dlq2)).toHaveLength(1);
    // 没有任何「取不出来的 key」残留在总线上
    expect(await provider.listAddresses()).toEqual(expect.arrayContaining([base, dlq1, dlq2]));
    expect((await provider.listAddresses()).length).toBe(3);
  });

  it('[语义] 归档副本的 to 仍是业务地址（重放契约），mbx-dead-letter-topic 是上一跳的队列', async () => {
    provider.enableDeadLetterQueue({ maxNesting: 2 });
    const base = addrOf('headers');
    await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 5 }, meta: { order: 7 } });
    await giveUpIn(base);

    const dlq1 = provider.deadLetterTopic(base)!;
    await giveUpIn(dlq1);

    const nested = (await peekOf(provider.deadLetterTopic(dlq1)!))[0];
    expect(nested.to.toString()).toBe(base); // 重放仍然回业务队列
    expect(nested.meta).toEqual({ order: 7 });
    expect(nested.headers?.['mbx-dead-letter']).toBe('true');
    expect(nested.headers?.['mbx-dead-letter-topic']).toBe(dlq1); // 上一跳，不是最初的 to
    expect(nested.headers?.['mbx-dead-letter-reason']).toBe('consumer-nack');
    // 链要能追溯：上一跳的归档头被继承下来
    expect(nested.headers?.['mbx-dead-letter-depth']).toBe('2');
  });

  it('[语义] nack(true) 回的是它真正待着的那条队列（X_dlq），不是 message.to', async () => {
    provider.enableDeadLetterQueue();
    const base = addrOf('requeue-in-dlq');
    await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 1 } });
    await giveUpIn(base);

    const dlq1 = provider.deadLetterTopic(base)!;
    const taken = await mailbox.fetch(dlq1, { manualAck: true });
    await taken!.nack(true);

    expect(await unreadOf(dlq1)).toBe(1);
    expect((await peekOf(dlq1))[0]!.to.toString()).toBe(base);
    // 回队不是放弃：不得新开一层死信 topic
    expect(await provider.listAddresses()).not.toContain(`${dlq1}${DEFAULT_DEAD_LETTER_SUFFIX}`);
  });

  it('[语义] 广播侧同一口径：post 到 X_dlq + 订阅者不可重试失败 → X_dlq_dlq', async () => {
    provider.enableDeadLetterQueue({ maxNesting: 2 });
    const base = addrOf('broadcast');
    const dlq1 = `${base}${DEFAULT_DEAD_LETTER_SUFFIX}`;

    await mailbox.subscribe(dlq1, () => {
      throw fatal('compensation script crashed');
    });
    await mailbox.post({ from: 'mem://s@bus/u', to: dlq1, body: { n: 1 } });
    await tick();

    expect(await unreadOf(dlq1)).toBe(0);
    expect(await unreadOf(provider.deadLetterTopic(dlq1)!)).toBe(1);
  });

  it('[事实] 归档不会自动投给死信 topic 上的订阅者：链不会自我放大', async () => {
    provider.enableDeadLetterQueue();
    const base = addrOf('no-auto-redelivery');
    const seen: string[] = [];
    await mailbox.subscribe(provider.deadLetterTopic(base)!, (message) => {
      seen.push(message.id);
    });
    await mailbox.subscribe(base, () => {
      throw fatal();
    });

    const sent = await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 1 } });
    await tick(120);

    expect(seen).toEqual([]); // 归档是 enqueue 追加队尾，不是 publish
    expect(await unreadOf(provider.deadLetterTopic(base)!)).toBe(1);
    expect(sent).toBeTruthy();
  });
});

describe('[语义] 死信链的上限：maxNesting（默认 1 层），封顶 = 原地停放', () => {
  it('[语义] 默认只有一层：不给 X_dlq 再造 X_dlq_dlq，记录原地停放并打 terminal', async () => {
    provider.enableDeadLetterQueue();
    expect(provider.maxDeadLetterNesting).toBe(DEFAULT_MAX_DEAD_LETTER_NESTING);
    expect(DEFAULT_MAX_DEAD_LETTER_NESTING).toBe(1);

    const base = addrOf('default-depth');
    await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 1 } });
    await giveUpIn(base);

    const dlq1 = provider.deadLetterTopic(base)!;
    const taken = await giveUpIn(dlq1); // 对死信记录本身判放弃
    expect(taken).not.toBeNull();

    const deeper = `${dlq1}${DEFAULT_DEAD_LETTER_SUFFIX}`;
    expect(await provider.listAddresses()).not.toContain(deeper); // 地址空间不增长
    // 停放 ≠ 重新入队：判死的那份不在未读里，也不会再被交出来（F8）
    expect(await unreadOf(dlq1)).toBe(0);
    expect(await peekOf(dlq1)).toEqual([]);
    expect((await mailbox.status(dlq1))['mem.parkedCount']).toBe(1); // 但也没静默丢失

    const [parked] = provider.peekParked(dlq1);
    expect(parked.headers?.['mbx-dead-letter-terminal']).toBe('true');
    // 深度 = 它现在所在的链层（与队列名里的后缀层数一致），而不是“被归档了几次”
    expect(parked.headers?.['mbx-dead-letter-depth']).toBe('1');
    expect(console.error).toHaveBeenCalled(); // 停放要大声
  });

  it('[语义] 封顶处的 deadLetterTopic() 报的是停放目的地，不是一个永远为空的队列', async () => {
    provider.enableDeadLetterQueue();
    const base = addrOf('truthful-topic');
    await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 1 } });
    await giveUpIn(base);

    const dlq1 = provider.deadLetterTopic(base)!;
    expect(provider.deadLetterTopic(dlq1)).toBe(dlq1); // 封顶：不再往下拼后缀

    await giveUpIn(dlq1);
    // 报告的就是停放目的地那条：判死后它不在未读里，但停放计数落在同一条队列上
    expect((await mailbox.status(provider.deadLetterTopic(dlq1)!))['mem.parkedCount']).toBe(1);
    expect(await unreadOf(provider.deadLetterTopic(dlq1)!)).toBe(0);
  });

  it('[语义] maxNesting: 3 → 链最长三层，第四跳停在最深处；topic 数量有界', async () => {
    provider.enableDeadLetterQueue({ maxNesting: 3 });
    const base = addrOf('bounded-chain');

    await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 1 } });

    // 一层一层地“消费死信 + 再放弃”：前三跳往下拼后缀，第四跳就地停放。
    let topic = base;
    for (let level = 1; level <= 4; level++) {
      const next = provider.deadLetterTopic(topic)!;
      expect(await giveUpIn(topic)).not.toBeNull();

      if (level === 4) {
        expect(next).toBe(topic); // 封顶：不再拼后缀
        expect(await unreadOf(topic)).toBe(0); // 停放不是重新入队
        expect((await mailbox.status(topic))['mem.parkedCount']).toBe(1); // 但也没丢
        const [deep] = provider.peekParked(topic);
        expect(deep.headers?.['mbx-dead-letter-terminal']).toBe('true');
        expect(deep.headers?.['mbx-dead-letter-depth']).toBe('3');
        break;
      }

      expect(next).toBe(`${base}${DEFAULT_DEAD_LETTER_SUFFIX.repeat(level)}`);
      expect(await unreadOf(next)).toBe(1);
      topic = next;
    }

    const addresses = await provider.listAddresses();
    expect(addresses).toContain(`${base}_dlq_dlq_dlq`);
    expect(addresses).not.toContain(`${base}_dlq_dlq_dlq_dlq`);
    expect(addresses.length).toBe(4);
    expect(console.error).toHaveBeenCalled();
  });

  it('[语义] 停放不进交付流：反复放弃也拿不到它，因此不会堆积；排走要显式 purgeParked', async () => {
    provider.enableDeadLetterQueue();
    const base = addrOf('parked-drain');
    await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 1 } });
    await giveUpIn(base);

    const dlq1 = provider.deadLetterTopic(base)!;
    expect(await giveUpIn(dlq1)).not.toBeNull(); // 归档那一份本来是未读，被放弃后就停放了
    for (let i = 0; i < 3; i++) {
      expect(await giveUpIn(dlq1)).toBeNull(); // 排空脚本再也取不到它——这就是 F8 修完的样子
    }
    expect(await unreadOf(dlq1)).toBe(0);
    expect((await mailbox.status(dlq1))['mem.parkedCount']).toBe(1); // 反复放弃也不会堆积
    expect(new Set(provider.peekParked(dlq1).map((m) => m.id)).size).toBe(1);

    expect(provider.purgeParked(dlq1)).toBe(1);
    expect((await mailbox.status(dlq1))['mem.parkedCount']).toBe(0);
    expect(provider.peekParked(dlq1)).toEqual([]);
  });

  it('[语义] maxNesting: Infinity 是显式出口：链可以继续长（运维自己承担）', async () => {
    provider.enableDeadLetterQueue({ maxNesting: Number.POSITIVE_INFINITY });
    const base = addrOf('unbounded-opt-in');
    let topic = base;
    for (let level = 0; level < 4; level++) {
      const next = provider.deadLetterTopic(topic)!;
      expect(next).not.toBe(topic);
      await mailbox.subscribe(next, () => {
        throw fatal();
      });
      await mailbox.post({ from: 'mem://s@bus/u', to: next, body: { level } });
      await tick();
      topic = next;
    }
    expect(topic).toBe(`${base}_dlq_dlq_dlq_dlq`);
  });

  it('[语义] 深度上限按 topic 名字算：后缀剥离后仍是规范地址才算嵌套', async () => {
    provider.enableDeadLetterQueue({ suffix: '/retry', maxNesting: 2 });
    const base = addrOf('suffix-depth');
    await mailbox.post({ from: 'mem://s@bus/u', to: base, body: { n: 1 } });
    await giveUpIn(base);

    const retry1 = provider.deadLetterTopic(base)!;
    expect(retry1).toBe(`${base}/retry`);
    await giveUpIn(retry1);
    const retry2 = provider.deadLetterTopic(retry1)!;
    expect(retry2).toBe(`${retry1}/retry`);
    expect(provider.deadLetterTopic(retry2)).toBe(retry2); // 2 层封顶
  });

  it('[事实] 链深按名字界定：自己叫 `<suffix>` 结尾的业务队列会被算作第 1 层（取舍）', async () => {
    provider.enableDeadLetterQueue();
    const business = `${addrOf('name-collision')}${DEFAULT_DEAD_LETTER_SUFFIX}`; // 业务自己起的名字

    await mailbox.post({ from: 'mem://s@bus/u', to: business, body: { n: 1 } });
    await giveUpIn(business);

    // 默认封顶 1 层：不会再开 `..._dlq_dlq`，而是**停放**在它自己那条队列里（带 terminal 标记）。
    // 归档目的地与 deadLetterTopic() 永远同一个 key；停放不进交付流，运维要排走用 purgeParked()。
    expect(await provider.listAddresses()).not.toContain(`${business}${DEFAULT_DEAD_LETTER_SUFFIX}`);
    expect(await unreadOf(business)).toBe(0);
    expect((await mailbox.status(business))['mem.parkedCount']).toBe(1);
    expect(provider.peekParked(business)[0].headers?.['mbx-dead-letter-terminal']).toBe('true');

    // 换一个不撞业务名的后缀：同一条队列就回到第 0 层，死信另开一层
    provider.disableDeadLetterQueue();
    provider.enableDeadLetterQueue({ suffix: '.dlq' });
    const other = `${addrOf('distinct-suffix')}${DEFAULT_DEAD_LETTER_SUFFIX}`;
    await mailbox.post({ from: 'mem://s@bus/u', to: other, body: { n: 1 } });
    await giveUpIn(other);
    expect(await unreadOf(`${other}.dlq`)).toBe(1);
  });

  it('[语义] maxNesting 非法就在 enableDeadLetterQueue 抛，且不改动已有配置', async () => {
    provider.enableDeadLetterQueue({ maxNesting: 2 });

    for (const bad of [0, -1, 1.5, Number.NaN, '2', null, true]) {
      expect(() => provider.enableDeadLetterQueue({ maxNesting: bad as unknown as number }))
        .toThrow(InvalidDeadLetterNestingError);
    }

    expect(provider.maxDeadLetterNesting).toBe(2); // 非法调用不能把好配置改坏
    expect(() => provider.enableDeadLetterQueue({ maxNesting: Number.POSITIVE_INFINITY })).not.toThrow();
    expect(provider.maxDeadLetterNesting).toBe(Number.POSITIVE_INFINITY);
  });

  it('[语义] 后缀非法的检查不能被新校验放宽：空后缀仍然先炸', async () => {
    expect(() => provider.enableDeadLetterQueue({ suffix: '', maxNesting: 5 })).toThrow();
    expect(provider.deadLetterEnabled).toBe(false);
  });
});
