# 命令行参考

安装后有两个等价的可执行名：`hippo` 与 `hippocampus-22`（源码目录里也直接
`node cli.mjs <命令>`）。所有命令都支持 `--db <path>` 指定记忆文件，默认 `.hippocampus/memory.db`。

```bash
hippo <命令> [位置参数...] [--选项 值...]
```

## 记忆写入

| 命令 | 作用 | 例子 |
| --- | --- | --- |
| `encode --turns <file>` | 把一批对话编码成事件（需要模型） | `hippo encode --turns examples/turns.json` |
| `remember "…"` | 记一条（不需要模型） | `hippo remember "她怕黑" --subject 主人 --pin --affect -1` |
| `fact-add <人> <关系> <值>` | 写一条时序事实，旧值自动作废 | `hippo fact-add 主人 住在 杭州` |
| `chapter-add <起> <止> <标题> <摘要>` | 记一段"那阵子" | `hippo chapter-add 2026-10 2026-11 开学 认识了一群人` |
| `skill-add <名> <关键词> <步骤>` | 记一门会做的事 | `hippo skill-add 剪视频 "剪,视频" "去静音+whisper"` |
| `gap-add <词> <备注>` | 记一个不懂的词，下次主动问 | `hippo gap-add quokkacore 群友提过` |

## 记忆读取

| 命令 | 作用 |
| --- | --- |
| `recall "…"` | 召回相关记忆，带确定度 |
| `context [--subject 主人] "…"` | 直接打印这一轮会塞进系统提示的块 |
| `list [n]` | 最近/最强的 n 条记忆（含置顶标记） |
| `facts <人>` | 当前有效的时序事实 |
| `chapter` | 最近一段章节 |
| `gaps` | 还没搞懂的词 |
| `rel <人>` | 关系快照（亲密/信任/疙瘩） |
| `stats` | 条目数与平均强度 |
| `audit` | 被作废的条目（查"这条怎么没了"） |

## 巩固与维护

| 命令 | 作用 |
| --- | --- |
| `replay` | 巩固：合并近重复 + 情绪加权衰减 |
| `demo` | 零依赖演示：塞事件 → 衰减 → 召回 |
| `health` | 记忆体检测（v0.2.0 起） |
| `report` | 导出人读记忆档案 Markdown（v0.2.0 起） |
| `export --out <file>` | 整库导出 JSON（v0.2.0 起） |
| `import --in <file>` | 导入 JSON，`--mode merge\|replace`（v0.2.0 起） |
| `forget --topic <t>` | 条件遗忘，`--dry-run` 先看再删（v0.2.0 起） |

## 全局选项

| 选项 | 说明 |
| --- | --- |
| `--db <path>` | 记忆文件路径 |
| `--api-key <key>` | 模型密钥（默认读 `DEEPSEEK_API_KEY`） |
| `--model <name>` | 模型名，默认 `deepseek-flash` |
| `--base-url <url>` | OpenAI 兼容网关地址 |
| `--lang zh\|en` | 输出与确定度用中文还是英文 |
| `--subject <人>` | 这条命令作用于谁 |

## 例子：从零到一次召回

```bash
node cli.mjs demo                     # 塞三条带情绪的旧事件，跑一次巩固
node cli.mjs recall "腿疼"             # 看她召回了什么、有多确定
node cli.mjs stats                    # 条目数与平均强度
node cli.mjs health                   # 这份记忆健康不健康
```
