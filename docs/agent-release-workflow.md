# 多 Agent 协作与发版规范

DeskRelay 允许多个 Agent 同时开发，但正式版本必须只有一个明确的发布负责人。这个规范把“写代码”和“对外发布”分开，避免多个 Agent 同时改主分支、重复发版、漏掉提交或互相覆盖。

## 1. 角色

### 开发 Agent

负责一项边界清晰的开发任务，可以修改、测试并提交代码，但必须遵守：

- 使用独立分支和独立 worktree，不与其他 Agent 共用正在修改的目录；
- 开始前检查 `git status`、`git diff` 和已有 worktree，保留所有现有修改；
- 只提交自己负责的文件，不使用 `git add -A` 或其他可能顺带提交别人改动的命令；
- 完成后创建一个或多个范围清晰的本地 commit；
- 不推送任何远端，不合并到 `main`，不创建 tag，不修改正式版本号，不发布 npm 包，不部署正式环境；
- 不执行 GitHub 写操作，包括 `git push`、`gh` 写操作和 GitHub API 上传；
- 不因自己的任务完成而擅自编写“已经发布”或“已经上线”的结论。

开发 Agent 完成后必须交付：

```text
分支：<branch>
提交：<commit SHA>
改动：<用户可见变化>
文件：<主要修改文件>
验证：<实际运行并通过的命令>
遗留：<未验证、风险或无>
```

没有 commit SHA 的改动不进入待发布清单。测试未通过的提交必须明确标记，不能混入正常候选。

### 发布 Agent

发布 Agent 是某一次正式版本唯一的集成与发布负责人。只有用户明确指定“作为发布 Agent 发版”或同等明确指令后，当前 Agent 才能承担这个角色。

发布 Agent 可以：

- 收集和审查各开发 Agent 已提交的 commit；
- 在独立发布分支或发布 worktree 中合并、cherry-pick 和解决冲突；
- 为集成修复、版本号、版本说明和发布元数据创建 commit；
- 执行完整质量检查、安装验证和正式环境验活；
- 通过专用发布服务器完成 GitHub 提交、推送和远端 SHA 验真；
- 在用户明确授权时发布 npm 包和部署正式版本。

发布 Agent 不得把未提交的工作目录直接当作发布输入，也不得在发布服务器失败后改用本机直推 GitHub。

## 2. 并行开发规则

1. 每个 Agent 使用唯一分支，例如 `fix/mobile-failed-run-<shortid>`。
2. 每个 Agent 使用独立 worktree；不能切换或重置其他 Agent 正在使用的分支。
3. 开始修改前记录基线 commit；完成时报告自己的 commit SHA。
4. 禁止使用 `git reset --hard`、`git checkout -- <file>`、清空 stash 或删除未知 worktree 来处理他人的改动。
5. 提交时显式列出文件，例如 `git add src/... test/...`，避免把共享工作树中的其他改动带入。
6. 发现文件写入范围冲突时停止扩大修改，由发布 Agent决定拆分、重做或人工合并。
7. 开发 Agent 的提交可以有多个，但必须保持可审查；临时调试内容、密钥、日志、附件和运行状态不得提交。
8. 普通 Agent 不更新 `package.json` 版本、release note、tag 或正式部署配置，除非任务本身只是在设计这些机制，且不宣称已经发布。

## 3. 发布输入清单

发布 Agent 开始前必须同时检查：

```bash
git status --short
git diff --check
git worktree list --porcelain
git branch --all --verbose --no-abbrev
git log --oneline --decorate -30
```

随后建立候选提交表：

| 提交 | 来源分支 | 用户可见变化 | 验证结果 | 是否纳入 |
| --- | --- | --- | --- | --- |
| SHA | branch | 一句话说明 | 已通过/有风险 | 是/否 |

只按明确 SHA 集成，不使用“某个目录当前看起来最新”作为依据。两个分支修改相同逻辑时，发布 Agent 必须核对意图和测试，不能简单选择时间较新的文件覆盖另一个版本。

## 4. 正式发版流程

### 第一步：冻结范围

- 确定目标版本号和候选 commit；
- 确认没有遗漏已完成的 Agent 提交；
- 记录发布基线 SHA；
- 冻结后如果候选分支、HEAD、版本说明或关键配置变化，重新检查发布边界。

### 第二步：集成

- 在独立发布 worktree 中从确定的基线开始；
- 按候选表逐个合并或 cherry-pick；
- 冲突解决后重新运行相关测试；
- 创建必要的集成 commit，但不在开发 Agent 分支上重写历史。

### 第三步：准备版本

只有发布 Agent可以：

- 更新 `package.json`、锁文件和版本号；
- 新建 `docs/releases/<version>_CN.md`；
- 同步 `docs/releases/<version>.md` 英文说明；
- 更新 `docs/releases/README.md`；
- 创建正式 release commit 和 tag 候选。

版本说明必须来自实际 Git diff、候选提交和验证证据，不能只凭聊天记忆整理。

### 第四步：完整验收

至少运行：

```bash
git diff --check
npm run privacy:check
npm run lint
npm run typecheck:src
bun test test
npm run build
npm pack --dry-run --json
```

涉及全局安装、CLI、daemon 或正式网页时，还应运行对应的安装、重启、真实任务和公网验活。任何失败都必须保留原始结论，不能用局部测试替代完整验收。

### 第五步：发布服务器提交和推送

- 本机只生成经过隐私检查且不含 `.git` 的公开快照；
- 快照通过 SSH/SCP 交给专用发布服务器；
- GitHub fetch、公开 commit、push、tag 和 `git ls-remote` 验真全部在服务器隔离目录完成；
- 推送必须为 fast-forward，失败时停止，不强推，不回退为本机直推；
- 服务器操作不得影响其他项目；
- 具体命令和服务器安全要求见 [publishing.md](publishing.md)。

### 第六步：发布后验收

发布 Agent 必须核对：

- GitHub 远端 SHA 与服务器发布结果一致；
- npm registry 版本与 dist-tag 正确（仅在本次包含 npm 发布时）；
- 本机安装版本和 `/app-version` 正确；
- 正式网页、API、Relay 和设备在线链路正常；
- 发布记录中没有把未验证事项写成已完成。

## 5. 版本变更记录写法

中文版本说明是面向用户的主版本记录，必须使用清晰、非技术化语言。

### 应该写

- 用户现在能做什么；
- 哪个困扰被解决；
- 使用体验有什么变化；
- 是否需要重新登录、重启、重新发送或修改配置；
- 仍然存在的限制。

### 不应该写

- 类名、函数名、文件路径和内部字段；
- `payload`、`turnId`、LRU、TTL、POSIX、atomic write 等实现术语；
- 大段测试命令、提交 SHA 或内部架构过程；
- “优化若干”“修复问题”等无法判断实际变化的空话；
- 没有实测依据的“更稳定”“彻底解决”“全部支持”。

### 表达示例

不推荐：

```text
修复 task_complete 未检查 payload.error，新增 errorMessage 并调整 run summary。
```

推荐：

```text
任务没有生成回复时，网页现在会明确显示失败原因，不会再误显示为“已完成”。
```

不推荐：

```text
为通知缓存增加 pending、in-flight、delivered 状态和持久化去重键。
```

推荐：

```text
长任务完成后的微信通知如果暂时发送失败，会在连接恢复后继续补发，不容易再丢失。
```

技术实现、测试命令和 SHA 放在发布 Agent 的验收报告或 commit body 中，不放进面向用户的版本说明。

## 6. 版本说明固定结构

使用 [releases/TEMPLATE_CN.md](releases/TEMPLATE_CN.md)：

1. `这次更新`：最重要的 1–5 项用户变化；
2. `修复的问题`：之前会遇到、现在已经改善的问题；
3. `升级说明`：用户是否需要额外操作；
4. `已知限制`：仍未解决或只在特定条件下可用的事项。

没有内容的章节可以写“无需额外操作”或“本版本没有新增已知限制”，不要为了填满模板编造变化。
