import antfu from '@antfu/eslint-config'
import tsdoc from 'eslint-plugin-tsdoc'

/**
 * ESLint 负责 TS 代码的「正确性 + 风格」，prettier 只管 json/yaml/md（见 package.json 的 format 脚本）。
 *
 * 项目已经很久没跑 lint：用 @antfu 默认配置会报大量问题，其中绝大多数是纯风格问题
 * （style/semi、style/indent、perfectionist/sort-* …）。为了让 diff 可控，这里整体关闭
 * 风格类与教条类插件层，只保留指向真实 bug 的核心规则。
 * 想重新启用某一层，把对应的 `false` 改成 `true` 即可。
 */
const config = await antfu({
  gitignore: true,
  ignores: [
    'web/**',
    'docs/**',
    'dist/**',
    '.cache/**',
    // 各端口与 wiki 是**独立的 git 仓库**，只是放在同一个工作目录里；内核的 lint 不管它们的代码。
    'python/**',
    'rust/**',
    'wiki/**',
    // 本地探针 / 演示：不属于源码，也不入库。
    'scratch/**',
  ],

  // 风格类规则全部交给 prettier
  stylistic: false,
  // 以下插件层对历史代码噪音太大，先整体关闭
  regexp: false,
  unicorn: false,
  test: false,
  imports: false,
  jsonc: false,
  yaml: false,
  toml: false,
  markdown: false,
}, {
  plugins: { tsdoc },
  rules: {
    'tsdoc/syntax': 'off',
    'antfu/no-top-level-await': 'off', // 测试文件里 top-level await 是正常写法

    // 偏好类：不产生真实 bug，也不制造 diff
    'prefer-const': 'off',
    'prefer-template': 'off',
    'object-shorthand': 'off',
    'no-cond-assign': 'off', // 沿用旧配置：`while ((m = re.exec(s)))` 是惯用写法
    'no-lone-blocks': 'off', // `case 'x': { … }; break;` 的花括号是刻意的
    'unused-imports/no-unused-vars': 'off', // 未使用的函数参数多是签名占位

    // TS 风格类
    'ts/consistent-type-imports': 'off',
    'ts/consistent-type-definitions': 'off',
    'ts/no-use-before-define': 'off',
    'ts/ban-ts-comment': 'off',
    'ts/no-redeclare': 'off', // `const X` + `type X` 是有意的同名合并
    'ts/method-signature-style': 'off', // interfaces.ts 里用简写方法签名，改成函数属性会污染公开 API
    'ts/no-this-alias': 'off', // _createSubscriptionObject 里 `const provider = this` 是刻意的闭包捕获
  },
})

// ESLint 9 的 rules 通配符（如 `perfectionist/*`）只在 global config 生效，这里手动关掉整组噪音规则
const NOISE_GROUPS = ['perfectionist/', 'jsdoc/', 'node/', 'import/']
for (const item of config) {
  if (!item.rules) { continue }
  for (const name of Object.keys(item.rules)) {
    if (NOISE_GROUPS.some(group => name.startsWith(group))) {
      item.rules[name] = 'off'
    }
  }
}

export default config
