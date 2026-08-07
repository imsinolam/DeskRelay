# DeskRelay 文档

文档按读者和用途分层，避免所有说明堆在同一级目录。

## 了解产品

- [项目定位](concepts/about.md)：DeskRelay 是什么、不是什么。
- [架构与数据流](concepts/architecture.md)：真实 Agent、Runtime、微信、局域网网页和公网 Relay 的关系。

## 安装与使用

- [Agent 安装与配置](guides/agent-setup.md)：各 Agent 的前置条件、连接方式和能力边界。
- [运行配置](guides/configuration.md)：环境变量、数据目录和 2.0 迁移。
- [移动网页与公网访问](guides/remote-access.md)：局域网模式、自建 Relay、公网安全边界。
- [问题排查](guides/troubleshooting.md)：命令、连接、PTY、状态文件和网络问题。

## 维护与发布

- [开发与测试](maintainers/development.md)：源码入口、质量门禁和本地开发。
- [对外发布](maintainers/publishing.md)：隐私审计、干净历史、GitHub 与 npm 发布。
- [网站文案](maintainers/website-copy-cn.md)：对外介绍素材。
- [版本说明](releases/README.md)：发布记录。

## 安全与协作

- [安全策略](../.github/SECURITY.md)
- [贡献指南](../.github/CONTRIBUTING.md)
- [行为准则](../.github/CODE_OF_CONDUCT.md)
