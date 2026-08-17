# Release notes

- [2.1.2](2.1.2.md) / [中文说明](2.1.2_CN.md)
- [2.1.1](2.1.1.md) / [中文说明](2.1.1_CN.md)
- [2.1.0](2.1.0.md) / [中文说明](2.1.0_CN.md)
- [2.0.1](2.0.1.md) / [中文说明](2.0.1_CN.md)
- [2.0.0](2.0.0.md) / [中文说明](2.0.0_CN.md)

DeskRelay 2.0 is the first public baseline with one unified brand, npm package, CLI namespace, environment-variable namespace, and active data directory. Historical 1.x notes are not rewritten in the public snapshot because doing so would falsely imply that those releases already used the new names.

## Writing a new release

- 中文说明是面向用户的主版本记录，使用 [TEMPLATE_CN.md](TEMPLATE_CN.md)。
- 只描述用户能感知的变化、需要执行的升级操作和已知限制。
- 内部类名、字段、文件路径、提交 SHA、测试命令和架构细节放在发布验收报告，不放在版本说明中。
- 只有本次唯一的发布 Agent 可以新增正式版本说明、更新版本索引和版本号；普通开发 Agent 只提交自己的功能改动。
- 英文说明应忠实翻译已经确认的中文用户说明，不另行增加未经验证的技术结论。
