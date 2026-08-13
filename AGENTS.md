# Repository Guidelines

## Project Mental Model
DeskRelay extends real local coding-agent sessions to WeChat, LAN web, and an optional public application relay without creating a forked conversation. The only public npm package is `deskrelay`; do not reintroduce legacy package names or command aliases.

There are two runtime shapes:
- `deskrelay` (alias `deskrelay-daemon`): the preferred long-lived mode. It owns one WeChat connection for one startup working directory, keeps supported Agent slots alive, and switches from WeChat with commands such as `/codex`, `/claude`, `/grok`, `/codebuddy`, `/reasonix`, and `/opencode`. Switching reuses an already connected visible CLI, or opens a new visible CLI when needed.
- Standalone bridges: `deskrelay-bridge-*` commands run one adapter-specific bridge. They are still useful for focused debugging, but must not run alongside a same-cwd daemon.

Runtime data lives under `~/.deskrelay` by default. Version 2.0 copy-migrates missing files once from the former `~/.cli-bridge` directory and older Claude channel locations; only `DESKRELAY_DATA_DIR` can configure the active directory.

## Project Structure
- `src/wechat`: iLink setup, channel config, long polling, message send, inbound media download/decryption, stale context-token handling, and transport logging.
- `src/bridge`: bridge lifecycle, adapter selection, controller orchestration, approvals, user-input requests, final-reply forwarding, locks, workspace state, process cleanup, and shared formatting.
- `src/bridge/bridge-adapters.*.ts`: adapter-specific Codex, Claude Code, TClaude, Grok, CodeBuddy, reasonix, WorkBuddy, OpenCode, and shell behavior. Keep adapter conditionals here or in closely related companion modules.
- `src/companion`: visible local CLI companion launchers, IPC endpoint files, daemon delegation, and local companion proxy support.
- `src/daemon`: persistent WeChat daemon, daemon IPC, multi-slot switching, visible terminal auto-open, and pre-start cleanup of stale single bridges.
- `src/runtime`: bridge-owned runtime host creation, including the Codex runtime host and legacy adapter runtime wrapper.
- `src/media`: shared media/attachment metadata types.
- `src/commands` and `src/utils`: global command helpers and update checking.
- `bin/*.mjs`: published CLI wrappers. These are tracked source files, not generated output.
- `scripts`: release, safety, snapshot, and packaging helpers, especially `check-public-safety.mjs`, `create-public-snapshot.mjs`, and `smoke-global-install.mjs`.
- `test/<area>` mirrors the runtime areas: `bridge`, `companion`, `daemon`, and `wechat`.
- `docs/releases`: release notes and the release index. Keep English and Chinese notes aligned when preparing a release.

## Runtime State And Files
Default active state is in `~/.deskrelay`:
- `account.json`, `sync_buf.txt`, `context_tokens.json`: WeChat login and sync state.
- `bridge.log`: combined bridge and daemon runtime log.
- `bridge.lock.json`: single-bridge ownership lock.
- `daemon-endpoint.json`: daemon IPC endpoint.
- `workspaces/<workspace-key>/bridge-state.json`: workspace-scoped bridge state.
- `workspaces/<workspace-key>/daemon-state.json`: daemon adapter/thread restore state and the persistent Codex mobile access token.
- `workspaces/<workspace-key>/codex-panel-endpoint*.json`: adapter-scoped local companion endpoints.
- `inbound-attachments/<date>/`: downloaded WeChat images and files.
- `inbound-message-claims/`: cross-process inbound message deduplication claims.

Do not commit local credentials, runtime state, logs, generated `dist/`, `node_modules/`, or ignored local planning/artifact directories. `log.md` and `git-log.md` are intentionally ignored; only edit them when the user explicitly asks for the repo's double log, and use `git add -f log.md git-log.md` if they must be committed.

## Build, Test, And Development Commands
Install dependencies:
```bash
bun install
```

Source-mode setup and checks:
```bash
npm run setup
npm run check
npm run daemon -- --adapter codex
npm run bridge:codex
npm run bridge:claude
npm run bridge:opencode
npm run codex:start
npm run claude:start
npm run opencode:start
```

Quality gates:
```bash
npm run lint
npm run typecheck:src
bun test test
npm run build
npm run quality
```

Focused tests:
```bash
bun test test/bridge
bun test test/companion
bun test test/daemon
bun test test/wechat
```

Packaging and global smoke validation:
```bash
npm pack --dry-run --json
npm run smoke:global -- --purge-global --clean-cache
npm run smoke:global -- --purge-global --clean-cache --full
```

The project runs TypeScript directly in source mode with Node 24 strip-types support, but published packages must ship compiled `dist/*.js`. Keep `prepack` and `npm run build` working before any npm release.

## Coding Style
Use TypeScript ESM with strict typing. Match the local style: 2-space indentation, semicolons, double quotes, and explicit `.ts` imports in source and test files. Prefer `camelCase` for values/functions, `PascalCase` for classes/types, and kebab-case filenames such as `bridge-final-reply.ts`.

Keep edits small and behavior-scoped. Do not introduce cross-cutting adapter conditionals unless the surrounding architecture already centralizes that decision. Prefer existing helpers for locks, endpoint files, process cleanup, runtime host creation, transport error formatting, and WeChat prompt formatting.

`bin/*.mjs` wrappers must stay LF-normalized because npm installs them as executable shebang entrypoints. `.gitattributes` pins this; do not ignore or regenerate `bin/`.

## Testing Expectations
Use `bun:test`. Name files `*.test.ts` and place them under the matching `test/<area>` directory.

Add focused regression coverage when changing:
- bridge ownership, locks, stale lock cleanup, daemon takeover, or process reaping;
- daemon switching, visible CLI auto-open, daemon IPC, or same-cwd delegation;
- adapter final replies, session/thread following, approvals, or Codex `request_user_input`;
- WeChat transport, retry classification, stale context-token handling, inbound media download, AES decryption, or attachment prompt injection;
- global command wrappers, package metadata, release scripts, or npm install behavior.

For release-facing changes, run `npm run quality` plus package/smoke checks. For narrow fixes, run the smallest focused test first, then expand to the relevant suite.

## Daemon And Bridge Behavior
`deskrelay` is the preferred user workflow; `deskrelay-daemon` is an explicit alias for service definitions and debugging. It binds to its startup cwd; the current daemon does not switch to a different local project directory from WeChat. If a same-cwd daemon is live, every `deskrelay-*-start` command should delegate to the daemon instead of replacing it.

Daemon startup should clean stale or still-running single-bridge state automatically when possible. Do not push cleanup work onto the user if the code can safely detect and clear stale locks, dead endpoints, peer bridge processes, or orphan OpenCode processes. When changing cleanup logic, update daemon tests and make logs explicit enough to diagnose what was cleaned.

Standalone single bridges must refuse to start when a live daemon owns the workspace. If an endpoint is stale, clear it and continue using existing helper functions.

## WeChat, Attachments, And Transport
Inbound WeChat images and files are downloaded to `~/.deskrelay/inbound-attachments/<date>/` and forwarded to the selected CLI as local paths in the prompt. This project saves and exposes attachment paths; it does not implement OCR or document parsing inside the bridge.

`sendmessage ret=-2` is a stale WeChat context-token condition, not a generic send failure. Preserve the targeted cache-clearing and user-facing guidance around sending a fresh WeChat message after startup or long idle periods.

Network failures to `https://ilinkai.weixin.qq.com` may be proxy-related even when bridge state is healthy. Node `fetch()` needs appropriate `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and often `NODE_OPTIONS=--use-env-proxy`; keep `NO_PROXY=127.0.0.1,localhost,::1` so local daemon/companion traffic stays direct.

## npm Package Publishing
The root `package.json` must keep the single public package name `deskrelay`. Do not publish compatibility mirrors and do not add legacy command aliases back to `bin`.

Before a real npm release:
1. Inspect the real diff and identify user-visible and breaking changes.
2. Update `package.json`, `package-lock.json`, `bun.lock`, README, and the current release note.
3. Run `npm run quality`.
4. Run `npm pack --dry-run --json` and inspect the tarball contents and size.
5. Run `npm run smoke:global -- --purge-global --clean-cache`; use `--full` for the full release path.
6. Run `npm publish --dry-run --access public`.
7. Publish only after explicit user authorization.
8. Verify the live registry with `npm view deskrelay version dist-tags --registry=https://registry.npmjs.org/ --json`.

Do not claim publication until the live registry confirms it. `EOTP`, `E401`, or `E404` remains an auth/registry blocker until verified.

## Release Process
- Keep README focused on product relationships and the shortest successful setup; move command matrices and advanced configuration into `docs/`.
- Add one release note for the current public baseline instead of rewriting historical release notes to pretend they used the new name.
- For the public repository, export a privacy-checked snapshot and create a clean Git history; do not push this private development history directly.
- GitHub fetch, commit, push, and remote verification for the maintained public repository must run on the configured publishing server. The developer Mac may validate and upload a privacy-reviewed snapshot to that server over SSH, but must never fall back to a direct GitHub push. Follow `docs/publishing.md` and keep server addresses, identity paths, deploy keys, and credentials outside the repository.
- The publishing server must use an isolated DeskRelay directory, reject non-fast-forward updates, verify the final remote SHA, and avoid touching unrelated server projects.
- Only update `log.md` and `git-log.md` when the user explicitly requests the double log.

## Commit And PR Guidance
Use Conventional Commit prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `build:`, and `chore:`. Keep subjects imperative and behavior-focused, for example `fix: preserve daemon visible companion occupancy`.

PRs should describe:
- affected adapter(s) or runtime area;
- user-visible behavior change;
- migration or compatibility impact;
- commands run;
- relevant WeChat output or terminal snippets for approval, onboarding, daemon switching, or message formatting changes.

Before committing, inspect `git status --short --ignored`. Do not commit ignored local runtime state. If the user explicitly wants the double logs committed, force-add `log.md` and `git-log.md`.

## Troubleshooting Workflow For Agents
When behavior is unclear, inspect real state before changing code:
- `~/.deskrelay/bridge.log` for bridge/daemon runtime events;
- `~/.deskrelay/daemon-endpoint.json` for daemon ownership;
- `~/.deskrelay/bridge.lock.json` for single-bridge ownership;
- `~/.deskrelay/workspaces/<workspace-key>/bridge-state.json` for active adapter/session state;
- adapter-scoped companion endpoint files under the workspace state directory.

Missing WeChat replies usually reduce to one of these questions: did the active adapter emit `final_reply`; was the active turn WeChat-owned; did transport send fail; did stale context-token handling clear the right recipient token; or did daemon switching target a different cwd.

Prefer surgical fixes backed by focused tests. Avoid broad rewrites of adapter flow, transport state, or release docs unless the user explicitly asks for a larger redesign.

## Agent Experience Records
- **任务看板入口右侧的数字必须只统计真正仍在进行中的任务，不能统计所有未归入“最近完成”的历史任务。** `running`、`approval`、`input` 都表示任务尚未结束，应计入；`idle`、待继续、异常和已完成不应计入，否则大量历史任务会把角标错误推到 `99+`，让用户无法判断当前真实负载。
- **移动网页必须把消息、进展、审批请求和审批结果视为同一条任务时间线，只要双方有真实时间就优先按时间稳定交错，不能要求 turnId 匹配后才按时间排序。** 历史分页、加速读取或旧数据可能让消息缺少 turnId、审批 turnId 暂不在当前页；若仍先按 turn 锚点排序，多个免审结果就会被集中到底部。从 Agent 原始记录保留时间戳，审批结果优先使用请求时间，并仅对无时间的旧数据使用同轮次兼容回退，才能保证刷新、分页和历史恢复后的顺序一致。
- **移动网页切换任务或终端时必须先按 adapter + task ID 保存已加载会话快照与未发送草稿，返回缓存任务应先同步恢复内容再后台增量刷新。** 每次切换都清空消息和输入框会让用户重复等待、丢失正在组织的内容；跨终端只按 task ID 缓存还会串会话，因此缓存身份必须包含 adapter，消息快照只保留在当前页面内存并设置上限，草稿在真实提交后只清除当前任务。
- **移动网页新建任务不能把“新任务尚未进入桌面任务索引”当成创建失败；新的 adapter + session/thread ID 才是创建成功的权威信号。** Codex 等桌面 Agent 的空任务可能要等首条消息或异步索引完成后才出现在任务列表，如果服务端继续强依赖立即枚举，就会实际创建成功却向网页返回“请到电脑端确认”；应先返回带真实 ID 的临时任务信息，让用户立即进入并发送首条消息，再由后续任务列表刷新补齐标题和项目元数据。
- **ClawBot 的“今日内本任务免审”必须按 Agent 与任务 thread 持久化，不能绑定 turn，也不能在单轮 `task_complete` / `task_failed` 时清理。** 同一任务后续轮次和守护进程重启都应继续自动接受；新任务因 thread 不同自然恢复逐项审批，这能避免把一次回复结束误判成整个任务结束。 部署操作本身经常需要停止并重启守护进程；如果免审只保存在内存里，用户刚选择免审就会在同一任务的下一步再次收到审批，直接违背该选项的核心承诺。
- **ClawBot 任务列表的执行中状态应显示为 `🟢`，不要再写“运行中”。** 列表需要快速扫读且任务标题已经占据主要空间，用单一状态 emoji 能减少文字噪声，并与网页任务列表的绿色运行指示保持一致。
- **具备多客户端后端的 CLI Agent 应直接共享一个长期 owner，不能让远程端和电脑 TUI 各自启动独立 ACP。** Grok 已验证可用工作区级 `agent leader` 同时承载 ACP 客户端和可见 TUI；共享 socket、稳定 sessionId 和关闭时清理 owner，才能让手机消息实时出现在电脑终端并避免会话分叉。固定 leader socket 连接失败时不能在一次 250 ms 探测后直接 unlink，必须先重试，再用 `lsof` 精确确认持有该 socket 的进程确实是 `grok agent leader`，只回收不可连接的 orphan owner；否则会留下持锁但无法再通过路径连接的长期进程，让此后每次启动都固定超时。
- **对外说明“支持某个 Agent”时必须分别标明原任务继续、电脑端可见和已打开界面实时同步，不能把能读取历史、启动命令或加载 ACP 会话统称为完整支持。** 这些能力对应不同的数据 owner 和同步强度；混写会让用户误以为手机消息一定进入当前桌面窗口，掩盖真实 owner 边界，并重新制造对话分叉风险。
- **恢复用户明确选择的持久任务时，必须保留原任务身份；新启动 companion 若只是 socket 已连接但 worker 尚未 ready，应对同一 session 做有界重试，只有超时或真实恢复错误才报告不可用，不能自动新建任务或切换到“最近任务”。** socket 连通早于内部 Adapter 就绪，若立即恢复会把正常冷启动误报成任务损坏；而静默换成另一个 session 又会制造不可见分叉，因此 Claude、OpenCode、Grok 和 CodeBuddy 等适配器都要先等待原任务恢复，再由用户决定失败后的处理。
- **对外品牌迁移必须同时统一 npm 包、公开命令、活动数据目录和环境变量，不能只改界面文案后继续保留旧产品入口。** 半迁移会让 README、安装体验、日志、部署脚本和用户认知长期割裂；破坏性更名应通过主版本升级和一次性旧数据迁移完成，而不是永久保留两套公开名称。
- **开源前不能只检查当前源码，还必须排除所有未经审查的位图、官网草稿和真实聊天截图，并从已审计快照创建干净的公开 Git 历史。** 未跟踪的营销目录同样可能带账号名、任务内容和局域网地址，而旧提交仍会保留已经删除的二进制图片；让当前快照扫描所有位图、让历史扫描检查敏感文件名，并用无历史快照首次发布，才能阻止这些内容永久公开。
- **无分隔符的“任务关键词”必须先确认能匹配真实任务，再当作控制命令。** 这样既支持“任务canvas”快速筛选，又不会把“任务做完后告诉我”这类正常对话误判为任务切换；有空格或冒号时则视为用户明确发出的搜索命令。
- **可变条数翻页必须从当前已展示范围的末尾继续，而不能用新条数重新计算页码起点。** 例如首屏 10 条后发送“下一页20”应展示第 11–30 条；保存起点、条数和历史位置才能避免跳过任务，并让“上一页”准确返回原范围。
- **对运行于 `dist/` 的 LaunchAgent 做完整构建前，要先卸载服务，构建后再加载并验活。** `npm run quality` 会先删除再重建 `dist/`；仅在构建后执行 `kickstart` 仍可能撞上 LaunchAgent 的自动重启窗口，实测会因依赖文件暂时不存在而退出。先 `bootout`、构建完成后 `bootstrap`，再等待健康检查成功，能避免把公网移动端留在离线状态。
- **移动网页 title 应优先使用当前任务名，并在任务切换、深链接恢复、异步列表加载和重命名后立即同步；只有没有选中任务时才回退到 DeskRelay 与当前终端。** 这让手机浏览器标签、历史记录和多标签页能直接区分任务，也避免页面正文已经切换而浏览器标题仍停留在旧任务。
- **后台解析 CLI 命令和启动子进程必须共用同一套用户 PATH。** 只给子进程补 PATH 还不够，因为命令可能在 `resolveSpawnTarget` 阶段就退回裸命令并触发 ENOENT；把 `~/.hermes/node/bin` 等目录同时用于命令解析与运行环境，才能让 CodeBuddy、TClaude 这类由用户级工具链安装的 CLI 在 LaunchAgent 中稳定启动。
- **CodeBuddy 必须由同一个 `codebuddy --serve` 进程同时承载可见界面与 HTTP ACP，不能再启动独立 `codebuddy --acp`。** 实测独立 ACP 即使复用相同 sessionId，仍会形成第二个 live owner，让手机消息无法实时出现在电脑界面；共享一个 serve 进程才能让输入、回复、审批和停止保持同源。
- **移动端深链接可以先乐观显示请求的 adapter，但是否需要切换必须与服务端真实 activeAdapter 比较。** 乐观标签能让首屏立即显示目标终端，同时用 `requestedAdapter !== adapterPayload.activeAdapter` 决定真实切换，可避免把 `?adapter=tclaude` 误判为已经切换；首次切换还要保留 `task` 参数，才能从完成通知直接进入指定终端的指定任务。
- **已认证的移动网页必须先展示稳定的 App Shell，再分步连接终端、读取任务和最近消息。** 某些 CLI 启动需要十几秒；若把 `app.hidden = false` 放在全部异步请求之后，用户只能长时间停留在 Logo 页。实测先展示“正在连接 / 正在读取”占位，再异步填充任务与最近消息，能立即反馈进度且不影响历史消息按需向上加载。
- **macOS LaunchAgent 启动后台守护进程时，运行目录和辅助 app-server 的 cwd 都应放在 `~/.deskrelay`，真实项目目录通过参数或 RPC 显式传入。** 后台进程直接以 `Documents` 下的项目作为 cwd 时，实测会卡在 `getcwd/open` 或导致 Codex app-server 启动超时；将宿主 cwd 放到 Bridge 自有目录后可以正常启动，同时任务仍使用真实项目上下文。
- **桌面任务或原生待发送队列的请求超时不能直接等同于发送失败，应以真实任务状态、队列持久化状态和回读到的用户消息作为接受确认。** Codex 桌面 owner 可能已经启动 turn 或写入队列，却没有及时返回请求响应；若界面直接标失败并删除已上传图片，会诱导重试、制造重复任务，还会让稍后执行的真实任务读不到附件，因此未确认时必须保留附件并提示查看真实状态。

- **消息导航按钮应固定在消息阅读区右上角，并保持弱化的半透明视觉。** 放在左上角会与菜单和标题形成错误的操作归属，也会偏离用户在内容区右侧浏览上下文的习惯；仅在存在可跳转消息时显示，能减少干扰。
- **只要当前回复尚未完成，就要在消息末尾持续显示明确的处理中动画。** 仅依赖顶部状态会让已经停止增长的正文看起来像完整答案，三个点的持续反馈能避免用户误判任务已结束，完成或等待审批时必须及时消失。
- **侧边栏任务的长按菜单只能由可见任务项本身触发，正文文字选择必须优先于任务菜单。** 微信 WebView 可能延迟派发原生 `contextmenu`，仅取消长按计时器仍可能在正文选择时误弹菜单；移动端收起侧边栏后同时设为 `visibility: hidden` 和 `pointer-events: none`，触发菜单前再次校验命中位置、侧边栏状态与选区，并在正文 `pointerdown`、`selectstart`、`contextmenu` 时关闭菜单，才能可靠保留文字选择。
- **移动网页每次发布都必须给 HTML、静态资源和微信任务链接带同一内容版本，并让已打开页面定期检测版本。** 微信内置浏览器会复用旧页面和旧的 `/app.css`、`/app.js`，即使服务端返回 `no-store` 也可能继续显示上一版交互；使用资源内容哈希、版本化链接和前台恢复时自动换页，才能让部署后的修复真正到达手机。
- **网页的乐观用户消息必须在真实用户消息出现时立即合并，即使发送请求仍未返回。** Codex 可能先把消息写入真实会话、几十秒后才回复 HTTP 请求；若 `sending` 状态禁止合并，轮询会同时渲染真实消息和乐观消息。应记录发送前用户消息的稳定身份集合，而不是依赖分页内序号，避免分页窗口移动后同一条消息显示两次。
- **“已完成”状态只能绑定到同一个最新 turn，不能回退到上一轮的完成摘要。** 新用户消息已出现但桌面运行状态尚未同步时，旧摘要若被插到最新消息之后，会让正在处理的任务看起来已经结束；应保留本地运行态直到真实 turn 接管，并在最新用户 turn 与摘要 turn 不一致时隐藏旧完成状态。
- **移动网页的异步操作必须立即反馈，但同一个状态只能保留一处动态进度。** 终端启动、消息转发等操作可能需要数秒到数十秒；如果等接口返回后才反馈，用户会认为点击无效并重复操作，但把“正在连接”同时放在品牌栏、标题、状态栏、列表和内容区又会造成强烈噪声。应先乐观呈现目标，把耗时和转圈集中在唯一状态位，其他区域只保留目标名称或保持安静。
- **同一维护窗口内的守护进程重启通知必须持久化去重，并且只有实际发送成功后才记录时间。** LaunchAgent 在部署、超时恢复或连续拉起期间可能短时间重启多次；每次启动都通知会让用户误以为连接反复故障，而仅做内存去重又无法跨进程生效，因此要把最近成功通知时间写入工作区状态，失败通知则保留到微信上下文恢复后只补发一次。
- **CLI 退出码 0 必须按正常关闭处理，微信端错误要翻译成中文并附上恢复动作。** `code 0` 表示进程正常结束，不应包装成 `worker exited unexpectedly` 或 `fatal_error`；非零退出也不能直接暴露英文内部术语，提示必须说明发生了什么、是否需要担心，以及用户可发送哪个命令重新打开。
- **ClawBot 的当前 Codex 任务必须与桌面端当前任务分开持久化。** 桌面端本地切换频率很高，若共用一个 threadId 会让微信消息悄悄发往错误任务；只有用户在 ClawBot 手动选择任务，或某项完成通知已成功发到微信时，才允许改变 ClawBot 当前任务。
- **ClawBot 的任务列表、稳定编号、数字冒号直发和切换后自动列任务必须作为所有会话型 adapter 的通用能力实现，不能写成 Codex 特例。** 重复调用桌面端列表接口、为进入任务而打开桌面任务会造成数秒到十几秒延迟，而按 Codex 硬编码又会让 Claude、TClaude、Grok、CodeBuddy、reasonix、WorkBuddy、OpenCode 的微信体验缺失；所有提供任务列表和 `sendInputToSession` 的 adapter 都应复用短时缓存、稳定编号快照、翻页和“数字：内容”入口，才能兼顾速度、一致性与后续扩展。切换到依赖可见 companion 的 Agent 后，socket connected 不代表内部 adapter 已 ready；切换后的自动任务列表必须只对明确的 `connected but not ready` / `not connected yet` 启动状态做有限重试，真实业务错误仍应立即返回，否则 Grok 等冷启动时会显示切换成功却不再补发列表。
- **守护进程清理只能识别由 Node 或 Bun 直接执行的真实 daemon 入口，不能按整条命令行是否包含文件名判断。** 部署 shell 会把项目路径和 `deskrelay-daemon` 文本写进自身命令行，宽泛正则会误杀正在部署的 shell；解析实际运行时与入口脚本并用回归测试覆盖，才能安全接管旧守护进程。
- **macOS LaunchAgent 打开可见终端应让 `/usr/bin/open` 打开自删除的可执行 `.command` 文件，但真实 GUI 验证禁止裸用 `launchctl submit`，普通测试只能验证纯函数或注入假的启动器。** AppleScript 由后台 LaunchAgent 发起时会阻塞，而 `launchctl submit` 又可能把快速退出的 `open` 推断成 keepalive；本次残留任务自动运行 284 次并产生 289 个测试窗口。真实验证必须用 `trap` 无条件移除临时任务、前后核对窗口数，才能既绕开自动化权限又不干扰用户桌面。
- **编译后的 Node 命令行入口不能只依赖 `import.meta.main` 判断是否直接运行，还要比较 `process.argv[1]` 与当前模块路径。** Node 23 中 `import.meta.main` 不可用会让脚本以退出码 0 静默结束，表面上像终端启动成功但永远不会连接；兼容判断已用真实编译产物验证，今后新增入口必须覆盖目标 Node 版本。
- **ClawBot 的任务列表保留稳定序号用于选择和“数字：内容”直发，但进入任务后的消息头只能显示任务名，不能再暴露序号或任务 ID；历史品牌 `codex-clawbot` 必须迁移显示为 `DeskRelay`。** 序号是短期导航坐标，不是用户理解消息归属所需的信息，把它和 UUID 放进审批、桌面输入、完成通知等消息头会制造技术噪声并让旧品牌继续外泄；列表负责导航，任务消息只负责清楚说明来自哪个任务。
- **内部传输提示不能作为用户消息展示，附件意图识别也不能把“讨论 ClawBot 消息”误判成“发送文件”。** 这类误判会把大段协议文字写进真实对话，既污染上下文又让用户误以为必须理解内部机制；网页应只还原真实请求，只有明确涉及文件、媒体、本地路径或简短发送指令时才注入提示，提示确有必要时必须使用中文和当前平台适用的路径示例。
- **公网移动页自动切换局域网必须先比对手机与电脑的公网出口，再用短时一次性交接令牌建立受来源限制的局域网会话，并保留公网回退。** HTTPS 公网 Cookie 不能复用到局域网 HTTP，盲目替换地址又会在异网或隔离网络中卡死；出口比对减少误判，一次性令牌和只能从原局域网来源使用的短期会话避免暴露密码或把局域网 Cookie 拿到公网复用，失败标记与回退则保证加速失败时仍能继续使用公网。
- **移动网页展示 Codex 的 AI 输出时要保持单一连续正文流，并默认折叠次要的长内容。** 用户是在手机上延续同一个桌面任务，重复“工作过程”、灰色小字、截图传输标签、完整铺开的长代码和过多旧进展都会打断阅读；正文应沿用 Codex 的主文字层级，附件只保留真实请求，长代码与旧进展默认折叠但必须可随时展开。
- **AI 生成的图片必须作为统一消息内容同步到网页和 ClawBot，不能只保留文字或依赖某个终端专属的图片打开入口。** 用户会在手机上延续同一个 Agent 任务；如果图片只存在于 Grok/Codex 等桌面终端的工具结果里，网页就会缺少关键结果，微信也只收到不完整的文字，因此各 Agent 的原生图片记录应先归一为公共消息媒体，网页用受鉴权的不透明地址展示，ClawBot 再按当前轮次去重发送真实图片消息。
- **移动端轮询超长 Codex 任务时必须只读 rollout 文件尾部和已缓存的桌面状态，历史专用请求还必须完全跳过桌面实时状态合并，不能为了补消息主动调用 `followThread()` 或完整 `thread/read`。** 实测 47 MB 会话中，完整桌面订阅会让守护进程瞬时占用约 95% CPU、3.2 GB 内存；而尾部读取实时消息、运行时长和进展分别只需约 118 ms、5 ms 和 10 ms，历史专用请求跳过实时合并后可直接复用约 150 ms 的原生 40 条尾读结果，这直接决定移动网页在有无 OpenAgentLog 时都能快速显示正文且不拖慢电脑端。
- **reasonix 必须使用官方 `serve -resume <原 transcript>` 直接继续原任务，不能复制 transcript 到 DeskRelay 状态目录。** 复制历史会产生第二份可写记录，即使初始内容一致也会在后续消息中分叉；直接恢复原文件并让官方 Web UI 与远程入口连接同一个 serve owner，才能保证电脑和手机看到同一任务。
- **Codex 后台审批监控必须对所有 `active` 任务保持 `summary` 订阅，不能等任务列表先出现 `waitingOnApproval` 才订阅。** `waitingOnApproval` 和待审批请求本身来自 Desktop summary；如果先依赖这个标记再决定订阅，就会形成循环依赖，真实审批在桌面端可见但 ClawBot 永远收不到。`summary` 只保留状态与请求，不等于移动正文读取时的完整 follow，因此既能发现审批，又不会重新引入超长会话的大内存问题。
- **WorkBuddy 的远程消息必须进入桌面主进程实际持有的 app-server，并通过 `session:load`、`session:sendMessage`、`session:cancel`、`session:resolvePermission`、`session:rejectPermission` 操作，禁止回退到独立 ACP；普通方式启动且缺少 hook 时应由 DeskRelay 自动正常重启接入，并清理失去父进程的旧 app-server，不能要求用户手动退出。** 即使独立 ACP 复用了同一个 sessionId 和数据库，它仍是另一个 live owner，消息能运行却不会出现在 WorkBuddy 桌面界面，最终造成上下文与聊天记录隐藏分叉；而 Electron 单实例也无法把后加的 `NODE_OPTIONS` 注入既有主进程，只有自动重启并确保只保留一个 app-server owner，才能让用户消息、运行状态、审批和回复同步到桌面、网页和 ClawBot。自动接入的整体 `connectTimeout` 必须同时约束 `launch/restart` 本身，`osascript` 也要设置进程超时；否则 WorkBuddy 阻止退出时网页只会永久显示“正在连接”，既没有成功也没有可操作错误。
- **macOS 上供 WorkBuddy 与 DeskRelay 共用的 Unix socket 必须使用稳定的 `/tmp/deskrelay-workbuddy-<uid>.sock`，不能分别依赖各进程的 `os.tmpdir()`。** GUI 应用与 LaunchAgent 可能解析出不同的 `/var/folders/...` 临时目录，导致 socket 明明存在却被误判为“桌面尚未接入”；固定本机私有 socket 路径并设置 `0600` 权限，才能让重启后的守护进程可靠重连且不开放网络端口。
- **新增 `BridgeAdapter` 可选能力时必须同步检查并转发所有 RuntimeHost 包装层，不能只改 adapter 和调用方。** Daemon 实际持有的是 `LegacyAdapterRuntime`；如果包装层漏绑新方法，源码类型仍可通过且 adapter 单测也会成功，但运行时能力会悄悄变成 `undefined`，导致加速历史无法补图片等只在真实部署出现的问题，因此要为“缺失时保持 undefined、存在时保持 this 绑定并正确转发”各写回归断言。
- **网页中的用户输入图片必须和 AI 输出图片共用同一套可点击预览，并在乐观消息被真实历史替换后继续可见。** 只让上传缩略图短暂显示会导致发送成功、刷新页面或重启服务后图片消失，用户无法回看自己给 Agent 的关键上下文；移动端输入图片应持久记录到对应 adapter、任务和 turn，历史读取时恢复为受鉴权的公共消息媒体，同时输入框缩略图也应直接打开全屏预览。
- **命中移动端输入图片记录后必须以网页保存的原图替换 Agent 原生记录里的输入图片，不能把两路图片直接合并。** Codex 等 Agent 可能把同一次上传压缩或转码后再次写入历史，路径与字节都不同但视觉内容相同；若按路径合并，用户只上传一张却会看到两张，因此移动端记录匹配成功时应成为该条用户消息的权威媒体。
- **移动网页轮询更新运行进展或审批状态时必须复用未变化的消息与图片 DOM 节点，不能清空消息容器后整段重建。** 全量重建会让历史图片每隔几秒重新请求、解码并闪动，即使图片本身没有变化；按稳定消息身份缓存节点、仅在该消息内容变化时重建，才能保持阅读位置和图片加载状态稳定。
- **移动网页合并加速历史与原生实时消息时必须按跨来源的稳定消息序列对齐，不能直接追加、只依赖消息 ID，或只匹配“旧页结尾＝新页开头”的连续重叠。** OpenAgentLog 可能没有原生 `id`、`turnId`、`phase`，还会插入 `[tool_use]` 等来源特有记录；原生实时页也可能从更早的位置开始。若按数组追加或窄重叠匹配，乐观消息被真实消息替换后就会跳位、重复并与旧消息串在一起；使用忽略缺失元数据但尊重明确冲突的序列对齐，并以原生页替换已对齐区间，才能让消息顺序在轮询和异步刷新后保持稳定。
- **Codex 桌面实时消息必须只合并当前被跟踪 turn 的 tail，不能把 `turnHistory` 中所有残留 tail 都追加到移动网页历史。** Codex 桌面状态会暂存多个旧 turn，甚至继续把旧实体标成 `inProgress`；若全部合并，最新用户消息后面会突然出现几条久远用户消息，并在任务结束后再次消失。以 adapter 已跟踪的当前或后台 `turnId` 为权威，当前 turn 尚未出现在桌面快照时宁可暂不合并，也不能回退到旧 tail，才能保证消息顺序稳定且不串轮次。
- **微信审批选项 4 的用户文案统一使用“今日内本任务免审”，不要再显示“本任务结束前免审”。** 这是用户明确指定的短文案；审批列表需要在手机上快速扫读，保持固定措辞才能避免用户反复确认数字 4 的含义。
- **ClawBot 同时出现多项审批时必须按审批推送顺序维护全局队列，不能依赖微信引用的“最新消息”来判断归属。** 用户连续回复单个数字时，每个数字依次处理最早未审批项；一条消息中的多个 `1–4` 可用空格或标点分隔并按顺序执行，且必须逐项回执序号与结果。有待审批时裸数字优先属于审批，切换任务应使用“任务 2”，这样才能避免任务编号、用户输入和跨 Agent 审批互相抢占。
- **官网演示截图必须省略项目名、避免任务列表产生孤字换行，并保留完整手机状态栏；电脑端与移动端配图还要使用同一批任务和逐字一致的续派消息。** 这些细节直接决定用户能否一眼理解“移动端接力原任务”，也能避免营销图暴露无关工作区信息或显得像拼接假数据。
- **微信审批推送失败时必须区分“没有检测到审批”和“iLink context token 已失效”，并在下一条微信消息刷新 token 后先补发仍有效的审批，再处理新消息。** 长任务经常超过微信主动回复窗口；如果先执行用户的新输入或静默丢弃，审批可能继续卡住，用户也会误以为 DeskRelay 没监控到任务。
- **给运行中的 LaunchAgent 部署本地 npm 包时必须安装 `npm pack` 产出的 tarball，并在文件完全落盘后彻底重启进程、核对运行中的 `/app-version` 与磁盘模块计算值一致，不能直接 `npm install -g <仓库目录>` 或只看端口健康。** 直接安装目录会把全局包变成指向工作区的软链接；安装尚在替换文件时过早启动又可能让新进程把旧模块留在内存里，出现代码已更新但手机因版本号未变而继续运行旧 JS。先卸载服务、打包安装、确认文件完成，再等待端口释放后重新加载，同时比对版本，才能保证开发目录、运行副本和移动端缓存真正一致。
- **网页审批结果必须按 Agent、任务和 turn 持久化并重新合并进消息流，不能在清空待审批卡片后只保留短暂 Toast。** 审批卡片消失并不代表用户不再需要确认自己的选择；记录允许、拒绝、任务级允许或免审结果，并在刷新后恢复到对应轮次附近，才能避免用户误以为操作未生效，也能防止结果串到其他任务。
- **DeskRelay 的敏感运行时写入必须统一经过私有目录与原子私有文件 helper，并在启动时递归修复旧数据权限。** 只在个别调用点传 `mode` 会遗漏已存在文件、原子临时文件和迁移复制内容；POSIX 上统一目录 `0700`、普通敏感文件 `0600`，并跳过符号链接，才能避免凭据、上下文令牌、日志和附件因 umask 或历史版本遗留而被同机其他用户读取。
- **Codex 完成通知必须把待发送正文、分段进度和成功去重键持久化，发送前只能标记 in-flight，不能提前标记 delivered 或清理 final reply。** 微信 context token 可能在长任务结束时失效，且多段消息可能只成功一部分；只有全部文本送达后再清缓存，并从未送达分段继续补发，才能同时避免通知永久丢失和重复发送，daemon 重启后也能恢复。
- **任何来源产生的审批都必须先持久化再尝试推送微信，并在微信 context token 刷新后补发；审批已解决时必须取消待补发记录。** 桌面端或移动网页发起的任务同样可能卡在审批，而微信 token 会因长时间无消息失效；只把审批保存在 slot 内存中会在发送失败或 daemon 重启后永久丢失，持久化 pending/delivered 状态才能保证手机仍是可靠的审批入口，同时避免旧审批晚到。
- **审批命令进入网页、微信、日志或 daemon state 前必须统一脱敏密码、Bearer、token 与 API key。** 审批往往展示完整命令，若命令含 `sshpass` 或鉴权参数，原样记录会把凭据扩散到截图、日志和持久化文件；先脱敏再生成通知键和可见记录，才能同时保证重启匹配与最小暴露。
- **用某个 nvm 目录下的 `npm` 绝对路径执行安装时，仍必须把同目录的 Node 放到 `PATH` 最前面。** `npm` 的入口使用 `#!/usr/bin/env node`，只指定 `.../bin/npm` 仍可能由另一套 Node 运行并安装到错误的全局前缀；先固定 `PATH`、再核对 `npm prefix -g` 和最终命令解析，才能确保 LaunchAgent 使用的是真正验收过的副本。
- **macOS 打包给 Linux 使用的公开快照时必须设置 `COPYFILE_DISABLE=1`。** 否则 BSD tar 会把扩展属性编码成 `._*` AppleDouble 文件，Linux 解包后这些文件会进入 Git 候选列表并触发隐私审计；禁用 copyfile 元数据并在服务器检查不存在 `._*`，才能保证上传内容和本机审计快照一致。
- **移动网页启动必须区分 Relay 服务在线与电脑在线，公网电脑离线时显示“正在等待你的电脑主动连接服务器…”并自动重试，电脑上线后再提示读取任务；局域网直连则直接提示读取电脑任务，不能统一写成“正在连接电脑”。** 这能准确解释应用层主动中继的真实连接阶段，避免用户把 Relay 可访问误解成电脑已经在线，也不需要手动刷新等待页面。
- **移动网页的后台轮询遇到浏览器级网络失败时应对幂等 GET 只重试一次并保留现有内容，不能把 `Failed to fetch` 直接弹给用户；非幂等 POST 不得自动重放，只能标记结果未确认并回读真实状态。** 微信 WebView 前后台切换、手机切网、电脑短暂离线或 Relay 重连都会让单次 fetch 在收到 HTTP 响应前失败，这类抖动通常会在下一轮自愈；静默后台失败能避免噪声和假离线，中文化最终错误并把发送、审批等写操作视为未确认，则能防止用户重试制造重复任务或重复操作。
- **Claude 适配器必须统一显示为 Claude Code；对支持原生命令的 Agent，除 DeskRelay 明确保留的控制命令外，斜杠命令必须从微信和移动网页原样透传。** 这能避免把 Claude 品牌与 Claude Code 工具混淆，也能确保 `/login`、`/model`、`/compact` 等桌面终端能力不会在手机入口失效。
- **TClaude 0.0.9 不执行通过 `--settings` 注入的 Claude Hook，必须用真实 TUI 就绪信号和 `~/.tclaude/projects` transcript 作为兼容路径，并在 TUI 就绪后停止 Hook 健康检查。** 否则远程消息可能在输入界面尚未准备好时丢失，完成回复无法回传，甚至任务已经成功后仍误报“消息通道失败”。
- **移动任务看板不能把桌面横向 Kanban 直接缩到手机上；手机端必须改为无横向溢出的单列纵向泳道、隐藏空泳道，并让任务卡使用带 adapter 与 task 的真实深链接。** 横向卡片会挤压状态、项目和时间并让触摸滚动抢占点击；真实链接既扩大整卡点击范围，也能在脚本异常或打开新标签时可靠进入原任务。
