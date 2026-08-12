# 对外发布与 GitHub 提交

当前私有开发仓库可能在旧提交中包含已经删除的截图、用户名、任务名、本机路径或服务器地址。**不要直接把现有 `.git` 历史推到公开 GitHub。**

DeskRelay 的公开仓库采用两条固定边界：

1. 本机只负责检查源码和生成无 `.git` 的隐私快照；
2. GitHub 的 fetch、commit、push 和远端验真全部在专用发布服务器完成。

维护者的 Mac **不得直接向 GitHub 执行 `git push`、`gh repo sync`、GitHub API 上传或其他 Git 写操作**。这不是为了规避安全监测，而是为了让发布凭据、公开历史和审计边界集中在隔离服务器上。

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
- `package.json` 不再发布旧命令别名或兼容镜像；
- `npm audit --omit=dev` 没有生产依赖漏洞；
- 所有 raster 图片都在安全扫描器中按路径和 SHA-256 明确审核，图片一旦被替换必须重新人工检查。

`privacy:check:history` 用于检查准备公开的 Git 历史。私有开发仓库如果曾提交敏感夹具，它失败是风险信号，不能通过忽略结果直接公开。

## 2. 本机导出无历史公开快照

在源仓库外选择一个不存在或为空的目录：

```bash
npm run public:snapshot -- ../DeskRelay-public
cd ../DeskRelay-public
npm install
npm run quality
npm pack --dry-run --json
```

快照脚本不会复制 `.git`、本地环境文件、密钥、`~/.deskrelay`、日志、附件、缓存、`dist` 或 `node_modules`。从 macOS 打包给 Linux 时必须设置 `COPYFILE_DISABLE=1` 并使用 `tar --no-xattrs`，再检查压缩包中不存在 `._*` AppleDouble 文件或本机扩展属性。

本机快照目录不要执行 `git init` 或添加 GitHub remote。它只是即将提交的公开文件集合，不是发布仓库。

## 3. 首次配置专用发布服务器

推荐为每个公开仓库使用独立 Unix 目录和独立 GitHub deploy key，避免影响服务器上的其他项目。例如：

```text
~/deskrelay-github-relay/
  incoming/       # 临时接收本机快照，0700
  repo.git/       # 服务器侧 bare Git 仓库
  work/           # 每次发布的临时工作树
  push.log        # 发布审计日志，0600
~/.ssh/deskrelay_github_ed25519
~/.ssh/deskrelay_github_config
```

服务器 SSH 配置应限定到 GitHub 仓库使用的专用私钥：

```sshconfig
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/deskrelay_github_ed25519
  IdentitiesOnly yes
  UserKnownHostsFile ~/.ssh/deskrelay_github_known_hosts
  StrictHostKeyChecking yes
```

将对应公钥作为 GitHub 仓库的可写 Deploy key。私钥只保存在服务器，权限为 `0600`；不要复制回开发电脑，不要写入仓库、脚本参数、日志或聊天记录。

## 4. 标准发布命令

仓库提供 `scripts/publish-github-via-server.mjs`。它会：

1. 在本机执行隐私检查；
2. 导出无 `.git` 的公开快照；
3. 生成禁用 macOS 扩展属性的归档；
4. 只通过 SSH/SCP 把归档上传到指定服务器；
5. 调用服务器专用 helper，从 GitHub `main` 建立临时工作树；
6. 用快照替换公开工作树文件，排除 `.git`；
7. 在服务器再次运行隐私检查、检查 `._*` 和敏感文件；
8. **在服务器执行 `git add`、`git commit`、`git push`**；
9. 在服务器用 `git ls-remote` 验证 GitHub 的真实 SHA；
10. 清理本次临时归档与工作树，不触碰其他项目。

示例：

```bash
node scripts/publish-github-via-server.mjs \
  --server user@publish.example.com \
  --identity ~/.ssh/deskrelay_publish_ed25519 \
  --remote-helper ~/bin/deskrelay-github-publish-remote \
  --message "fix: preserve mobile conversation chronology"
```

机器地址、SSH 用户、私钥路径和 helper 路径属于部署配置，不得硬编码进仓库。也可以通过环境变量传入：

```bash
export DESKRELAY_GITHUB_PUBLISH_SERVER='user@publish.example.com'
export DESKRELAY_GITHUB_PUBLISH_IDENTITY="$HOME/.ssh/deskrelay_publish_ed25519"
export DESKRELAY_GITHUB_REMOTE_HELPER='~/bin/deskrelay-github-publish-remote'
node scripts/publish-github-via-server.mjs --message "fix: preserve mobile conversation chronology"
```

默认只允许发布 `main`。服务器 helper 必须先重新 fetch GitHub `main`，以该提交建立本次临时工作树，再创建新提交；推送必须保持 fast-forward，不能强推，也不能回退远端。若 GitHub 在 fetch 与 push 之间又出现新提交，普通 push 会失败，本次发布应停止并重新执行。

可公开复用的服务器 helper 模板位于 `deploy/github-publish-server/deskrelay-github-publish-remote`。安装到服务器后应设为 `0700`，并通过环境变量配置仓库 URL、作者和隔离根目录；不要把真实服务器地址或私钥路径写回模板。

## 5. 创建干净公开历史

首次发布空仓库时，也应由服务器从快照创建干净历史：

```bash
git init -b main
git config user.name imsinolam
git config user.email imsinolam@users.noreply.github.com
git add .
git commit -m "feat: publish DeskRelay 2.0"
git push origin main
```

后续发布必须以 GitHub 当前 `main` 为父提交，在服务器生成正常的增量提交。不要把私有开发仓库的 remote、worktree、stash、reflog、Git hooks 或 `.git` 目录复制到公开快照。

提交前检查 Git 作者邮箱；如果不希望公开私人邮箱，在公开仓库使用 GitHub noreply 邮箱。

## 6. GitHub 上线检查

- 文件列表没有凭据、日志、附件、真实任务截图和运行目录；
- commit 作者邮箱符合预期；
- README 图片都经过隐私审查；
- CI 的 safety、lint、typecheck、test、build 全部通过；
- Security Advisories 和分支保护已启用；
- issue 模板明确禁止提交 setup 链接、任务 ID、日志和未脱敏截图；
- 仓库链接、npm metadata 和 README badge 全部指向 DeskRelay；
- 发布服务器的 `git ls-remote origin refs/heads/main` 与本次提交 SHA 完全一致；
- 本机网络日志中没有本次向 GitHub 上传代码的 Git 操作。

## 7. npm 发布

GitHub 发布和 npm 发布是两件事。没有用户明确授权时，不执行真实 `npm publish`。

维护者应先运行 `npm publish --dry-run --access public`，检查无误后只发布 `deskrelay`。发布后必须从 npm registry 查询真实版本，并重新全局安装执行最小 smoke；不能仅凭本地命令成功就宣称已经发布。

## 8. 后续同步

私有开发仓库与公开仓库并行时，不复制私有 `.git`。本机源仓库可以继续保留自己的开发提交，但公开提交由服务器根据隐私快照独立创建，因此两边 commit SHA 不要求一致；以公开文件树和服务器返回的 GitHub SHA作为发布证据。

每次公开推送前至少运行 `npm run privacy:check` 和 `git diff --check`；涉及 CLI、部署模板、依赖或发布包时再运行完整质量、打包和全局安装验证。任何自动化都不得提供“服务器失败后改为本机直推 GitHub”的 fallback。
