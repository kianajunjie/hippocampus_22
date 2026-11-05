# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)，
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [未发布]

### 计划中
- 记忆可视化面板：把事件、联想边、关系值画成一张图
- 多设备同步：不引入中心服务，用文件加密同步

## [0.2.0] - 2026-11-05

### 新增
- `health`：记忆体检测，一眼看出总条目、活跃/作废/置顶、快遗忘的条目与关系疙瘩，
  给出 `healthy / tired / starving` 三档结论
- `port`：整库导出为 JSON（`exportState`）并按 `merge` / `replace` 两种模式导入
  （`importState`），导入时自动重映射事件 id，联想边不会串
- `report`：导出人读的 Markdown 记忆档案（关系、事实、章节、最近事件、缺口）
- `forget`：按 `id` / `topic` / `subject` / `olderThan` 条件遗忘，支持 `--dry-run` 与硬删除
- 以上四项都提供命令行子命令与单测

### 修复
- `list` 忽略位置参数：`hippo list 20` 之前永远按默认条数输出

### 文档
- 重写 README：徽章、五种接入方式、核心能力表、命令一览、路线图
- 新增 `docs/architecture.md`、`docs/design-notes.md`、`docs/cli.md`
- 新增 `CONTRIBUTING.md`、Issue / PR 模板、GitHub Actions 测试工作流

## [0.1.0] - 2026-11-05

### 新增
- 从 dsh-hippocampus v0.3.1 派生，保留记忆内核：事件编码、情绪加权遗忘、
  联想召回、确定度、关系层、事实/章节/技能/缺口、按人隔离、零依赖
- 包名改为 `hippocampus-22`，补 `NOTICE` 说明派生关系，继续使用 MIT 许可

[未发布]: https://github.com/kianajunjie/hippocampus_22/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/kianajunjie/hippocampus_22/releases/tag/v0.2.0
[0.1.0]: https://github.com/kianajunjie/hippocampus_22/releases/tag/v0.1.0
