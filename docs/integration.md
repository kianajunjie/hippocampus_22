# 接入任意通道

记忆核心不关心消息从哪来。三种接入方式，同一份记忆。

```
         QQ 桥        DSH（im / 网页）        别的软件
            │                │                   │
         直接调库        插件自动注入         HTTP 小接口
            └────────────────┴───────────────────┘
                          ↓
                   identities 表（同一个人 = 一个 subject）
                          ↓
                      记忆库
```

---

## 一、先定身份：同一个人只有一个记忆

一个 QQ 号、一个 im 用户、一个网页会话，可能是同一个人。

```js
hip.bindIdentity('qq', '3475932219', '主人')
hip.bindIdentity('im', 'user-abc',   '主人')
hip.bindIdentity('web', 'session-xyz','主人')

hip.resolveIdentity('qq', '3475932219')   // → '主人'
```

**没绑过的陌生人不会共用记忆**，会各自拿到独立 subject：

```js
hip.resolveIdentity('qq', '999')   // → 'qq:999'
```

这样群里新来的人不会看到别人的事。

---

## 二、方式 A：直接调库（自己写机器人）

```js
import { createHippocampus } from 'dsh-hippocampus'

const hip = await createHippocampus({ db: './memory.db', apiKey: process.env.DEEPSEEK_API_KEY })

// 每条消息
const r = await hip.handleTurn({
  channel: 'qq',
  externalId: msg.user_id,
  text: msg.text,
  reply: 她的回复,
})

// r.context  → 塞进系统提示的块
// r.recall   → 召回的事件（带确定度）
// r.subject  → 这次算在谁头上
```

`handleTurn` 会在内部做完：解析身份 → 组装 context → 召回 → 记事件 → 调关系。

---

## 三、方式 B：HTTP 小接口（任何语言）

```js
import { createHippocampus } from 'dsh-hippocampus'
import { createMemoryServer } from 'dsh-hippocampus/http'

const hip = await createHippocampus({ db: './memory.db' })
const srv = await createMemoryServer({ hip, port: 7717, token: 'secret' })
```

然后别的程序（Python、Go、Node、n8n、甚至 curl）：

```bash
curl -s localhost:7717/context \
  -H 'authorization: Bearer secret' \
  -H 'content-type: application/json' \
  -d '{"channel":"telegram","externalId":"42","text":"我腿疼"}'
# → {"subject":"telegram:42","block":"【关系】…\n【记忆里的事】…"}

curl -s localhost:7717/turn -H 'authorization: Bearer secret' \
  -H 'content-type: application/json' \
  -d '{"channel":"telegram","externalId":"42","text":"腿好酸","reply":"昨天骑车累的"}'
```

接口一览：

| 路径 | 作用 |
|---|---|
| `POST /turn` | 一条完整对话（解析身份 + 组装 + 记录） |
| `POST /context` | 只要提示词块 |
| `POST /recall` | 只要召回结果 |
| `POST /remember` | 让她记一条（可 pin） |
| `POST /fact` | 记一个长期事实 |
| `GET /health` | 健康检查 + 统计 |

---

## 四、方式 C：DSH 插件（im / 网页 / 任何 DSH 会话）

```bash
dsh plugin --profile web add github:kianajunjie/dsh-hippocampus
```

装上之后插件会：

| 连接点 | 做什么 |
|---|---|
| `ctx.systemPrompt.section` | 每轮把记忆块塞进系统提示 |
| `ctx.tools.register` | 给她 `memory_recall` / `memory_remember` 两个工具 |
| `ctx.on('session/event')` | 记下聊过的回合、调整关系 |
| `ctx.provide('hippocampus')` | 别的插件也能读记忆 |
| `ctx.effect` + 定时器 | 每天巩固一次 |

**注意**：插件壳对宿主 API 是防御式写法——服务缺失时只记日志、不崩宿主。
如果某个 DSH 版本接口变了，最坏情况是"注入了但没生效"，不会把主程序带崩。

---

## 五、混着用

三种方式可以同时开，因为写的是同一个 SQLite 文件：

```
QQ 桥  → 直接调库
网页   → DSH 插件
手表   → HTTP 接口
```

前提是**同一个 db 路径**，并且身份对齐：

```js
hip.bindIdentity('qq', '3475932219', '主人')
hip.bindIdentity('web', 'sess-1',   '主人')
```

---

## 六、两个坑

**① 并发写**
SQLite 单文件，多进程写会 `database is locked`。三种接入建议：**只让一个进程写**，其他进程读（`PRAGMA journal_mode=WAL` 能缓解，但不能根治）。

**② 身份绑定顺序**
先 `bindIdentity` 再让消息进来。否则陌生人会先拿到 `channel:id` 的独立 subject，后面再绑就是两本账（可以把两本合并，但要手动迁）。

```js
// 收到未知 QQ 号时：先问主人"这是谁"，再绑
```
