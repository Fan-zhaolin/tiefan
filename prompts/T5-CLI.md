# T5 · CLI（数据层入口）

先读：`AGENTS.md`、`docs/02-解析与交互.md` §12、`docs/03-架构与边界.md` §7

## 目标

一个零依赖的命令行工具。**只做 IO，逻辑全在 core。**

## 要做

### 1. 命令形态

```bash
meal "鸡胸200g 米饭一碗"          # 解析并记录
meal --dry "鸡胸200g"             # 只算，不写
meal today                        # 今天的记录
meal export                       # 全部导出为 JSONL
meal --json "鸡胸200g"            # 机器可读
```

`meal` 无参数时进入交互式：一行一行读 stdin，空行退出。

### 2. 输出格式（严格照 docs/02 §12）

```
$ meal "鸡胸200g 米饭一碗"
12:40  鸡胸 200g    330    P62 C0  F7
12:40  米饭 一碗    约175   P3  C39 F0
──────────────────────────────────
今天                约 505
```

**对齐规则：**

- 时间列宽 6（`HH:mm` + 两空格）
- 条目列宽 12（中文按 2 宽度计算）
- 份量列宽 8
- 热量列右对齐，宽 6
- 宏量列 `P{protein} C{carb} F{fat}`，各数字不留小数
- 有 `estimate` 的行，热量前加 `约`
- 分隔线长度 = 34 个 `─`
- 总计行：`今天` + 右对齐数字，`estimate` 时加 `约`

**不要用颜色、不要用 emoji、不要用表格库。** 自己算宽度。

### 3. 存储

```
~/.meal/2026-10-27.jsonl
{"t":"12:40","raw":"鸡胸200g 米饭一碗","kcal":505,"p":65,"c":39,"f":7,"src":"dish"}
```

- 路径可由 `MEAL_HOME` 环境变量覆盖
- 一行一条，追加写，不重写文件
- 文件不存在时自动创建

### 4. `export`

把 `~/.meal/*.jsonl` 全部 cat 到 stdout。**不排序、不改格式。**

### 5. 错误处理（永不报错）

| 情况 | 行为 |
|---|---|
| 解析不出任何食物 | 打印 `没认出是什么。原文：xxx` 并退出码 0 |
| `~/.meal` 不可写 | 打印 `记不下来，但算出来了：` + 结果，退出码 0 |
| 参数为空 | 进入交互式 |

**退出码永远是 0**，除非是参数错误（如未知子命令）。

### 6. `packages/cli/src/index.ts`

```ts
#!/usr/bin/env node
import { parseMeal } from '@meal/core'
import data from '@meal/data/dist/data.json'
```

**data 必须是构建时内联的 import，不是运行时读文件。**

## 不要做

- ❌ 不装 commander / yargs / chalk / ora
- ❌ 不做彩色输出
- ❌ 不做进度条、loading
- ❌ 不加 `--help` 之外的任何 flag 说明（README 里有）

## 验收

```bash
pnpm --filter @meal/cli build
node packages/cli/dist/index.js "鸡胸200g 米饭一碗"
# 输出格式与 docs/02 §12 完全一致（含对齐）

MEAL_HOME=/tmp/mealtest node packages/cli/dist/index.js "鸡蛋2个"
ls /tmp/mealtest/          # 有 YYYY-MM-DD.jsonl
cat /tmp/mealtest/*.jsonl  # 格式正确

node packages/cli/dist/index.js ""        # 不报错，退出码 0
node packages/cli/dist/index.js "！！！"   # 不报错，退出码 0
```

## 中文字宽提醒

`「鸡胸」` 在终端占 4 列，不是 2。对齐必须按显示宽度算，否则表格会歪。

用 `charCodeAt > 0x2E80` 判断宽字符，每字符算 2。
