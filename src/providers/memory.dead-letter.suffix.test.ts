/**
 * 死信后缀 × 地址规范化 —— 「写进去的死信必须能被某个地址取回来」
 *
 * `MemoryEventBus` 的 topic key 是裸字符串，而**所有读路径**（`fetch` / `peek` / `status` /
 * `snapshot`）都会先对地址做规范化（`getCanonicalMailboxAddressIdentifier`）。于是死信 topic
 * 的 key 必须是**规范形式**，否则写入用的 key 和读路径算出的 key 不是同一个：记录进了总线，
 * 但没有任何地址能命名它（死信队列的存在理由就是「别取不出来」）。
 *
 * 本文件锁三层：
 *   1. [语义] 死信必须**可达**：`deadLetterTopic()` 拿到的 key 能 `peek` / `fetch` / `status`，
 *      且它是规范形式（自己规范化自己不变）；
 *   2. [语义] 总线里出现的**每个** topic key 都必须是规范形式（这条与「怎么拼 key」无关，
 *      是兜底的不变量：任何写路径都不能留下无法命名的队列）；
 *   3. [语义] 后缀必须**已经是**规范形式：会被 URL 规范化改写的后缀（非 ASCII、`" < > \` { }`、
 *      NUL / C1 控制符、`.` / `..` 路径段）在 `enableDeadLetterQueue()` 就拒绝——
 *      理由和「空后缀被禁」同源：静默改写等于把死信写进别的（可能是活的）队列。
 *
 * 附带锁定的事实：后缀不能改写 authority（空 path 的地址 `mem://bus` 尤其明显），
 * 非 ASCII 的**地址**本身 + 默认后缀必须仍然可达。
 *
 * 命名标记：[语义] 契约；[事实] 附带锁定的行为。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Mailbox } from '../mailbox';
import { MemoryProvider, DEFAULT_DEAD_LETTER_SUFFIX } from './memory';
import { InvalidDeadLetterSuffixError } from '../error';
import { getCanonicalMailboxAddressIdentifier } from '../lib/utils';

const fatal = (message = 'bad payload') => new Error(message);
const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let seq = 0;
const addrOf = (name: string): string => `mem://sfx${seq++}-${name}@bus/inbox`;

/** 一个 key 是不是规范形式（规范化自己不变）。 */
const isCanonical = (key: string): boolean => {
  try {
    return getCanonicalMailboxAddressIdentifier(new URL(key)) === key;
  } catch {
    return false;
  }
};

/**
 * 规范安全的后缀：拼接后地址不变形，因此写进去的 key 就是读路径能算出的 key。
 * 这些必须**接受**，且死信必须可达。
 */
const SAFE_SUFFIXES = [
  DEFAULT_DEAD_LETTER_SUFFIX,
  '.dlq',
  '-dlq',
  '/retry',
  '/retry/v2',
  '_%20x', // 已经是 percent-encoding 的形式
  '_%zz', // 非法转义序列：URL 解析器原样保留
  '_^',
  '_|',
  '_\\',
  '_:dead',
  '_%E6%AD%BB%E4%BF%A1', // 「死信」的规范形式
];

/**
 * 会被 URL 规范化**改写**的后缀：必须拒绝。
 * 每一条都实测过：`canonical(<地址><后缀>) !== <地址><后缀>`。
 */
const LOSSY_SUFFIXES: { label: string; suffix: string }[] = [
  { label: '中文（会被 percent-encode）', suffix: '_死信' },
  { label: 'CJK 单字', suffix: '_镜像' },
  { label: '拉丁扩展', suffix: '_café' },
  { label: `双引号`, suffix: '_"' },
  { label: `尖括号`, suffix: '_<' },
  { label: '反引号', suffix: '_`' },
  { label: '花括号', suffix: '_{' },
  { label: 'C1 控制符', suffix: '_\u0085' },
  { label: 'NUL（会被直接丢掉 ⇒ 死信写回原队列）', suffix: '_\u0000' },
  { label: '`.` 路径段（塌成 <topic>/ ⇒ 可能是别人的活队列）', suffix: '/.' },
  { label: '`..` 路径段（爬到别的地址底下去）', suffix: '/..' },
  { label: '路径里的 `..`', suffix: '/x/../y' },
  { label: 'percent-encode 的 `..`', suffix: '/%2e%2e/' },
];

describe('[语义] 开启死信后，被放弃的消息必须「可达」', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const suffix of SAFE_SUFFIXES) {
    it(`后缀 ${JSON.stringify(suffix)}：deadLetterTopic() 必须能 peek / fetch / status`, async () => {
      const provider = MemoryProvider.createIsolated();
      const mailbox = new Mailbox();
      mailbox.registerProvider(provider);
      provider.enableDeadLetterQueue({ suffix });

      const address = addrOf('reachable');
      await mailbox.subscribe(address, () => {
        throw fatal();
      });
      await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
      await tick();

      const topic = provider.deadLetterTopic(address)!;

      // deadLetterTopic() 返回的就是「能用的地址」：它自己必须是规范形式
      expect(isCanonical(topic), `deadLetterTopic() 返回了非规范 key: ${topic}`).toBe(true);

      // 读路径（peek / status / fetch）全部按地址规范化：必须命中写入的那个 key
      expect((await mailbox.fetch(topic, { peek: true }))).toHaveLength(1);
      const status = await mailbox.status(topic);
      expect(status.exists).toBe(true);
      expect(status.unreadCount).toBe(1);
      expect((await mailbox.fetch(topic))?.body).toEqual({ n: 1 });

      await mailbox.clear();
    });
  }

  it('[语义] 归档只写一个 key：listAddresses() 里没有「取不出来的那份」残留', async () => {
    const provider = MemoryProvider.createIsolated();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    provider.enableDeadLetterQueue();

    const address = addrOf('single-key');
    await mailbox.subscribe(address, () => {
      throw fatal();
    });
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    const topic = provider.deadLetterTopic(address)!;
    expect(await provider.listAddresses()).toEqual([address, topic].sort());
  });

  it('[语义] 总线里出现的每个 topic key 都必须是规范形式（兜底不变量）', async () => {
    const provider = MemoryProvider.createIsolated();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    provider.enableDeadLetterQueue();

    const plain = addrOf('invariant-plain');
    const unicode = 'mem://sfx-unicode@bus/镜像'; // 地址本身就是非 ASCII ⇒ canonical 里是 percent-encoding
    await mailbox.subscribe(plain, () => {
      throw fatal();
    });
    await mailbox.subscribe(unicode, () => {
      throw fatal();
    });

    await mailbox.post({ from: 'mem://s@bus/u', to: plain, body: { n: 1 } });
    await mailbox.post({ from: 'mem://s@bus/u', to: unicode, body: { n: 2 } });
    await tick();

    // 拉取侧的放弃（nack(false)）也走归档，一并覆盖
    await mailbox.post({ from: 'mem://s@bus/u', to: 'mem://sfx-pull@bus/inbox', body: { n: 3 } });
    const pulled = await mailbox.fetch('mem://sfx-pull@bus/inbox', { manualAck: true });
    await pulled!.nack(false);

    const keys = await provider.listAddresses();
    const orphaned = keys.filter((key) => !isCanonical(key));
    expect(orphaned, `总线里有无法被地址命名的 topic: ${JSON.stringify(orphaned)}`).toEqual([]);
  });

  it('[语义] 死信在 snapshot 里不能自相矛盾：列出的地址必须 exists，未读要计入总数', async () => {
    const provider = MemoryProvider.createIsolated();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    provider.enableDeadLetterQueue();

    const address = addrOf('snapshot-consistency');
    await mailbox.subscribe(address, () => {
      throw fatal();
    });
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    await tick();

    const snapshot = await mailbox.snapshot();
    const dlq = snapshot.addresses.find((entry) => entry.address === provider.deadLetterTopic(address));
    expect(dlq, 'snapshot 里找不到死信地址').toBeDefined();
    expect(dlq!.exists).toBe(true);
    expect(dlq!.state).toBe('online');
    expect(dlq!.unreadCount).toBe(1);
    expect(snapshot.unreadCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.state).toBe('online');
  });

  it('[事实] 非 ASCII 的**地址**本身 + 默认后缀：仍然可达（修法不能把它弄坏）', async () => {
    const provider = MemoryProvider.createIsolated();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    provider.enableDeadLetterQueue();

    const address = 'mem://sfx-nonascii-addr@bus/镜像';
    await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
    const taken = await mailbox.fetch(address, { manualAck: true });
    await taken!.nack(false);

    const topic = provider.deadLetterTopic(address)!;
    expect(topic).toBe('mem://sfx-nonascii-addr@bus/%E9%95%9C%E5%83%8F_dlq');
    expect((await mailbox.fetch(topic, { peek: true }))).toHaveLength(1);
    expect((await mailbox.status(topic)).unreadCount).toBe(1);
  });

  it('[事实] 后缀接在 path 末尾，不能改写 authority / port / 多段 path', async () => {
    const provider = MemoryProvider.createIsolated();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    provider.enableDeadLetterQueue();

    const cases: [string, string][] = [
      // 空 path：直接尾部拼接会把后缀落进 host（`mem://...@bus_dlq`）
      ['mem://sfx-nohostpath@bus', 'mem://sfx-nohostpath@bus/_dlq'],
      ['mem://sfx-slashpath@bus/', 'mem://sfx-slashpath@bus/_dlq'],
      // port 与多段 path 必须原样保留，后缀只接在最后一段后面
      ['mem://sfx-port@bus:8080/deep/inbox', 'mem://sfx-port@bus:8080/deep/inbox_dlq'],
      ['mem://sfx-enc@bus/%E9%95%9C%E5%83%8F', 'mem://sfx-enc@bus/%E9%95%9C%E5%83%8F_dlq'],
    ];

    for (const [address, expectedTopic] of cases) {
      await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
      const taken = await mailbox.fetch(address, { manualAck: true });
      await taken!.nack(false);

      const topic = provider.deadLetterTopic(address)!;
      expect(topic, `死信 topic 不该变形: ${address}`).toBe(expectedTopic);
      expect(new URL(topic).host, `死信挂到了别的 host: ${topic}`).toBe(new URL(address).host);
      expect(isCanonical(topic), `deadLetterTopic() 返回了非规范 key: ${topic}`).toBe(true);
      expect((await mailbox.fetch(topic, { peek: true })), `${topic} 取不回来`).toHaveLength(1);
      expect((await mailbox.status(topic)).unreadCount).toBe(1);

      await mailbox.clear();
    }
  });

  it('[事实] `mem://bus` 与 `mem://bus/` 共用同一条死信队列（已记录的取舍）', async () => {
    // 这两个地址在 canonicalization 下本就是两个 topic；它们的死信则共用 `mem://bus/_dlq`。
    // 取舍可接受：归档记录带着 `mbx-dead-letter-topic`，来源不会混。本例把这个取舍写死，
    // 以免后人把它当成“意外的串队”。
    const provider = MemoryProvider.createIsolated();
    const mailbox = new Mailbox();
    mailbox.registerProvider(provider);
    provider.enableDeadLetterQueue();

    for (const address of ['mem://sfx-merge@bus', 'mem://sfx-merge@bus/']) {
      await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
      const taken = await mailbox.fetch(address, { manualAck: true });
      await taken!.nack(false);
    }

    const topic = provider.deadLetterTopic('mem://sfx-merge@bus')!;
    expect(topic).toBe('mem://sfx-merge@bus/_dlq');
    expect(provider.deadLetterTopic('mem://sfx-merge@bus/')).toBe(topic);

    const entries = await mailbox.fetch(topic, { peek: true });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.headers?.['mbx-dead-letter-topic']).sort())
      .toEqual(['mem://sfx-merge@bus', 'mem://sfx-merge@bus/']);
  });
});

describe('[语义] 会被地址规范化改写的后缀必须在 enable 处拒绝', () => {
  let provider: MemoryProvider;
  let mailbox: Mailbox;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    provider = MemoryProvider.createIsolated();
    mailbox = new Mailbox();
    mailbox.registerProvider(provider);
  });

  afterEach(async () => {
    await mailbox.clear();
    vi.restoreAllMocks();
  });

  for (const { label, suffix } of LOSSY_SUFFIXES) {
    it(`${label}：后缀 ${JSON.stringify(suffix)} 被拒绝，且不留下任何痕迹`, async () => {
      expect(() => provider.enableDeadLetterQueue({ suffix })).toThrowError(InvalidDeadLetterSuffixError);
      expect(provider.deadLetterEnabled).toBe(false);
      expect(provider.deadLetterTopic('mem://s@bus/inbox')).toBeNull();

      // 拒绝必须是「什么都没配」而不是「配了但取不出来」
      const address = addrOf(`rejected-${suffix.codePointAt(suffix.length - 1)}`);
      await mailbox.subscribe(address, () => {
        throw fatal();
      });
      await mailbox.post({ from: 'mem://s@bus/u', to: address, body: { n: 1 } });
      await tick();

      const keys = await provider.listAddresses();
      expect(keys.filter((key) => !isCanonical(key))).toEqual([]);
      expect(keys).toEqual([address]);
      expect((await mailbox.status(address)).unreadCount).toBe(0);
    });
  }

  it('[语义] 错误信息给出「会被改写」以及规范拼法，用户能直接照抄', async () => {
    const error = ((): InvalidDeadLetterSuffixError | null => {
      try {
        provider.enableDeadLetterQueue({ suffix: '_死信' });
        return null;
      } catch (e) {
        return e as InvalidDeadLetterSuffixError;
      }
    })();

    expect(error).toBeInstanceOf(InvalidDeadLetterSuffixError);
    expect(error!.code).toBe('MBX_INVALID_DEAD_LETTER_SUFFIX');
    expect(error!.suffix).toBe('_死信');
    // 给出规范拼法：percent-encode 后的形式
    expect(error!.message).toContain('_%E6%AD%BB%E4%BF%A1');
    expect(error!.message.toLowerCase()).toMatch(/canonical|normaliz/);
  });

  it('[事实] 已有的拒绝条件不能被新校验放宽：空串 / query / hash / 空白', async () => {
    for (const suffix of ['', '?thread=1', '#frag', '_a b', '_a\tb', ' ']) {
      expect(() => provider.enableDeadLetterQueue({ suffix }), `suffix ${JSON.stringify(suffix)}`)
        .toThrowError(InvalidDeadLetterSuffixError);
    }
    expect(provider.deadLetterEnabled).toBe(false);
  });

  it('[语义] 重复开启：非法后缀不能让已开启的 provider 被改成坏配置', async () => {
    provider.enableDeadLetterQueue({ suffix: '_dlq' });
    expect(() => provider.enableDeadLetterQueue({ suffix: '_死信' })).toThrowError(InvalidDeadLetterSuffixError);
    expect(provider.deadLetterEnabled).toBe(true);
    expect(provider.deadLetterTopic('mem://s@bus/inbox')).toBe('mem://s@bus/inbox_dlq');
  });
});
