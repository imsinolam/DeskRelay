# 对外发布与 GitHub 初始化

当前私有开发仓库可能在旧提交中包含已经删除的截图、用户名、任务名、本机路径或服务器地址。**不要直接把现有 `.git` 历史推到公开 GitHub。**

公开发布应分为两步：先审计当前文件快照，再从该快照创建全新的 Git 历史。

## 1. 发布前验证

```bash
git diff --check
npm run privacy:check
npm run quality
npm audit --omit=dev
npm pack --dry-run --json
npm publish --dry-run --access public
npm run smoke:global -- --purge-global --clean-cache
```

确认：

- lint、类型检查、测试和构建通过；
- tarball 包名是 `deskrelay`，版本与发布说明一致；
- tarball 包含 `bin/`、`dist/`、README、License、文档和部署模板；
- tarball 不包含 `.env`、私钥、日志、运行状态、附件、源码测试、`node_modules` 或本机路径；
- `package.json` 不再发布旧命令别名或兼容镜像。
- `npm audit --omit=dev` 没有生产依赖漏洞；
- 所有 raster 图片都在安全扫描器中按路径和 SHA-256 明确审核，图片一旦被替换必须重新人工检查。

`privacy:check:history` 用于检查准备公开的 Git 历史。私有开发仓库如果曾提交敏感夹具，它失败是风险信号，不能通过忽略结果直接公开。

## 2. 导出无历史公开快照

在源仓库外选择一个不存在的目录：

```bash
npm run public:snapshot -- ../DeskRelay-public
cd ../DeskRelay-public
```

脚本不会复制 `.git`、本地环境文件、密钥、`~/.deskrelay`、日志、附件、缓存、`dist` 或 `node_modules`。

## 3. 创建干净历史

```bash
git init -b main
git config user.name imsinolam
git config user.email imsinolam@users.noreply.github.com
npm install
npm run quality
npm pack --dry-run --json
git add .
git commit -m "feat: publish DeskRelay 2.0"
npm run privacy:check:history
```

提交前检查 Git 作者邮箱；如果不希望公开私人邮箱，在公开仓库使用 GitHub noreply 邮箱。

不要把私有开发仓库的 remote、worktree、stash、reflog、Git hooks 或 `.git` 目录复制到公开快照。

## 4. 创建 GitHub 仓库

创建空仓库时不要自动添加 README、License 或 `.gitignore`，然后在公开快照目录中添加 remote 并推送。也可以先创建 private 仓库完成最终检查，再切换为 public；private 不等于脱敏，仍必须使用干净历史。

## 5. GitHub 上线检查

- 文件列表没有凭据、日志、附件、真实任务截图和运行目录；
- commit 作者邮箱符合预期；
- README 图片都经过隐私审查；
- CI 的 safety、lint、typecheck、test、build 全部通过；
- Security Advisories 和分支保护已启用；
- issue 模板明确禁止提交 setup 链接、任务 ID、日志和未脱敏截图；
- 仓库链接、npm metadata 和 README badge 全部指向 DeskRelay。

## 6. npm 发布

GitHub 发布和 npm 发布是两件事。没有用户明确授权时，不执行真实 `npm publish`。

维护者应先运行 `npm publish --dry-run --access public`，检查无误后只发布 `deskrelay`。发布后必须从 npm registry 查询真实版本，并重新全局安装执行最小 smoke；不能仅凭本地命令成功就宣称已经发布。

## 7. 后续同步

私有开发仓库与公开仓库并行时，不要复制私有 `.git`。可以使用经过审查的 patch、挑选后的提交或新的安全快照同步。每次公开推送前至少运行 `npm run privacy:check` 和 `git diff --check`；涉及 CLI、部署模板、依赖或发布包时再运行完整质量、打包和全局安装验证。
