---
name: 飞书集成
description: >
  飞书消息、日历、审批、通讯录、多维表格。
  Feishu (Lark) platform integration. Send messages, manage calendar events,
  query contacts, create approvals, and operate bitable records.
  Use when the user asks about schedules, meetings, colleagues, approvals,
  or wants to send messages via Feishu. Triggers on: 飞书, 日程, 日历,
  会议, 审批, 通讯录, 多维表格, 发消息, schedule, calendar, approval, feishu, lark.
---

# 飞书集成 — 五域协议

消息 + 日历 + 通讯录 + 审批 + 多维表格。自然语言 → 意图分类 → 参数提取 → API 调用 → 结构化输出。

## 执行流程

```
用户查询
    ↓
[Phase 1] 意图分类 → 确定域 & 子命令
    ↓
[Phase 2] 参数提取 → 解析人名/日期/表单
    ↓
[Phase 3] 脚本调用 → feishu-api.mjs <command> [options]
    ↓
[Phase 4] 结果格式化 → 自然语言输出
    ↓
[Phase 5] 交互卡片（可选）→ 飞书 Bot 富文本回复
```

---

## Phase 1: 意图分类

收到请求后，**先判断所属域**，匹配子命令。不要问用户选哪个域。

| 意图 | 识别信号 | 子命令前缀 |
|------|---------|-----------|
| **消息** | "发消息给X"、"通知X"、"告诉X" | send-text, send-card, reply |
| **日历** | "日程"、"日历"、"会议"、"空闲"、"明天安排" | calendar-list, create-event, freebusy, list-rooms |
| **通讯录** | "找人"、"谁是"、"X的联系方式"、"部门" | contact-search, department-list |
| **审批** | "审批"、"请假"、"报销"、"申请" | approval-create, approval-get, approval-list |
| **多维表格** | "表格"、"记录"、"数据"、"bitable" | bitable-query, bitable-add, bitable-update |

**判断规则**：
1. 扫描信号词，优先匹配最具体的域
2. 涉及人名但无明确域 → 先归类为通讯录（解析 open_id），再执行目标操作
3. 无法判断 → 询问用户意图

---

## Phase 2: 参数提取

从自然语言中提取结构化参数。

### 日期时间解析

所有日期时间使用 **ISO 8601 + 时区 `+08:00`**（中国标准时间）。

| 用户表达 | 解析结果 |
|---------|---------|
| "明天下午3点" | `2026-02-27T15:00:00+08:00` |
| "下周一上午10点" | 计算到下周一，`T10:00:00+08:00` |
| "今天" | `{today}T00:00:00+08:00` ~ `{today}T23:59:59+08:00` |
| "后天下午2点到4点" | start: `T14:00:00+08:00`, end: `T16:00:00+08:00` |

### 人名解析

当用户提到人名时，**必须先通过 `contact-search` 解析为 `open_id`**，再执行后续操作。

```
用户: "发消息给张帆"
  → contact-search --query "张帆"
  → 获取 open_id: ou_xxxx
  → send-text --to ou_xxxx --text "..."
```

### 审批表单

识别审批类型 + 提取表单字段：
- "请假3天" → `approval-create --code LEAVE --form '{"days":3,"reason":"..."}'`
- "报销500元" → `approval-create --code EXPENSE --form '{"amount":500,"type":"..."}'`

---

## Phase 3: 脚本调用

```bash
node {skillDir}/scripts/feishu-api.mjs <command> [options]
```

### 消息命令

| 命令 | 参数 | 说明 |
|------|------|------|
| `send-text` | `--to <id> [--id-type open_id\|chat_id] --text "内容"` | 发送文本消息 |
| `send-card` | `--to <id> [--id-type open_id\|chat_id] --card '<JSON>'` | 发送交互卡片 |
| `reply` | `--message-id <om_xxx> --text "内容"` | 回复指定消息 |

- `--id-type` 默认 `open_id`（个人 `ou_xxx`）；群聊用 `chat_id`（`oc_xxx`）

### 日历命令

| 命令 | 参数 | 说明 |
|------|------|------|
| `calendar-list` | `[--user <open_id>] --start <ISO> --end <ISO>` | 查询日程列表 |
| `create-event` | `--summary "标题" --start <ISO> --end <ISO> [--attendees <id1,id2>] [--room <room_id>] [--description "描述"]` | 创建日程 |
| `freebusy` | `--users <id1,id2> --start <ISO> --end <ISO>` | 查忙闲状态 |
| `list-rooms` | （无参数） | 列出可用会议室 |

### 通讯录命令

| 命令 | 参数 | 说明 |
|------|------|------|
| `contact-search` | `--query "姓名或邮箱"` | 搜索用户，返回 open_id + 部门 |
| `department-list` | `[--parent <dept_id>]` | 部门树（不传则根部门） |

### 审批命令

| 命令 | 参数 | 说明 |
|------|------|------|
| `approval-create` | `--code <APPROVAL_CODE> --user <open_id> --form '<JSON>'` | 发起审批 |
| `approval-get` | `--instance <INSTANCE_CODE>` | 查询审批详情 |
| `approval-list` | `--user <open_id> [--status PENDING\|APPROVED\|REJECTED]` | 审批列表 |

### 多维表格命令

| 命令 | 参数 | 说明 |
|------|------|------|
| `bitable-query` | `--app <APP_TOKEN> --table <TABLE_ID> [--filter '<JSON>'] [--page-size 20]` | 查询记录 |
| `bitable-add` | `--app <APP_TOKEN> --table <TABLE_ID> --records '<JSON array>'` | 添加记录 |
| `bitable-update` | `--app <APP_TOKEN> --table <TABLE_ID> --record <RECORD_ID> --fields '<JSON>'` | 更新记录 |

---

## Phase 4: 结果格式化

脚本输出 JSON 到 stdout，Agent 转换为自然语言。

### 按域格式化

| 域 | 格式 |
|-----|------|
| **日历** | 时间线排列：`🕐 09:00-10:00 产品评审 (会议室A)` |
| **通讯录** | 卡片式：姓名、部门、邮箱、手机 |
| **审批** | 状态流：`📋 请假申请 → 待审批(李明) → ...` |
| **多维表格** | 表格式展示，大数据集取前 10 条 + 总数 |
| **消息** | 确认发送结果：`✅ 已发送给 张帆` |

### 错误处理

脚本错误输出 JSON: `{"error": "code", "message": "..."}`

| 错误 | 处理 |
|------|------|
| `invalid_token` | 令牌刷新失败，提示检查管理后台「系统设置」中飞书凭证 |
| `permission_denied` (403) | 权限不足，提示管理员在飞书开放平台添加对应权限范围 |
| `rate_limit` (429) | 等待 `retry-after` 秒后重试一次 |
| 网络超时 | 重试一次，仍失败则报告网络异常 |
| 用户搜索无结果 | 提示确认姓名拼写或尝试邮箱搜索 |

---

## Phase 5: 交互卡片（可选）

通过飞书 Bot 回复时，可生成交互卡片 JSON 实现富文本展示。

卡片模板参考 `references/card-templates.md`，常用场景：
- **日程提醒卡片**：时间 + 地点 + 参会人 + 一键接受/拒绝
- **审批通知卡片**：申请人 + 类型 + 摘要 + 审批/驳回按钮
- **搜索结果卡片**：联系人信息 + 一键发消息

---

## 环境变量

| 变量 | 说明 | 来源 |
|------|------|------|
| `FEISHU_APP_ID` | 飞书应用 App ID | 网关 `GET /api/agent/config` 下发 |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret | 网关 `GET /api/agent/config` 下发 |

脚本内部自动管理 `tenant_access_token` 的获取与刷新，无需额外配置。

---

## 关键约束

- **时区**：所有日期时间必须带时区 `+08:00`，禁止使用 UTC 或无时区格式
- **用户标识**：`open_id` 格式 `ou_xxx`（个人），`chat_id` 格式 `oc_xxx`（群聊）
- **人名 → ID**：提到人名时**必须**先 `contact-search` 解析为 `open_id`，禁止猜测 ID
- **卡片 JSON**：`send-card` 的 `--card` 参数需转义内部引号或使用单引号包裹
- **详细 API 参考**：`references/api-endpoints.md`

---

## 快速参考

| 场景 | 命令 |
|------|------|
| 查明天日程 | `feishu-api.mjs calendar-list --start 2026-02-27T00:00:00+08:00 --end 2026-02-27T23:59:59+08:00` |
| 创建会议 | `feishu-api.mjs create-event --summary "周会" --start 2026-02-27T14:00:00+08:00 --end 2026-02-27T15:00:00+08:00 --attendees ou_a,ou_b` |
| 查空闲 | `feishu-api.mjs freebusy --users ou_a,ou_b --start 2026-02-27T09:00:00+08:00 --end 2026-02-27T18:00:00+08:00` |
| 发消息给同事 | `feishu-api.mjs send-text --to ou_xxx --text "下午开会记得带材料"` |
| 发群消息 | `feishu-api.mjs send-text --to oc_xxx --id-type chat_id --text "全员通知"` |
| 找人 | `feishu-api.mjs contact-search --query "张帆"` |
| 查部门 | `feishu-api.mjs department-list` |
| 发起请假 | `feishu-api.mjs approval-create --code LEAVE --user ou_xxx --form '{"days":3,"reason":"家事"}'` |
| 查审批状态 | `feishu-api.mjs approval-get --instance INST_xxx` |
| 查表格数据 | `feishu-api.mjs bitable-query --app appXXX --table tblYYY --filter '{"field":"状态","value":"进行中"}'` |
| 添加表格记录 | `feishu-api.mjs bitable-add --app appXXX --table tblYYY --records '[{"fields":{"名称":"新任务"}}]'` |
