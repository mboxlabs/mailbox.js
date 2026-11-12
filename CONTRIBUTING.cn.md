# 🤝 贡献指南

我们非常欢迎并感谢所有形式的贡献，无论是报告 Bug、提交新功能、改进文档还是提出建议。本指南将帮助您顺利地参与到项目中来。

## 🧭 贡献流程

### 1. 准备工作

在开始之前，请确保您已经：

1. **安装 [pnpm](https://pnpm.io/installation)**：本项目使用 pnpm 作为包管理器。
2. **Fork 本仓库**：点击页面右上角的 "Fork" 按钮。
3. **Clone 您的 Fork**：`git clone https://github.com/YOUR_USERNAME/mailbox.js.git`
4. **安装依赖**：在项目根目录运行 `pnpm install`。

### 2. 选择贡献类型

根据您的兴趣和经验，可以选择以下任一方式开始：

| 类型               | 适合人群       | 入口                                                                                                                          |
| :----------------- | :------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| 🐞 **Bug 修复**    | 所有开发者     | [查看 Good First Issues](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) |
| 📚 **文档改进**    | 新手友好       | [查看文档相关问题](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Adocumentation)                |
| 🧩 **新 Provider** | 有特定协议经验 | [提出 Provider 建议](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Aprovider)                   |
| 💡 **新特性**      | 深度用户       | [提出新功能建议](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement)                    |

### 3. 开发与提交

1. **创建分支**：从 `main` 分支创建一个描述性分支，如 `feat/add-new-provider` 或 `fix/login-bug`。

   ```shell
   git checkout -b feat/your-feature-name
   ```

2. **编码实现**：进行代码修改。请遵循下面的代码规范。
3. **编写测试**：为您的修改添加或更新单元测试。所有核心逻辑、边界情况和错误处理都应被覆盖。
4. **运行检查**：确保所有测试和代码风格检查通过。

   ```shell
   pnpm test
   pnpm style

   # Mailbox 家族共三个仓库：mailbox.js（本仓库）、mailbox.py 和 mailbox.rust。
   # 改动涉及三端共有的行为时，将另两个仓库并排 clone 到本仓库旁边（它们不在本仓库的版本控制里），
   # 并一并跑它们的测试：
   #   git clone git@github.com:mboxlabs/mailbox.py.git   python
   #   git clone git@github.com:mboxlabs/mailbox.rust.git rust
   (cd python && python3 -m pytest -q)
   (cd rust && cargo test)
   ```

   `pnpm test` 会先跑 `pnpm run typecheck`：`vitest` 只做转译、不做类型检查，下游还没跟上契约的
   改动本来会一路绿。这条接线由 `test/typecheck-runs-before-tests.test.ts` 钉住，别为了快几秒
   把它改回 `vitest run`。`tsconfig.release.json` **不是检查面**（`noEmit: false` 且没有 `outDir`，
   `tsc -p` 会把 JS 吐进 `src/`）；发布面由 `pnpm build` 过。

   反方向同理：本包的 `dist/index.d.ts` **就是**建在它上面的那些包的类型检查面（`@mboxlabs/input`，
   以及通过它的 `@mboxlabs/input-inquirer`；还有 `@isdk/tool-rpc`）。它们靠 `package.json` 的 `types`
   链到这里，所以 `src` 改过而 `dist` 没重出，它们就是在**本仓库已经不存在的契约**上做类型检查——
   全绿，但无效。重出走 `pnpm build`（它给 tsup 传 `--dts --dts-resolve`）；`build-fast` 不出 d.ts，
   不算重出这份界面。

5. **提交代码**：遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范进行提交。
6. **发起 Pull Request**：将您的分支推送到 GitHub，并创建一个 Pull Request 到主仓库的 `main` 分支。请在 PR 描述中清晰说明您所做的更改。

## 📏 代码规范

### 命名约定

- **变量和函数**：使用 `camelCase`，例如 `myVariable`。
- **类、接口和类型**：使用 `PascalCase`，例如 `MyClass`, `MailboxProvider`。
- **常量**：使用 `UPPER_CASE`，例如 `DEFAULT_TIMEOUT`。
- **私有属性/方法**：使用下划线前缀，例如 `_privateMethod`。

### 代码风格

项目使用 Prettier 和 ESLint 来统一代码风格。提交前请运行 `pnpm style:fix` 自动格式化代码。

## 🗺️ 家族仓与门槛

拆包后一共四个仓（都在同一个 pnpm workspace 里）：

| 仓 | 包名 | 它拥有什么 |
| --- | --- | --- |
| `mailbox`（本仓） | `@mboxlabs/mailbox` | 契约 + 内核 + `@mboxlabs/mailbox/testing`（L0 基座） |
| `mailbox-queue` | `@mboxlabs/mailbox-queue` | `MailMessageQueue`：队列、租约、停放 |
| `mailbox-memory` | `@mboxlabs/mailbox-memory` | `MemoryProvider`（`mem:`）：总线、死信、地址语法 |
| `wiki`（挂在本仓 `wiki/` 下，独立仓） | `@mboxlabs/mailbox-wiki`（不发布） | 论文、用例集、conformance 报告 |

方向前只能从上往下（核心 ← 队列 ← provider ← 下游），而且谁也不许依赖 `wiki`。这条不是风格：
核心依赖 provider 包会让 pnpm 直接 `ERR_PNPM_TASK_CYCLE`。拿脚本查，别靠眼睛：

```bash
pnpm run check:direction   # 核心、队列、memory 都有这个 script
```

**门槛在哪仓跑就在哪仓跑**，改完代码要跑到那个仓去：

- 核心：契约与内核测试 + L0 档案的用例门（`test/conformance-l0.test.ts`）。
- `mailbox-queue`：队列层测试 + 队列基座（`QueueTestProvider`）。
- `mailbox-memory`：`mem:` 档案的用例门（`test/conformance.test.ts`）与实验 E1。
- `wiki`：`pnpm run typecheck`（论文 runner 的类型门）与 `pnpm run conformance`（写报告）。

报告写在 `wiki/paper/conformance/report/`：跑 `memory` 档案出 `ts.md|json`，跑 `testing` 档案出
`ts-testing.md|json`。两张表量的是不同的东西，不合并。

## 🧪 测试要求

我们使用 [Vitest](https://vitest.dev/) 进行单元测试。

Mailbox 家族在三个仓库里发布三种实现：本包、[mailbox.py](https://github.com/mboxlabs/mailbox.py)（用 `pytest`）与 [mailbox.rust](https://github.com/mboxlabs/mailbox.rust)（用 `cargo test`）。本仓库旁的 `python/`、`rust/` 目录只是本地开发布局，不在本仓库的版本控制里。
投递语义——订阅与取回二选一、ack/nack 与 in-flight 超时、回队去重、opt-in 的订阅重试——只在
`README.md` 里定义一次、三端各自实现，因此改动它们必须在三端都补上对应测试。

### 必须覆盖的场景

- **核心功能**：确保您修改或添加的核心逻辑有对应的测试。
- **边界情况**：例如，空输入、最大/最小值等。
- **错误处理**：模拟并测试所有预期的错误路径。
- **异步操作**：确保正确处理 Promise 的 resolve 和 reject。

### Vitest 最佳实践

- 使用 `describe` 对测试进行逻辑分组。
- 测试用例的描述 (`it` 或 `test` 的第一个参数) 应清晰明了。
- 优先使用 `vi.fn()` 或 `vi.spyOn()` 来模拟函数和对象。
- 在适当的时候使用 `beforeEach` 和 `afterEach` 来清理测试环境。

## 📝 提交信息规范

我们遵循 Conventional Commits 规范，格式如下：

```sh
<type>(<scope>): <description>

[optional body]
```

| 类型       | 说明             |
| :--------- | :--------------- |
| `feat`     | 新功能           |
| `fix`      | Bug 修复         |
| `docs`     | 文档更新         |
| `test`     | 测试相关         |
| `refactor` | 代码重构         |
| `style`    | 代码格式调整     |
| `chore`    | 构建、工具等杂项 |

**示例**：

```text
feat(mailbox): add xxx option to fetch

- Add `xxx?: boolean` to fetch options
- Default: xxx=false (semantics)
```

## 📦 发布流程 (维护者)

发布流程由 `commit-and-tag-version`（经 `pnpm dlx` 调用）自动完成，它会根据 Conventional Commits 生成 `CHANGELOG.md` 并打上版本标签。它既不发布也不推送：`pnpm publish` 与 `git push --follow-tags` 仍是手工步骤。

工具钉到精确版本 `commit-and-tag-version@12.7.3`。写 `@12` 是浮动 major 区间：以后任何一个 12.x 补丁都能决定
CHANGELOG 长什么样，而本仓没有 lockfile 可拦。`///` 这个退化从 `13.0.0` 开始——它内置的 hosted-git-info 读不出
以 `.js` 结尾的仓库名，host/user/project 三段全空，链接塌成 `](///compare/v1.0.0...v2.0.0)`、commit 引用退化成裸 SHA。
同一份历史上实测：`12.5.2` 与 `12.7.3` 正常，`13.0.0`、`13.1.0`、`13.1.2` 不正常。想升这个钉，先实测一次链接。

```shell
# 预览版本和变更日志，不动仓库
pnpm dlx commit-and-tag-version@12.7.3 --dry-run

# 正式发布
pnpm release
```

`pnpm release -- --dry-run` **不是**只读预览：pnpm 只把参数追加到链上最后一条命令，所以 `clean`、重建 docs、
以及提交 docs 都会在“预览”之前真跑一遍。要预览就用上面那条。

发布用 `pnpm publish`，并且必须在 `@isdk/ai-tools` workspace 里跑，不是 `npm publish`。本包唯一的运行时依赖写的是
`"@isdk/hash": "workspace:^"`，只有 pnpm 会把它改写成真实版本区间（实测：`^0.1.1`）。在 workspace 外，`pnpm pack` 已经会
报 `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`；`npm publish` 则会把一个任何包管理器都解析不了的版本区间推到用户面前。
发版提交还没 push 时预计需要 `--no-git-checks`；如果它指向的兄弟包版本不在 registry 上，先发那个。
