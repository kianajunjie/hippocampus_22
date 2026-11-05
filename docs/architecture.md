# 架构

hippocampus_22 只做一件事：**把"陪一个人聊久了"这件事拆成可计算的环节**。
整层没有服务端、没有第三方依赖，运行时只需要 Node ≥ 22.5（内置 `node:sqlite`）。

## 1. 分层

```
┌──────────────────────────────────────────────────────────────┐
│ 接入层  adapters/                                            │
│   dsh.mjs  （DSH 插件壳：systemPrompt / tools / 定时巩固）      │
│   http.mjs （HTTP 适配器：/context /recall /remember，带 token）│
│   cli.mjs  （命令行：编码、巩固、召回、体检、导入导出）          │
├──────────────────────────────────────────────────────────────┤
│ 门面层  src/index.mjs  createHippocampus()                    │
│   handleTurn / recall / recallDeep / remember / replay / …     │
├──────────────────────────────────────────────────────────────┤
│ 记忆环节                                                     │
│   encode.mjs  事件编码     replay.mjs  巩固与衰减              │
│   recall.mjs  召回与确定度  layers.mjs  关系/事实/章节/技能/缺口 │
│   identity.mjs 跨渠道身份   expand.mjs  查询改写               │
├──────────────────────────────────────────────────────────────┤
│ 存储层  store.mjs  node:sqlite，单文件 memory.db              │
└──────────────────────────────────────────────────────────────┘
```

接进来的渠道（QQ 桥、im、网页、Telegram、一条 curl）只跟门面打交道，
记忆内核不 import 任何宿主 API —— 所以库能在 DSH 之外独立跑。

## 2. 数据模型

一个 SQLite 文件里有 8 张表，五层记忆共用同一份"人"：

| 表 | 含义 | 关键列 |
| --- | --- | --- |
| `events` | 事件记忆 | `day, who, topic, what, detail, affect, strength, pinned, superseded, subject` |
| `edges` | 联想边（事件之间） | `a, b, w` |
| `identities` | 渠道身份映射 | `channel, external_id, subject` |
| `relations` | 关系层 | `subject, trust, intimacy, unresolved, last_shift` |
| `facts` | 时序事实 | `subject, relation, object, valid_from, valid_to` |
| `chapters` | 人生章节 | `period_from, period_to, title, summary` |
| `skills` | 程序性记忆 | `name, keywords, steps, uses` |
| `gaps` | 元记忆缺口 | `term, note, asked` |

`events.subject` 就是隔离键：召回时只取 `subject = '' or subject = ?`，
所以群聊里 A 的记忆不会出现在 B 的提示词里。

## 3. 三条主流程

### 3.1 写入：`handleTurn()`

```
渠道消息 → resolveIdentity(channel, externalId)
        → context({subject, text})        组装提示词块
        → recall(text, {subject})         召回相关记忆（带确定度）
        → addEvent(...) + relation(delta) 落库，并轻微推动关系值
```

关系增量的启发式在 `src/turn.mjs`：吵架记一个疙瘩、道歉解一个、夸她加信任，
其余情况只加一点点亲密。**不调用 LLM**，所以每轮的成本是零。

### 3.2 巩固：`replay()`

每天一次（DSH 插件里是 24 小时的 `setInterval`，命令行是手动触发）：

1. 按 `who|topic` 分组，**7 天窗口内**的近似重复合并（二元组相似度 ≥ 0.5）；
2. 说法不一致的旧条目置 `superseded = 1` —— 人改主意了，别自相矛盾；
3. 未置顶、未作废的事件按天衰减：`strength ← max(floor, strength * 0.95^(age / τ))`，
   其中 `τ = 1 + |affect| * 2`，情绪越强 τ 越大，衰减越慢。

这就是"被凶那天能撑七个月，普通的一天一个半月就没了"的来源：**不是随机遗忘**。

### 3.3 召回：`recall()` / `recallDeep()`

- 词面层：中文取 2~4 字片段、英文取整词，命中数 × 权重排序，另加单字弱线索；
- 图扩散：命中事件挂着的 `edges` 上再走 `hop` 步（默认 2），带回关联记忆；
- 语义层（可选）：注入 `embedder` 走余弦相似度；没有 embedder 但有 LLM 时，
  把问题改写成几种"可能记得的说法"再召回一次；
- 确定度：`age ≤ clearDays` → 记得清，`≤ vagueDays` → 大概记得，否则 → 只记得有这回事。

## 4. 扩展点

| 想做的事 | 挂在哪里 |
| --- | --- |
| 换模型 / 换 base URL | `createHippocampus({ model, baseUrl, apiKey })`，或自己传 `llm` 函数 |
| 接新渠道 | 实现"取消息 → `handleTurn()` → 回消息"三步即可，仓库里有 HTTP 与 DSH 两个样例 |
| 加记忆层 | 在 `layers.mjs` 里加表 + 读写函数，并在 `contextBlock()` 里决定插到提示词哪一段 |
| 加命令行子命令 | `cli.mjs` 的分发链，一条 `else if` 一段 |
| 换默认衰减曲线 | `config.mjs` 的 `decay` 段（`base / emotionBoost / floor / mergeCap / mergeWindowDays`） |

## 5. 失败姿态

插件壳（`adapters/dsh.mjs`）对宿主能力全部做了防御：`systemPrompt` / `tools` 缺了
就记一行日志继续跑，**不会把宿主拖死**；宿主没有的字段一律可选链读取。
