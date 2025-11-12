# 🤝 Contributing

## 🧭 贡献流程

### 1. 选择贡献类型

| 类型 | 适合人群 | 入口 |
|------|----------|------|
| 🐞 Bug 修复 | 所有开发者 | [Good First Issues](https://github.com/isdk/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) |
| 📚 文档改进 | 新手友好 | [Documentation Issues](https://github.com/isdk/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Adocumentation) |
| 🧩 新 Provider | 有特定协议经验 | [Provider Request](https://github.com/isdk/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Aprovider) |
| 💡 新特性 | 深度用户 | [Feature Request](https://github.com/isdk/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement) |

### 2. 开发前必读

### 3. 提交 PR

1. Fork 仓库
2. 创建特性分支：`feat/your-feature`
3. 编写测试（Vitest）
4. 提交符合 [Conventional Commits](https://www.conventionalcommits.org/)
5. 提交 PR

## 📏 代码规范（所有包通用）

### 命名约定

## 🧪 测试要求

### 必须覆盖

| 场景 | 测试类型 | 示例 |
|------|----------|------|
| 订阅取消 | 单元测试 | 取消后不再接收消息 |

### Vitest 最佳实践


## 📝 提交规范

```
<type>(<scope>): <description>

[optional body]
```

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `test` | 测试相关 |
| `chore` | 构建/工具 |

**示例**：

```text
feat(mailbox): add xxx option to fetch

- Add `xxx?: boolean` to fetch options
- Default: xxx=false (semantics)
```

Please feel free to file GitHub Issues or propose Pull Requests. We're always happy to discuss improvements to this library!

## Testing

```shell
pnpm test
```

## Releasing

Releases are supposed to be done from master, version bumping is automated through [`standard-version`](https://github.com/absolute-version/commit-and-tag-version):

```shell
pnpm release -- --dry-run  # verify output manually
pnpm release               # follow the instructions from the output of this command
```
