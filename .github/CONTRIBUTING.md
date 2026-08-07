# Contributing to DeskRelay

感谢你愿意参与 DeskRelay 的改进。这个项目连接 WeChat iLink、本地 CLI agent、可见终端 companion 和本地运行状态，很多问题只有在真实系统中才能复现。提交 issue 或 pull request 时，请尽量提供可验证的现象、命令和日志片段。

## Before You Start

- 先阅读 [README.md](../README.md)，确认当前推荐的使用方式。
- Agent 前置安装见 [Agent 安装与配置](../docs/guides/agent-setup.md)。
- 运行配置见 [运行配置](../docs/guides/configuration.md)。
- 公网 Relay 部署见 [公网 Relay 部署](../docs/guides/remote-access.md)。
- 常见问题和已知限制见 [问题排查](../docs/guides/troubleshooting.md)。
- 源码运行、测试和打包说明见 [开发与测试](../docs/maintainers/development.md)。

## Fork and Pull Request Workflow

如果你没有 `imsinolam/DeskRelay` 的写权限，请从 fork 提交 PR。这里的 `origin` 指你的 fork，`upstream` 指官方仓库。

首次参与时：

```bash
git clone https://github.com/<your-github-name>/DeskRelay.git
cd DeskRelay
git remote add upstream https://github.com/imsinolam/DeskRelay.git
git fetch upstream
```

每次开始一项新改动时，从最新官方 `main` 新建分支：

```bash
git checkout main
git pull --ff-only upstream main
git push origin main
git checkout -b fix/opencode-session-start
```

分支名用 `<type>/<short-topic>`，让 reviewer 一眼能看出范围：

```text
feat/daemon-switching
fix/codex-approval-routing
docs/contributing-guide
test/opencode-session-start
```

完成修改后，先检查改动范围，再提交并推送到自己的 fork：

```bash
git status --short
git add <changed-files>
git commit
git push -u origin fix/opencode-session-start
```

然后在 GitHub 上创建 PR：

- `base repository`: `imsinolam/DeskRelay`
- `base branch`: `main`
- `head repository`: 你的 fork
- `compare branch`: 你的工作分支，例如 `fix/opencode-session-start`

如果 review 后继续修改，直接在同一个分支继续 commit 并 `git push`，原 PR 会自动更新。一个 PR 尽量只解决一个清晰问题。

## Reporting Issues

提交 bug issue 时，请尽量包含：

1. 使用的命令，例如 `deskrelay`、`deskrelay-codex-start`、`deskrelay-claude-start` 或 `deskrelay-opencode-start`。
2. 使用的 adapter：Codex、Claude Code、TClaude、Grok、CodeBuddy、reasonix、WorkBuddy、OpenCode 或 shell。
3. 操作系统、Node.js 版本、包版本和安装方式。
4. 期望行为与实际行为。
5. 最小复现步骤。
6. 相关日志片段，通常来自 `~/.deskrelay/bridge.log`。

请在贴日志前删除账号凭据、token、完整微信用户标识、私有文件内容和不希望公开的本地路径。不要上传 `~/.deskrelay/account.json`、`sync_buf.txt`、`context_tokens.json` 或其他登录状态文件。

## Development Setup

需要：

- Node.js `>= 24.0.0`
- Bun `>= 1.0.0`
- 至少一个受支持 Agent；公开开发环境通常使用 Codex、Claude Code 或 OpenCode

安装依赖：

```bash
bun install
```

常用源码命令：

```bash
npm run setup
npm run daemon -- --adapter codex
npm run bridge:codex
npm run bridge:claude
npm run bridge:opencode
npm run codex:start
npm run claude:start
npm run opencode:start
```

## Project Areas

- `src/wechat`: WeChat iLink 登录、轮询、发送、附件下载和传输日志。
- `src/bridge`: bridge 生命周期、状态、审批、用户输入、最终回复和共享格式化逻辑。
- `src/bridge/bridge-adapters.*.ts`: 各 Agent 与 shell 的 adapter 实现。
- `src/companion`: 可见本地 CLI companion、endpoint 文件和 daemon 委托。
- `src/daemon`: 长驻 daemon、多 adapter slot 切换和可见终端自动打开。
- `src/runtime`: bridge 托管 runtime host。
- `bin/*.mjs`: 发布包中的 CLI 入口文件，不是生成产物。
- `test`: 按 runtime area 组织的 Bun 测试。

## Coding Guidelines

- 使用 TypeScript ESM。
- 保持现有风格：2 空格缩进、分号、双引号。
- 源码和测试中的本地 import 保持显式 `.ts` 后缀。
- 优先复用已有 helper，不要为局部问题引入跨 adapter 的大范围条件分支。
- adapter 专属行为尽量放在对应 adapter 文件或紧邻模块中。
- `bin/*.mjs` 必须保持 LF 行尾，因为它们是 npm 安装后的可执行入口。
- 不要提交本地凭据、运行状态、`dist/`、`node_modules/`、日志或本地 artifact 目录。

## Commit Messages

Commit 第一行使用 Conventional Commit 格式：

```text
<type>[optional scope]: <short English summary>
```

常用 `type`：

- `feat:` 新功能或新能力。
- `fix:` 用户可见 bug 或行为错误修复。
- `docs:` 文档改动。
- `test:` 测试补充或测试修正。
- `refactor:` 不改变外部行为的结构调整。
- `build:` 构建、打包、发布脚本或依赖元数据。
- `chore:` 维护性改动。

摘要用英文，写清楚行为变化。不要使用 `update readme`、`fix bug`、`misc`、`修改一下` 这类无法判断范围的描述。

推荐摘要示例：

```text
fix: route Codex approvals through WeChat
fix: start daemon Claude and OpenCode slots fresh
docs: reorganize public docs and dependency references
test: cover OpenCode stale-session startup
```

普通小改动可以只有一行摘要。涉及运行行为、adapter、daemon、审批、附件、发布流程或较大文档调整时，请写 commit body，并采用项目现有 Git log 的双语格式：

```text
fix: route Codex approvals through WeChat

Implement real Codex approval and user-input routing for WeChat-owned turns. The bridge now auto-approves low-risk requests, forwards high-risk requests to WeChat, and keeps pending user input separate from normal turn output. Regression tests cover approval routing, user-input waiting, and fallback behavior.

实现 Codex 在微信回合中的真实审批和用户补充输入链路。bridge 现在会自动通过低风险请求，将高风险请求转发到微信，并把等待用户输入的状态与普通回复输出分开处理。回归测试覆盖审批路由、用户输入等待和 fallback 行为。
```

双语 body 的写法是：英文段落先说明用户可见变化、关键实现和验证结果；中文段落再说明同一件事，方便中文维护和后续 release note 整理。不要把未运行的测试、未验证的发布状态或猜测性结论写进 commit。

## Tests and Verification

小改动可以先跑最相关的测试，再根据风险扩大范围：

```bash
bun test test/bridge
bun test test/companion
bun test test/daemon
bun test test/wechat
```

通用质量检查：

```bash
npm run lint
npm run typecheck:src
bun test test
npm run build
```

完整质量门禁：

```bash
npm run quality
```

涉及发布包、CLI wrapper、`package.json`、`bin/` 或 npm 安装行为时，还应运行：

```bash
npm pack --dry-run --json
npm run smoke:global -- --purge-global --clean-cache
```

## Pull Requests

PR 描述建议包含：

- 问题背景和用户可见行为变化。
- 影响的 adapter 或 runtime 区域。
- 兼容性、迁移或数据目录影响。
- 已运行的测试命令。
- 如果修改了 WeChat 消息、审批、附件或 daemon 切换流程，请附上关键日志或终端片段。

请保持 PR 聚焦。一个 PR 优先解决一个清晰问题，避免把无关重构、文档整理和行为修复混在一起。

## Public Safety Check

提交前运行：

```bash
npm run privacy:check
```

它会检查待提交文件中的私钥格式、常见服务令牌、非示例用户目录、真实公网 IPv4、运行状态文件和未经审查的文档截图。准备新的公开仓库时还应运行：

```bash
npm run privacy:check:history
```

如果历史检查失败，不要直接推送旧历史；优先从已审计的当前快照创建新的公开历史。issue 和 PR 中也不得包含真实任务名、项目路径、聊天截图、服务器地址、setup 链接或 `~/.deskrelay` 内容。

## Runtime State and Privacy

默认运行数据目录是：

```text
~/.deskrelay
```

这个目录包含登录凭据、WeChat 同步状态、上下文 token、bridge 日志、workspace 状态和附件缓存。贡献代码或提交 issue 时，请不要提交这些文件，也不要公开其中的敏感内容。

## Release Notes and Publishing

发布由维护者处理。PR 可以修改源码、测试和文档，但不要在 PR 中执行 `npm publish`。项目只发布一个 npm 包：`deskrelay`。

如需更新发布说明，请在 `docs/releases/` 下更新当前版本说明，并确保内容来自真实 diff 和实际验证结果。破坏性命名变更必须在主版本号、README 和迁移文档中明确说明。
