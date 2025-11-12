# 🤝 Contribution Guide

We warmly welcome and appreciate all forms of contributions, whether it's reporting a bug, submitting a new feature, improving documentation, or making suggestions. This guide will help you get involved in the project smoothly.

## 🧭 Contribution Workflow

### 1. Preparation

Before you start, please ensure you have:

1. **Installed [pnpm](https://pnpm.io/installation)**: This project uses pnpm as its package manager.
2. **Forked this repository**: Click the "Fork" button in the upper right corner of the page.
3. **Cloned your fork**: `git clone https://github.com/YOUR_USERNAME/mailbox.js.git`
4. **Installed dependencies**: Run `pnpm install` in the project root directory.

### 2. Choose a Contribution Type

Based on your interests and experience, you can start with any of the following:

| Type | Suitable For | Entry Point |
| :--- | :--- | :--- |
| 🐞 **Bug Fixes** | All developers | [View Good First Issues](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) |
| 📚 **Documentation** | Beginner-friendly | [View Documentation Issues](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Adocumentation) |
| 🧩 **New Provider** | Experience with specific protocols | [Propose a Provider](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Aprovider) |
| 💡 **New Feature** | Power users | [Propose a New Feature](https://github.com/mboxlabs/mailbox.js/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement) |

### 3. Development and Submission

1. **Create a branch**: Create a descriptive branch from the `main` branch, such as `feat/add-new-provider` or `fix/login-bug`.

    ```shell
    git checkout -b feat/your-feature-name
    ```

2. **Implement your changes**: Make your code modifications. Please follow the coding standards below.
3. **Write tests**: Add or update unit tests for your changes. All core logic, edge cases, and error handling should be covered.
4. **Run checks**: Ensure all tests and style checks pass.

    ```shell
    pnpm test
    pnpm style
    ```

5. **Commit your code**: Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.
6. **Open a Pull Request**: Push your branch to GitHub and create a Pull Request to the `main` branch of the main repository. Please clearly describe the changes you have made in the PR description.

## 📏 Coding Standards

### Naming Conventions

- **Variables and Functions**: Use `camelCase`, e.g., `myVariable`.
- **Classes, Interfaces, and Types**: Use `PascalCase`, e.g., `MyClass`, `MailboxProvider`.
- **Constants**: Use `UPPER_CASE`, e.g., `DEFAULT_TIMEOUT`.
- **Private Properties/Methods**: Use an underscore prefix, e.g., `_privateMethod`.

### Code Style

The project uses Prettier and ESLint to enforce a consistent code style. Before committing, please run `pnpm style:fix` to automatically format your code.

## 🧪 Testing Requirements

We use [Vitest](https://vitest.dev/) for unit testing.

### Required Coverage

- **Core Functionality**: Ensure your modified or added core logic has corresponding tests.
- **Edge Cases**: For example, empty inputs, max/min values, etc.
- **Error Handling**: Simulate and test all expected error paths.
- **Asynchronous Operations**: Ensure Promises are resolved and rejected correctly.

### Vitest Best Practices

- Use `describe` to logically group your tests.
- The description of a test case (`it` or `test`'s first argument) should be clear and concise.
- Prefer `vi.fn()` or `vi.spyOn()` for mocking functions and objects.
- Use `beforeEach` and `afterEach` to clean up the test environment where appropriate.

## 📝 Commit Message Specification

We follow the Conventional Commits specification. The format is as follows:

```sh
<type>(<scope>): <description>

[optional body]
```

| Type | Description |
| :--- | :--- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `test` | Adding missing tests or correcting existing tests |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `style` | Changes that do not affect the meaning of the code (white-space, formatting, etc) |
| `chore` | Changes to the build process or auxiliary tools and libraries |

**Example**:

```text
feat(mailbox): add xxx option to fetch

- Add `xxx?: boolean` to fetch options
- Default: xxx=false (semantics)
```

## 📦 Release Process (for Maintainers)

The release process is automated by `standard-version`, which generates the `CHANGELOG.md` and tags the version based on Conventional Commits.

```shell
# Preview the upcoming version and changelog
pnpm release -- --dry-run

# Official release
pnpm release
```
