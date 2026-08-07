# 移动网页与公网访问

DeskRelay 有三个远程入口，但只有两种网页网络模式：

1. 微信 ClawBot：始终由 Mac 主动连接微信服务，不需要用户自建服务器；
2. 局域网网页：手机直接访问 Mac，仅在可互访的同一网络中使用；
3. 公网网页：可选地部署自建 Relay，由 Mac 主动连接 Relay。

三种入口最终操作的都是电脑端真实 Agent 任务。公网服务器不运行 Agent，也不会在桌面任务不可用时创建独立 CLI/ACP 会话。

## 模式对比

| 能力 | 无服务器 | 有服务器 |
| --- | --- | --- |
| 微信 ClawBot | 可用；Mac 主动轮询微信服务 | 可用；与自建 Relay 相互独立 |
| 手机网页 | 同一局域网访问 Mac | HTTPS 访问自建 Relay，同时保留局域网入口 |
| Mac 端口暴露 | 不需要 | 不需要 |
| Agent 与项目文件 | 保留在 Mac | 保留在 Mac |
| 电脑离线 | 微信和网页无法继续操作任务 | Relay 页面明确显示电脑离线 |
| 新增信任边界 | 微信服务 | 微信服务 + 自建 Relay 服务器 |

## 模式一：没有公网服务器

不要设置 `DESKRELAY_RELAY_URL` 或 `DESKRELAY_MOBILE_PUBLIC_URL`，直接启动：

```bash
deskrelay --adapter codex
```

DeskRelay 会：

1. 从物理网卡选择局域网 IPv4 地址；
2. 从 `DESKRELAY_MOBILE_PORT`（默认 `4396`）开始监听；
3. 在任务完成通知中生成 `http://局域网地址:端口`；
4. 继续使用本机保存的移动访问密码。

此时：

- 微信消息仍可从外部网络到达，因为连接由 Mac 主动发起；
- 网页必须由与 Mac 处于同一可互访网络的手机打开；
- 访客 Wi-Fi、企业网络隔离、VPN、系统防火墙或微信内置浏览器可能阻止局域网访问；
- Mac 休眠、关机或 daemon 停止后，微信和网页都不能继续操作 Agent。

本机验证：

```bash
curl -fsS http://127.0.0.1:4396/health
```

实际端口可能因冲突递增，可查看 `~/.deskrelay/bridge.log` 中的 `codex_mobile_started` 记录。

## 模式二：使用公网应用层 Relay

### 与微信 ClawBot 的关系

公网网页模式参考 ClawBot 的**连接原则**，但两者并不共用协议或服务器：

```text
微信：Mac 主动轮询微信 iLink ←→ ClawBot ←→ 微信用户
公网：Mac 主动轮询自建 Relay ←→ 公网网页
```

共同点是 Mac 主动建立出站 HTTPS 连接，公网服务不需要也不能主动连接 Mac 的本地端口。公网 Relay 是用户自建的独立服务；停用 Relay 不影响 ClawBot，微信服务异常也不影响局域网网页。

### 工作原理

```text
公网浏览器
  ⇅ HTTPS
自建 DeskRelay Relay
  ⇈ Mac 主动 HTTPS 长轮询 / 回传
Mac 上的 DeskRelay daemon
  ⇅ 本机 Agent 协议
Codex / Claude / WorkBuddy / 更多 Agent
```

公网服务器不连接 Mac 的本地端口。Mac 主动取回任务级请求，再主动提交结果。因此不需要 `cloudflared`、SSH `-R`、frp、ngrok 或其他通用端口穿透。

Relay 只接受 DeskRelay 移动接口的 `/api/` 请求，包括任务列表、消息、审批、停止、排队操作和附件。它不能指定任意目标 URL、主机、端口或 TCP 连接；固定的本机移动 API 地址由 Mac 自己配置。真实任务、工具权限、Agent 凭据和项目文件仍由电脑端 owner 持有。

### 为什么这种方式比通用内网穿透更安全

| 通用内网穿透 | DeskRelay 应用层 Relay |
| --- | --- |
| 把一个本机 HTTP/TCP 端口映射到公网 | Mac 只主动领取 DeskRelay 指令 |
| 暴露面取决于被映射服务的全部路由 | Relay 只接受固定 `/api/` 请求 |
| 服务器可沿隧道连接本机服务 | 服务器没有到 Mac 的反向连接 |
| 被映射服务的漏洞直接成为公网入口 | 本机端口不进入公网路由 |
| 重试可能重复执行写操作 | 指令 ID、有效期和本地 journal 去重 |

安全措施包括：

1. **连接方向受限**：Mac 只发起出站 HTTPS 长轮询和结果回传；
2. **设备认证**：Relay 使用设备 ID 与独立 Bearer Token 验证 Mac；
3. **浏览器认证**：移动网页密码和设备 Token 分离；
4. **协议收口**：只转发 DeskRelay `/api/`，不支持任意 URL、TCP 或端口映射；
5. **指令约束**：命令带唯一 ID、创建时间和过期时间；
6. **重试去重**：非幂等结果由 Mac 本地 journal 持久化，断线重试不重复下任务；
7. **唯一 owner**：Relay 不运行模型，不读取项目目录，不创建隐藏 CLI/ACP 会话；
8. **最小公网面**：Relay 内部服务绑定 `127.0.0.1`，只由 Nginx/Caddy 暴露 `443`。

这不是“零信任”或端到端加密方案。HTTPS 保护网络传输，但 Relay 进程在转发时能够接触请求正文、Cookie、回复和附件；服务器 root 管理员也处于信任边界。请使用自己控制的可信服务器，不记录敏感内容，高敏感任务优先使用局域网模式。

### 服务器准备

需要：

- 一台可运行 Node.js `>= 24` 的 Linux 服务器；
- 一个指向服务器的域名，例如 `relay.example.com`；
- 有效的 HTTPS 证书；
- 只对公网开放 `80/443`，不开放 Relay 内部端口；
- Nginx 或 Caddy 作为 TLS 入口。

在服务器安装 DeskRelay：

```bash
sudo npm install -g deskrelay@latest
command -v deskrelay-relay-server
```

记住 `command -v` 返回的真实路径，后面 systemd 的 `ExecStart` 必须与它一致。

### 1. 生成设备身份

生成至少 32 字节随机密钥：

```bash
openssl rand -hex 32
```

选择一个不含个人信息的设备 ID，例如：

```text
设备 ID：deskrelay-device
设备密钥：服务器与电脑各保存一份
```

不要把密钥放进 Git、聊天、截图、URL 或命令行参数。设备密钥与移动网页密码必须不同。

### 2. 配置服务器环境

创建 `/etc/deskrelay-relay.env`：

```text
DESKRELAY_RELAY_HOST=127.0.0.1
DESKRELAY_RELAY_PORT=14396
DESKRELAY_RELAY_DEVICE_ID=deskrelay-device
DESKRELAY_RELAY_DEVICE_TOKEN=替换为随机设备密钥
```

设置权限：

```bash
sudo chown root:root /etc/deskrelay-relay.env
sudo chmod 600 /etc/deskrelay-relay.env
```

仓库提供模板：

```text
deploy/systemd/deskrelay-relay.env.example
deploy/systemd/deskrelay-relay.service.example
```

### 3. 配置 systemd

建议创建独立系统用户：

```bash
sudo useradd --system --create-home --home-dir /var/lib/deskrelay --shell /usr/sbin/nologin deskrelay
```

全局 npm 包中包含 systemd 模板。复制并检查：

```bash
PKG_ROOT="$(npm root -g)/deskrelay"
sudo cp "$PKG_ROOT/deploy/systemd/deskrelay-relay.service.example" /etc/systemd/system/deskrelay-relay.service
sudo editor /etc/systemd/system/deskrelay-relay.service
```

如果从源码仓库部署，也可以直接使用仓库内的 `deploy/systemd/`。

必须确认：

- `ExecStart` 等于 `command -v deskrelay-relay-server` 的输出；
- `User` 与 `Group` 使用受限账号；
- `EnvironmentFile` 指向 `/etc/deskrelay-relay.env`；
- Relay 监听 `127.0.0.1`，不监听 `0.0.0.0`。

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now deskrelay-relay
sudo systemctl status deskrelay-relay
```

服务器本机验证：

```bash
curl -fsS http://127.0.0.1:14396/health
```

电脑尚未连接时，`deviceOnline` 可以是 `false`。

### 4. 配置 Nginx 与 HTTPS

全局 npm 包和源码仓库都包含 Nginx 模板：

```bash
PKG_ROOT="$(npm root -g)/deskrelay"
sudo cp "$PKG_ROOT/deploy/nginx/deskrelay.conf.example" /etc/nginx/sites-available/deskrelay.conf
sudo editor /etc/nginx/sites-available/deskrelay.conf
```

不同发行版的 Nginx 配置目录不同，请按系统实际目录启用。

关键要求：

- `proxy_pass http://127.0.0.1:14396` 指向服务器本机 Relay；
- 由 Nginx/Caddy 终止 TLS；
- 不记录完整 URL 查询串；
- 上传上限覆盖移动端图片和消息；
- `proxy_read_timeout`、`proxy_send_timeout` 至少 `120s`；
- 云防火墙只开放 `80/443`，不开放 `14396`。

检查并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

公网验证：

```bash
curl -fsS https://relay.example.com/health
```

### 5. 让电脑主动连接 Relay

在启动 `deskrelay` 的环境中设置：

```bash
export DESKRELAY_RELAY_URL=https://relay.example.com
export DESKRELAY_RELAY_DEVICE_ID=deskrelay-device
export DESKRELAY_RELAY_DEVICE_TOKEN='与服务器相同的设备密钥'
deskrelay --adapter codex
```

建议把变量写入权限受限的 LaunchAgent/systemd 环境文件，而不是长期放在 shell 历史中。仓库中的 `.env.example` 仅供参考，不会自动加载。

连接后：

- 本地移动服务继续运行，可用于局域网直连；
- daemon 主动连接公网 Relay；
- 完成通知自动使用公网任务链接；
- 公网页面 API 通过请求队列交给电脑处理；
- 非 GET 操作使用命令 ID 和本地 journal 去重，网络重试不会重复发送同一任务；
- 电脑离线时页面显示“电脑当前离线”。

### 6. 完整验收

1. 公网 `/health` 返回 `ok: true`；
2. 电脑连接后 `deviceOnline: true`；
3. 外部网络能打开登录页；
4. 登录后能读取真实 Agent 列表、任务和最新消息；
5. 手机发送的内容出现在桌面端同一任务；
6. 审批、停止、排队编辑和删除可以同步；
7. 桌面完成后，手机网页和微信收到同一任务结果；
8. 停止电脑 daemon 后，公网网页明确显示离线且不会创建替代会话。

## 安全要求

1. **不直接发布本机端口。** 不使用通用隧道把 `127.0.0.1:4396` 暴露到公网。
2. **Relay 只监听服务器回环地址。** 公网只暴露 Nginx/Caddy 的 HTTPS 端口。
3. **分离两种凭据。** 设备密钥用于电脑与 Relay，移动密码用于浏览器登录。
4. **不记录敏感请求。** setup 参数、Cookie、任务正文、审批内容和附件都可能敏感。
5. **限制环境文件权限。** 服务器密钥文件使用 `0600`，不要写进 systemd unit 或进程参数。
6. **桌面端保持唯一 owner。** 不可用时明确报错，不自动启动隐藏 CLI/ACP 会话。
7. **定期升级。** 同时更新服务器和电脑上的 DeskRelay，并在升级后重启进程。
8. **发布前审计。** 运行 `npm run privacy:check`，公开仓库使用干净历史。

更多边界见 [安全策略](../../.github/SECURITY.md)。

## 常见故障

### 公网页面显示电脑离线

- 确认电脑上的 `deskrelay` 正在运行；
- 确认三个 `DESKRELAY_RELAY_*` 变量在 daemon 进程中生效；
- 确认服务器和电脑的设备 ID、设备密钥完全一致；
- 查看 `~/.deskrelay/bridge.log` 中的 `relay_client` 记录；
- 检查服务器 `/health` 的 `deviceOnline`。

### Relay 提示设备认证失败

服务器端 `DESKRELAY_RELAY_DEVICE_TOKEN` 与电脑端 `DESKRELAY_RELAY_DEVICE_TOKEN` 不一致。更新后分别重启 Relay 和 daemon。

### 公网页面能打开，但 API 超时

静态页面由 Relay 提供，任务数据必须由在线电脑返回。检查：

- 本机 `http://127.0.0.1:4396/health`；
- Relay 长轮询是否被代理提前断开；
- Nginx 超时是否至少 `120s`；
- 电脑是否进入睡眠；
- 服务器与电脑时钟是否严重偏差。

### 同一局域网没有自动切换到高速连接

公网模式仍可正常使用。局域网加速依赖手机和电脑公网出口一致、局域网地址可互访，以及浏览器允许从 HTTPS 访问局域网 HTTP；任一条件不满足时会保留公网连接。
