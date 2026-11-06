import markdownPlugin from 'prettier/plugins/markdown'
/**
 * Prettier 本地插件：Markdown **表格按原文输出**，不做列宽对齐。
 *
 * 为什么要：prettier 的 mdast printer 把每栏填充到该列最宽单元格的长度。
 * 长说明栏（README 能力表、plan-spec 的 DSL 表）单格就 300–400 字符，
 * 于是整张表每一行都被补成同样宽的长尾空格：`format:fix` 一次，
 * diff 全是纯空格，逐字推敲过的正文被冲散，且 md 文件在 git diff 里彻底没法读。
 *
 * 为什么只能这么办：prettier 没有「关掉表格格式化」的开关——3.8.3 / 3.9.6 / 3.9.10 的
 * `--support-info` 里与 wrap 有关的都只有 printWidth / proseWrap / objectWrap
 * （加一个 embeddedLanguageFormatting，管的是内嵌代码，不是表格）；markdown 侧也不认
 * `<!-- prettier-ignore-table -->`，只有整块的 `<!-- prettier-ignore -->`
 * （及 `-start` / `-end`），而那会把表格上下相邻的正文一起放过去，且每张表都要手写注释。
 *
 * 做法：mdast 的 `table` 节点带 `position.offset`，在 printer 层直接切
 * `options.originalText` 原样交回；其余节点全部交回原 printer，
 * 正文/列表/引用/行内标记/```yaml · ```json 内嵌代码照常格式化。
 *
 * ⚠️ 四点踩过的坑：
 * 1. 用户插件不能按 astFormat 覆盖内置 printer（试过：注册 `printers.mdast` 无效，
 *    内置优先），所以要另起 astFormat（`mdast-raw-table`）并包一层 parser。
 * 2. 能力面必须 `...base` 展开，不能逐个转发。写成 `key: (...a) => base.key?.(...a)`
 *    等于把 base **没有**的 key 也声明成「我有」：prettier 只要看见 `printPrettierIgnored`
 *    是函数就调它，拿到 `undefined` 当 doc → 碰到 `<!-- prettier-ignore -->` 直接
 *    `InvalidDocError: Unexpected doc 'undefined'`。而 3.8.3 的 mdast printer 没有这个 key、
 *    3.9.6 才有——同一份插件就是这样在两个版本之间坏的（mailbox 系四个包现在吃 3.9.10，
 *    plan-executor 吃 3.9.6：同一条插件得在两端都成立，所以能力面不能按某个版本手写）。
 *    展开之后能力面永远等于 base，版本升降级都不需要改这里。
 * 3. 切片的**首行**不能带前导空格：prettier 会先给出当前缩进，而切片带不带原文缩进
 *    看上下文（列表项里的段落有一行没缩进——markdown 的 lazy continuation——后面那张表的
 *    切片就开始带原文缩进）。不剔就是表头 6 空格、表体 3 空格：表格散架，且不幂等。
 *    后续行相反：字面换行不会被重新缩进，原文缩进必须留着。
 * 4. ```md / ```markdown 围栏里的表格不归本插件管：内嵌格式化是另起一轮、
 *    走内置 markdown printer。所以 md 围栏连围栏标记一起按原文输出（在 embed 阶段
 *    就返回 undefined，见下），markdown 示例本来就该作者手写、原样贴出。
 *
 * 用法：`.prettierrc` → `"plugins": ["./prettier-plugin-md-raw-table.mjs"]`
 * （config 里的相对路径按 config 所在目录解析，从子目录跑 prettier 也不会找不到）。
 */
const base = markdownPlugin.printers.mdast

/** ```md / ```markdown 围栏：内嵌那轮格式化绕开本插件，连围栏一起按原文输出 */
const RAW_CODE_LANGS = /^(?:md|markdown)$/i

/**
 * 节点整体（含围栏标记）的原文切片；拿不到偏移就退回默认打印，宁对齐也不要打印出错。
 *
 * ⚠️ 首行的前导空格必须剔掉：prettier 已经在前面给了当前缩进（列表项的内容缩进、
 * 引用块的 `> `），而切片本身**可能**带着原文缩进——同一个节点在不同上下文里位置偏移就
 * 不一致（例：列表项里的段落有一行没缩进，即 markdown 的 lazy continuation，后面那张表的
 * 切片就开始带上原文的 3 个空格）。不剔就是表头 6 空格、表体 3 空格——表格直接散掉，
 * 而且不幂等（第二遍还会再变）。后续行的换行是字面换行，prettier 不会重新缩进，
 * 所以它们的前导空格得留着。
 */
function rawSlice(node, options) {
  const start = node.position?.start
  const end = node.position?.end
  if (
    !start ||
    !end ||
    typeof start.offset !== 'number' ||
    typeof end.offset !== 'number'
  ) {
    return null
  }
  return options.originalText.slice(start.offset, end.offset).replace(/^ +/, '')
}

export const parsers = {
  // 复用官方 markdown parser，只换 astFormat，好让下面的 printer 接管
  markdown: {
    ...markdownPlugin.parsers.markdown,
    astFormat: 'mdast-raw-table',
  },
}

export const printers = {
  // 见上面坑 2：只覆盖 embed / print，其余能力原封不动跟着 base 走
  'mdast-raw-table': {
    ...base,
    // ⚠️ 必须在 embed 里就拦下 md 围栏：prettier 先调 embed，embed 有返回值就不再走 print，
    // 只在 print 里判 lang 是拦不住的。返回 undefined → 落回下面的 print → 原文输出。
    embed: (path, ...args) =>
      path.node?.type === 'code' && RAW_CODE_LANGS.test(path.node.lang ?? '')
        ? undefined
        : base.embed?.(path, ...args),
    print(path, options, print, args) {
      const node = path.node
      const raw =
        node?.type === 'table' ||
        (node?.type === 'code' && RAW_CODE_LANGS.test(node.lang ?? ''))
          ? rawSlice(node, options)
          : null
      if (raw !== null) return raw
      return base.print(path, options, print, args)
    },
  },
}
