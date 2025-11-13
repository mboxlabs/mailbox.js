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

| 类型 | 适合人群 | 入口 |
| :--- | :--- | :--- |
| 🐞 **Bug 修复** | 所有开发者 | [查看 Good First Issues](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) |
| 📚 **文档改进** | 新手友好 | [查看文档相关问题](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Adocumentation) |
| 🧩 **新 Provider** | 有特定协议经验 | [提出 Provider 建议](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Aprovider) |
| 💡 **新特性** | 深度用户 | [提出新功能建议](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement) |

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
    ```

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

## 🧪 测试要求

我们使用 [Vitest](https://vitest.dev/) 进行单元测试。

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

| 类型 | 说明 |
| :--- | :--- |
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `test` | 测试相关 |
| `refactor` | 代码重构 |
| `style` | 代码格式调整 |
| `chore` | 构建、工具等杂项 |

**示例**：

```text
feat(mailbox): add xxx option to fetch

- Add `xxx?: boolean` to fetch options
- Default: xxx=false (semantics)
```

## 📦 发布流程 (维护者)

发布流程由 `standard-version` 自动完成，它会根据 Conventional Commits 生成 `CHANGELOG.md` 并打上版本标签。

```shell
# 预览将要生成的版本和变更日志
pnpm release -- --dry-run

# 正式发布
pnpm release
```
