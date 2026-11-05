# 参与贡献

谢谢你来。这个项目的目的很朴素：让陪伴型机器人**记住该记住的，忘掉该忘掉的**。
下面是最小必要流程，不搞形式主义。

## 1. 环境

- Node.js ≥ 22.5（用到内置 `node:sqlite`）
- 没有任何第三方依赖，`npm i` 只是为了装开发脚本

```bash
git clone https://github.com/kianajunjie/hippocampus_22.git
cd hippocampus_22
node cli.mjs demo        # 先跑一遍看效果，不需要 API Key
node --test test/        # 跑全部单测
```

## 2. 分支约定

| 前缀 | 用途 | 例 |
| --- | --- | --- |
| `feat/` | 新功能 | `feat/health-report` |
| `fix/` | 修 bug | `fix/list-count` |
| `docs/` | 只改文档 | `docs/repo-scaffold` |
| `chore/` | 构建、依赖、工程化 | `chore/ci-node-24` |

一个分支只做一件事；从 `main` 切出，合并前先把 `main` 合进来避免积压。

## 3. 提交信息（Conventional Commits）

```
<type>(<scope>): <一句话总结>

<为什么这么改；不写"改了什么"，diff 里已经有了>
```

例：

```
feat(cli): 新增 health 子命令

记忆越来越长以后看不出健康状况，先给一个能一眼看懂的体检入口，
先做 CLI，面板留给后面的版本。
```

## 4. 提交前检查

```bash
node --test test/         # 必须全绿
node cli.mjs demo         # 交互行为没坏
```

新增功能请**同时加测试**：测试放在 `test/<模块>.test.mjs`，用 `node:test` +
`node:assert/strict`，不引入第三方断言库；数据库一律用 `fs.mkdtempSync` 建临时文件，
不要写进仓库目录。

## 5. Pull Request

- 标题与提交信息同格式；
- 描述里写清：为什么做、怎么验证、有没有破坏兼容（记忆文件是否要迁移）；
- 关联 issue：`Closes #12`；
- CI 绿了再请求评审；评审意见用"建议/必须"标注清楚。

## 6. Issue

- Bug：贴 `node -v`、操作系统、最小复现命令、期望与实际；
- 功能：先说你**想解决什么问题**，再谈实现方案；
- 提问：先搜一下已有 issue 和 `docs/`。

## 7. 发布

维护者负责：更新 `CHANGELOG.md` → `package.json` 提版本 → 打 `vX.Y.Z` 标签 →
在 GitHub Releases 里写清"这次多了什么、要不要迁移"。版本号遵循语义化版本。

## 8. 行为准则

技术讨论对事不对人；不接受人身攻击、骚扰、泄露他人隐私（尤其是**记忆库里别人的真实对话**）。
违反者会被移出讨论。
