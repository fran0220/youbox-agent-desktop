# OriginCoworks Next 开发目标文档

> 目标：以 `craft-ai-agents/craft-agents-oss` 为基底，建设下一代 OriginCoworks / JAcoworks agent 工作台；完整吸收 Craft 的 Desktop、Runtime、WebUI、Headless Server、CLI、Sessions、Sources、Skills、Automations、Permissions 等能力，同时接入旧 JAcoworks 必要后端服务与既有用户数据。

## 1. 总体定位

OriginCoworks Next 不是旧 Tauri desktop / `vm-agent` sidecar 的小修小补，而是新的主线产品：

- **客户端与 runtime 基底**：Fork Craft Agents。
- **本地 agent runtime**：直接使用 Craft runtime，包括 Electron main runtime host、`PiAgent`、`pi-agent-server`、bundled Bun、Pi SDK tools。
- **远程能力**：保留并产品化 Craft WebUI、Headless Server、CLI。
- **后端 source of truth**：保留旧 JAcoworks gateway / PostgreSQL / website / admin / release 系统中的必要服务。
- **旧实现处置**：旧 Tauri desktop 和旧 `vm-agent` 进入废弃/维护路径，不作为 Next 主线继续演进。

```diagram
╭──────────────────────────────────────────────────────────╮
│                     OriginCoworks Next                    │
├──────────────────────────────────────────────────────────┤
│ Product Entrypoints                                      │
│  ╭──────────────╮ ╭──────────────╮ ╭──────────────╮      │
│  │ Desktop App  │ │ Remote WebUI │ │ CLI/API      │      │
│  ╰──────┬───────╯ ╰──────┬───────╯ ╰──────┬───────╯      │
├─────────┼────────────────┼────────────────┼──────────────┤
│ Runtime Host                                             │
│  ╭────────────────────────────────────────────────────╮  │
│  │ Craft Runtime Host                                 │  │
│  │ Electron main / Headless server / WebSocket RPC    │  │
│  ╰──────────────────────┬─────────────────────────────╯  │
│                         ▼                                │
│  ╭────────────────────────────────────────────────────╮  │
│  │ PiAgent + pi-agent-server                          │  │
│  │ Pi SDK / JSONL subprocess / streaming / tools      │  │
│  ╰──────────────────────┬─────────────────────────────╯  │
├─────────────────────────┼────────────────────────────────┤
│ Capability Layer         ▼                                │
│  ╭──────────╮ ╭──────────╮ ╭──────────╮ ╭────────────╮   │
│  │ Sessions │ │ Skills   │ │ Memory   │ │ Sources    │   │
│  ╰──────────╯ ╰──────────╯ ╰──────────╯ ╰────────────╯   │
│  ╭──────────╮ ╭──────────╮ ╭──────────╮ ╭────────────╮   │
│  │ Tools    │ │ Perms    │ │ Automate │ │ Audit      │   │
│  ╰──────────╯ ╰──────────╯ ╰──────────╯ ╰────────────╯   │
├──────────────────────────────────────────────────────────┤
│ JAcoworks Compatibility Adapters                         │
│  ╭──────────╮ ╭──────────╮ ╭──────────╮ ╭────────────╮   │
│  │ Auth     │ │ LLM Cfg  │ │ SkillSync│ │ MemorySync │   │
│  ╰──────────╯ ╰──────────╯ ╰──────────╯ ╰────────────╯   │
│  ╭──────────╮ ╭──────────╮ ╭──────────╮ ╭────────────╮   │
│  │ Sessions │ │ Release  │ │ Feedback │ │ Policy     │   │
│  ╰──────────╯ ╰──────────╯ ╰──────────╯ ╰────────────╯   │
╰─────────────────────────┬────────────────────────────────╯
                          ▼
╭──────────────────────────────────────────────────────────╮
│ Existing JAcoworks Backend                               │
│ Gateway + Website + PostgreSQL                           │
│ users / auth / llm / skills / memory / cron / releases   │
╰──────────────────────────────────────────────────────────╯
```

## 2. 核心原则

1. **完整继承 Craft 能力，不做低配重写**  
   Desktop、WebUI、Headless Server、CLI、Sources、Skills、Automations、Permissions、runtime packaging 都应作为目标能力保留。

2. **直接使用 Craft runtime，不重写 sidecar**  
   Next 主线使用 Craft 的 `PiAgent` + `pi-agent-server` 模型。除非长期稳定性或安全隔离证明必须重写，否则不重新引入旧 `vm-agent` 模式。

3. **旧 JAcoworks 后端是业务 source of truth**  
   用户、认证、模型配置、skills、memory、cron、feedback、release、admin 仍由旧 gateway / website / PostgreSQL 管理。

4. **适配层隔离，而不是到处硬改 Craft core**  
   新增 OriginCoworks/JAcoworks adapter 包承接 auth/config/skills/memory/session/release 等接入，减少与 upstream Craft 的无谓冲突。

5. **桌面本地与远程 WebUI 都是一等形态**  
   Desktop 负责一键安装本地 agent；WebUI + Headless Server 负责远程部署、远程 runtime、浏览器控制台。

6. **安全优先**  
   文件写入、bash、MCP、外部 API、memory 写入、allow-all、远程 headless runtime 都必须纳入权限与审计模型。

## 3. 必须实现的 Craft 全能力

### 3.1 Desktop App

目标：完整保留 Craft Electron desktop 的 agent workbench 体验，并品牌化为 OriginCoworks Next。

必须能力：

- Electron desktop app。
- 多 workspace。
- Session inbox。
- Streaming chat。
- Tool call 展示。
- Diff viewer。
- Attachments。
- Settings。
- Source / Skill / Automation 管理 UI。
- Permission mode UI。
- Deep link 能力。
- 本地一键安装，无需用户安装 Bun / Pi SDK / ripgrep 等基础 runtime。

需要改造：

- App name、icon、bundle id、数据目录。
- 登录页替换为 OriginCoworks / JAcoworks gateway 登录。
- Provider/model 配置改为 gateway 下发。
- 默认数据目录从 `~/.craft-agent` 改为 `~/.origincoworks-next` 或最终产品目录。

### 3.2 Runtime / Pi SDK

目标：使用 Craft 原生 runtime 作为 Next 的本地 agent 执行层。

必须能力：

- `PiAgent` JSONL client。
- `pi-agent-server` subprocess。
- Pi SDK `createAgentSession`。
- Streaming events。
- Session continuation。
- read / write / edit / bash / grep / find / ls。
- Permission hook。
- Tool proxy。
- Runtime crash isolation。
- Packaged bundled Bun。

需要改造：

- Pi backend 默认使用 gateway 下发模型。
- LLM endpoint 默认接小猫 AI 网关或 gateway proxy。
- Permission policy 接入用户 role、workspace trust、gateway policy。
- Runtime audit 事件可上报 gateway。

### 3.3 WebUI

目标：保留 Craft WebUI，并产品化为远程部署控制台。

必须能力：

- `apps/webui` Vite/React browser shell。
- 复用 Electron renderer UI。
- WebSocket RPC adapter。
- Login page。
- Browser notification / file picker / no-op native APIs。
- 远程连接 headless server。

需要改造：

- WebUI 登录接 gateway auth。
- WebSocket RPC 鉴权接 gateway session / cookie。
- CSRF、secure cookie、TLS、logout、token refresh。
- 多用户与 workspace 隔离策略。

### 3.4 Headless Server

目标：保留 Craft headless server，作为远程 agent runtime。

必须能力：

- HTTP + WebSocket RPC 同端口服务。
- Serve WebUI static assets。
- Remote runtime host。
- Remote session management。
- Docker/VPS 部署。
- Health check。
- WebUI auth。

需要改造：

- 接 JAcoworks gateway auth。
- 接 JAcoworks LLM config。
- 接 skills/memory sync。
- 增加多租户隔离、resource limits、audit 上报。
- 明确远程文件系统和 bash 的安全边界。

### 3.5 CLI

目标：保留 Craft CLI，作为开发者、CI、自动化入口。

必须能力：

- 连接 headless server。
- health / ping / versions。
- workspace / session 查询。
- session create / send / listen / cancel。
- run 模式。
- 脚本化调用。

需要改造：

- 命令品牌化。
- 默认连接 OriginCoworks / JAcoworks server。
- 支持 gateway token 登录。
- 输出与错误格式标准化。

### 3.6 Sessions

目标：使用 Craft session model 承载新会话，导入旧 JAcoworks 会话。

必须能力：

- 新 session 本地/远程 runtime 持久化。
- Session status。
- Message streaming。
- Tool events。
- Diff / artifacts。
- Imported classic sessions。

旧数据接入：

- 从旧 `chat_sessions` 导入历史会话。
- 旧会话只读显示。
- 不承诺恢复旧 runtime 内部状态。
- 提供“从旧会话继续”时创建新 Craft session，并注入摘要上下文。

### 3.7 Sources

目标：完整实现 Craft Sources 抽象，并接入 OriginCoworks policy。

必须能力：

- Local filesystem source。
- MCP source。
- REST API source。
- Memory source。
- Source auth。
- Source test。
- Source-scoped permissions。

需要改造：

- Gateway 下发 system sources。
- 用户自定义 source 受 policy 约束。
- MCP 环境变量白名单。
- Source credentials 加密存储。

### 3.8 Skills

目标：完整保留 Craft `SKILL.md` 技能体系，并接旧 JAcoworks `skill_files`。

必须能力：

- Workspace skills。
- `SKILL.md` frontmatter。
- Slash command / skill discovery。
- `requiredSources`。
- `alwaysAllow`。
- System skill 和 user skill。

旧服务接入：

- Gateway `skill_files` 是 source of truth。
- 本地 workspace skills 是 cache。
- checksum 增量同步。
- 支持系统技能下发。
- 后续支持用户技能写回 gateway。

### 3.9 Memory

目标：将旧 JAcoworks `user_memory` 接入为 Craft source / runtime context。

必须能力：

- `@memory` source。
- Memory read/search。
- Memory write with permission。
- Local cache。
- Checksum sync。
- Conflict handling。

旧服务接入：

- Gateway `user_memory` 是 source of truth。
- 支持离线缓存。
- 写回需带 checksum。
- 删除/批量修改需要确认。

### 3.10 Automations / Cron

目标：同时保留 Craft local automations 和旧 JAcoworks cloud cron。

必须能力：

- Craft local automations。
- SessionStart / SessionEnd。
- UserPromptSubmit。
- PreToolUse / PostToolUse。
- SchedulerTick。
- Prompt action。
- Webhook action。

旧服务接入：

- Gateway `cron_jobs` 继续作为云端定时任务。
- Local automations 不直接替代 cloud cron。
- Cloud cron 和 local automation 在 UI 中区分。

### 3.11 Permissions / Audit

目标：完整实现 Craft 权限模式，并扩展为 OriginCoworks 安全模型。

必须能力：

- `safe`。
- `ask`。
- `allow-all`。
- Tool approval UI。
- Source-scoped permissions。
- Workspace trust。
- High-risk command detection。

旧服务接入：

- Gateway user role。
- Gateway feature flags / policy。
- Audit event 上报旧 gateway `audit_logs` 或新增 audit API。

### 3.12 Packaging / Release

目标：使用 Electron-builder 建立新的 Next 发布链路，并接旧 website/release 体系。

必须能力：

- macOS DMG/ZIP。
- Windows NSIS one-click installer。
- Bundled runtime。
- Signing。
- Notarization。
- Auto update。
- COS upload。
- Release DB registration。

旧服务接入：

- 保留旧 Tauri updater 给 Classic。
- 新增 Next release/update endpoint。
- `releases` / `release_assets` 增加 client kind 或新增 Next release 表。

## 4. 必须接入的旧 JAcoworks 服务

| 旧服务/数据 | Next 用途 | 接入方式 |
|---|---|---|
| `users` | 用户身份 | Gateway auth |
| `auth_sessions` | 登录态 | token / refresh / cookie |
| `invite_codes` | 注册激活 | 复用现有 API |
| `audit_logs` | 审计 | 新增/复用 audit API |
| `system_settings` | LLM 与系统配置 | desktop config API |
| `llm_providers` | provider 列表 | config sync |
| `llm_models` | model 列表 | config sync |
| `skill_files` | system/user skills | skills sync |
| `user_memory` | 用户记忆 | memory source |
| `chat_sessions` | 历史会话 | read-only import |
| `cron_jobs` | 云端定时任务 | cron UI/API |
| `feedback` | 用户反馈 | feedback API |
| `games` | 游戏资产，可选 | 后续接入或隐藏 |
| `releases` | 版本管理 | Next release support |
| `release_assets` | 下载/更新资产 | Next updater assets |

## 5. 建议新增 Adapter 包

短期在本仓新增单包：

```text
packages/origincoworks/
  src/
    gateway-client.ts
    auth.ts
    desktop-config.ts
    model-config.ts
    skills-sync.ts
    memory-source.ts
    session-import.ts
    policy.ts
    audit.ts
    release.ts
    paths.ts
    types.ts
```

长期可拆分：

```text
packages/origincoworks-gateway-client
packages/origincoworks-auth
packages/origincoworks-config
packages/origincoworks-skills
packages/origincoworks-memory
packages/origincoworks-policy
```

## 6. 建议新增 Gateway API

旧 gateway 已复制到本仓 `gateway/`，后续应补 Next 专用 API：

```http
GET  /api/desktop/config
GET  /api/desktop/skills
GET  /api/desktop/memory
PUT  /api/desktop/memory/{path}
GET  /api/desktop/classic-sessions
POST /api/desktop/session-metadata
POST /api/desktop/audit
POST /api/desktop/feedback
GET  /api/desktop/release/latest
```

这些 API 的原则：

- 面向 Next 客户端稳定化，不破坏旧客户端接口。
- 认证复用旧 gateway auth middleware。
- 输出结构尽量贴合 Craft adapter 所需。
- 旧 `chat_sessions` 不强行承载完整 Craft event log，必要时新增表。

## 7. 数据目录与命名

建议 Next 默认目录：

```text
~/.origincoworks-next/
├── credentials.enc
├── config.json
├── cache/
│   ├── desktop-config.json
│   ├── user-profile.json
│   ├── llm-config.json
│   └── sync-state.json
└── workspaces/
    └── {workspaceId}/
        ├── sessions/
        ├── imported-sessions/
        ├── skills/
        ├── memory/
        ├── sources/
        └── automations.json
```

产品命名待最终确认：

- 开发代号：OriginCoworks Next。
- 兼容名称：JAcoworks Next。
- 旧客户端：JAcoworks Classic。

## 8. 开发阶段

### Stage 1：Fork 基线梳理

- 跑通原版 Craft desktop。
- 跑通 Craft Pi runtime。
- 跑通 Craft WebUI。
- 跑通 Craft headless server。
- 跑通 Craft CLI。
- 确认 packaged desktop 不依赖系统 Bun。

### Stage 2：品牌与路径改造

- App name / icon / bundle id。
- 数据目录。
- README / docs。
- 隐藏无关 provider。

### Stage 3：旧 Gateway 接入

- Gateway client。
- Auth。
- Desktop config。
- LLM config。
- Model mapping。

### Stage 4：Runtime 接入

- Pi backend 使用 gateway config。
- 小猫 AI 网关接入。
- Runtime audit。
- Permission policy。

### Stage 5：Skills / Memory / Sessions

- Skills sync。
- Memory source。
- Classic session import。
- New session metadata sync。

### Stage 6：WebUI / Headless 远程部署

- Gateway auth cookie。
- Remote runtime isolation。
- WebSocket auth。
- TLS / CSRF。
- Docker / VPS deploy。

### Stage 7：Release / Update

- macOS build/sign/notarize。
- Windows NSIS build/sign。
- COS upload。
- Website release API。
- Classic / Next 并行安装。

### Stage 8：全面产品化

- Automations。
- Sources marketplace / allowlist。
- Cron UI。
- Audit dashboard。
- Feedback。
- Admin policy。
- Public stable rollout。

## 9. 验收标准

完整版本必须满足：

1. 用户可下载安装 Desktop，一键启动，无需安装 Bun/Node/Pi SDK。
2. 用户可使用旧 JAcoworks 账号登录。
3. 用户模型配置来自旧 gateway。
4. Agent runtime 使用 Craft Pi runtime。
5. Local tools 正常执行并受权限控制。
6. Skills 从旧 gateway 同步并可被 agent 使用。
7. Memory 从旧 gateway 同步并可读写。
8. 旧 `chat_sessions` 可导入并只读查看。
9. WebUI 可远程部署并连接 headless runtime。
10. CLI 可连接 runtime 并执行自动化任务。
11. Cloud cron 与 local automations 并存。
12. 高风险工具操作有审计。
13. macOS / Windows 发布链路可用。
14. Classic 与 Next 可并行安装。
15. Next release/update 不破坏 Classic updater。

## 10. 当前仓库工作约定

本仓库作为 Next 独立开发仓：

- Craft upstream 代码作为基础。
- `gateway/` 存放从旧 JAcoworks 复制来的必要后端代码。
- 新能力优先在 Next 仓内研究、实现、验证。
- 旧 JAcoworks 主仓暂不承载 Next 客户端开发。
- 需要修改线上 gateway / website / DB schema 时，再同步回旧主仓或规划后端迁移。

## 11. 一句话目标

OriginCoworks Next 要成为一个完整的 agent workbench：

> **桌面端可本地一键运行，WebUI 可远程部署，CLI 可自动化调用；底层完整继承 Craft runtime 和能力体系，上层接入旧 JAcoworks 的用户、认证、模型、skills、memory、cron、release 等必要服务。**
