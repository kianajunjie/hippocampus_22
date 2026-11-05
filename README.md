# hippocampus_22

**陪伴型机器人的情感记忆层** —— 让她记得、会忘，还敢说"我记不太清了"。

[![CI](https://github.com/kianajunjie/hippocampus_22/actions/workflows/ci.yml/badge.svg)](https://github.com/kianajunjie/hippocampus_22/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg)](package.json)
[![zero deps](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

不是把聊天存进数据库，是照着人脑海马体的五个环节做记忆：**事件编码 → 巩固 → 遗忘 →
联想召回 → 元记忆**。一个本地 SQLite 文件就是全部记忆，不上传、不联网、不用向量库。

> 本项目派生自 [dsh-hippocampus](https://github.com/kianajunjie/dsh-hippocampus) v0.3.1（MIT），
> 在保留记忆内核的基础上继续演进；派生与署名说明见 [NOTICE](NOTICE)。

---

## 快速开始

**不需要 API Key，先看效果：**

```bash
git clone https://github.com/kianajunjie/hippocampus_22.git
cd hippocampus_22
node cli.mjs demo
```

`demo` 会塞几条带情绪的旧事件，跑一次遗忘，再召回一次，直接看到"情绪权重让旧记忆活得更久"。

**作为库：**

```bash
npm i hippocampus-22
```

```js
import { createHippocampus } from 'hippocampus-22'

const hip = await createHippocampus({ apiKey: process.env.DEEPSEEK_API_KEY })

// 每条消息进来都走一遍：认人 → 组装提示词块 → 召回
const r = await hip.handleTurn({ channel: 'qq', externalId: msg.user_id, text, reply })
// r.context 塞进系统提示，r.recall 是召回结果

// 每天一次巩固：合并近重复、按情绪衰减、写一句印象
await hip.replay()
```

**作为 HTTP 服务（任何语言都能接）：**

```js
import { createMemoryServer } from 'hippocampus-22/http'
await createMemoryServer({ hip, port: 7717, token: 'secret' })
```

```bash
curl -s localhost:7717/context -H 'authorization: Bearer secret' \
  -H 'content-type: application/json' \
  -d '{"channel":"telegram","externalId":"42","text":"我腿疼"}'
```

**作为 DSH 插件（im / 网页）：**

```bash
dsh plugin --profile web add github:kianajunjie/hippocampus_22
```

---

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 事件记忆 | 每轮对话变成「谁、何时、发生了什么、什么情绪」 |
| 情绪加权遗忘 | 被凶/被感动的那天能撑几个月，普通的一天很快淡掉 |
| 确定度 | 每条记忆带「记得清 / 大概记得 / 只记得有这回事」，她不会装确定 |
| 改口即失效 | 你改主意了（住成都 → 住杭州），旧事实自动作废，不自相矛盾 |
| 关系层 | 跟每个人的亲密、信任、没解开的疙瘩，久不出现会淡，原谅了才解开 |
| 事实 / 章节 / 技能 / 缺口 | 住哪、哪阵子、怎么做事、什么不懂（不懂就主动问） |
| 按人隔离 | A 看不到 B 的记忆，群聊看不到私聊 |
| 零依赖 | 只用 Node 内置 SQLite（`node:sqlite`），不装任何第三方包 |

## 命令一览

```text
hippo encode --turns <file.json>   # 把对话批量编码成事件
hippo replay                       # 巩固：合并 + 情绪衰减
hippo recall "腿疼"                # 召回（带确定度）
hippo context --subject 主人 "..."  # 直接看这一轮会塞进提示词的块
hippo remember "…" --pin           # 主动记一条，--pin 永不衰减
hippo list 20 | audit | stats       # 看记忆 / 看作废记录 / 看统计
hippo rel 主人 | rel-shift 主人 intimacy:1 why:吵架
hippo fact-add 主人 住在 杭州 | facts 主人
hippo demo                          # 零依赖演示
```

完整说明见 [docs/cli.md](docs/cli.md)，接入方式见 [docs/integration.md](docs/integration.md)。

## 记忆是怎么转的

```
QQ 桥 / im / 网页 / 其他软件
            │
     identities 表（同一人 = 一个 subject）
            │
   handleTurn()：认人 → 组装 context → 召回
            │
 events  relations  facts  chapters  skills / gaps
 事件     关系      事实    章节      技能 / 缺口
            │
      context() → 系统提示词块
```

细节见 [docs/architecture.md](docs/architecture.md)，设计取舍见 [docs/design-notes.md](docs/design-notes.md)，
实测数据见 [docs/bench.md](docs/bench.md)。

## 目录结构

```text
hippocampus_22/
├── cli.mjs                 命令行入口
├── index.mjs               库 / DSH 插件双入口
├── src/
│   ├── index.mjs           记忆内核门面：handleTurn / recall / replay …
│   ├── store.mjs           SQLite 打开、建表、日期差
│   ├── encode.mjs          事件编码（LLM 抽取）
│   ├── replay.mjs          巩固：合并近重复 + 情绪加权衰减
│   ├── recall.mjs          召回：词面匹配 + 图扩散 + 确定度
│   ├── layers.mjs          关系 / 事实 / 章节 / 技能 / 缺口
│   ├── identity.mjs        跨渠道身份映射
│   ├── adapters/           DSH 插件壳 + HTTP 适配器
│   ├── health.mjs          记忆体检测（v0.2.0）
│   ├── port.mjs            记忆导入导出（v0.2.0）
│   ├── report.mjs          人读档案导出（v0.2.0）
│   └── forget.mjs          条件遗忘（v0.2.0）
├── test/                   node:test 单测
├── docs/                   架构、设计、接入、命令、实测
└── bench/                  召回率压测脚本与历史结果
```

## 路线图

- [x] 事件编码 + 情绪加权遗忘 + 确定度召回（v0.1.0，继承内核）
- [x] 记忆体检测 `health`、导入导出 `port`、人读档案 `report`、条件遗忘 `forget`（v0.2.0）
- [ ] 记忆可视化面板（把 events / 边 / 关系画成一张图）
- [ ] 多设备同步（不引入中心服务，用文件加密同步）

## 参与贡献

欢迎提 Issue 和 PR，流程见 [CONTRIBUTING.md](CONTRIBUTING.md)；
提交信息用 Conventional Commits，分支用 `feat/`、`fix/`、`docs/`、`chore/` 前缀。

## 许可证

[MIT](LICENSE)。派生自 dsh-hippocampus（MIT），再分发请保留 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
