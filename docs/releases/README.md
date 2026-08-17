# Release notes

- [0.2.0](0.2.0.md) / [中文说明](0.2.0_CN.md)

> 版本说明：在正式版确定之前，DeskRelay 使用 `0.x.x` 版本号。历史 `2.x` 条目是早期预览编号，保留用于追溯，不代表正式稳定版本。

- [2.1.4](2.1.4.md) / [中文说明](2.1.4_CN.md)

- [2.1.3](2.1.3.md) / [中文说明](2.1.3_CN.md)
- [2.1.2](2.1.2.md) / [中文说明](2.1.2_CN.md)
- [2.1.1](2.1.1.md) / [中文说明](2.1.1_CN.md)
- [2.1.0](2.1.0.md) / [中文说明](2.1.0_CN.md)
- [2.0.1](2.0.1.md) / [中文说明](2.0.1_CN.md)
- [2.0.0](2.0.0.md) / [中文说明](2.0.0_CN.md)

Historical `2.x` entries document the early public-preview work that unified the DeskRelay brand, package, command namespace, environment variables, and active data directory. That numbering is now retired: until a stable release is explicitly declared, new releases use the `0.x.x` series. Historical notes remain unchanged so the record stays accurate.

## Writing a new release

- 中文说明是面向用户的主版本记录，使用 [TEMPLATE_CN.md](TEMPLATE_CN.md)。
- 只描述用户能感知的变化、需要执行的升级操作和已知限制。
- 内部类名、字段、文件路径、提交 SHA、测试命令和架构细节放在发布验收报告，不放在版本说明中。
- 只有本次唯一的发布 Agent 可以新增正式版本说明、更新版本索引和版本号；普通开发 Agent 只提交自己的功能改动。
- 英文说明应忠实翻译已经确认的中文用户说明，不另行增加未经验证的技术结论。
