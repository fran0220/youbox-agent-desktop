# Phase 0 基线冻结与差异确认

> 冻结日期：2026-06-29  
> 执行分支：当前项目 `plan/originai-jacoworks-integration`；原仓 `integrate/originai-desktop-endpoints`

## 生产 Source of Truth（冻结结论）

| 组件 | Source of Truth | 说明 |
|---|---|---|
| **Gateway** | `~/JAcoworks/gateway` | 生产部署于 `jacoapi.jingao.club`（:8847），`main` push 自动部署 |
| **PostgreSQL** | 原 JAcoworks DB `jacoworks` | 用户/会话/配置/发布/反馈等业务数据 |
| **Website/Admin** | `~/JAcoworks/website` | `jaco.jingao.club/admin` |
| **当前项目 `gateway/`** | **非生产** | 仅作 OriginAI desktop endpoint **patch 来源** 与本地开发参考；不得作为第二套生产 gateway 维护 |

## 仓库基线快照

### 当前项目（JAcoworks-Next / OriginAI）

| 项 | 值 |
|---|---|
| 分支 | `plan/originai-jacoworks-integration`（自 `main` 创建） |
| HEAD | `6fa0c7b443870492d6f955ec46d47a668663bd3d` |
| 生产部署分支 | `main` → `origin/main`（客户端仓库，无 gateway 生产部署） |
| 最近 commit | `6fa0c7b` fix(electron): complete desktop i18n for browser sub-windows |

### 原 JAcoworks（`~/JAcoworks`）

| 项 | 值 |
|---|---|
| 分支 | `integrate/originai-desktop-endpoints`（自 `main` 创建） |
| HEAD | `cd5fc552b0772789b5ace5e38c9ecd37b89035e2` |
| 生产部署分支 | `main` → `origin/main`（CI `deploy.yml` push main 自动部署 gateway + website 到 jingao） |
| 最近 commit | `cd5fc55` ci(windows): use regional COS endpoint for upload |
| 最新 tag | `v1.11.1` @ `eec8086` |

## Git 工作树分类

### 当前项目 `git status --short`（33 条未跟踪）

#### 可提交（阶段 1+ 前可分批入库）

| 路径 | 说明 |
|---|---|
| `docs/originai-jacoworks-integration-plan.md` | 集成执行计划 |
| `docs/originai-jacoworks-phase-0-baseline.md` | 本阶段基线产物 |
| `docs/origincoworks-next-development-goals.md` | 开发目标文档 |
| `gateway/`（整目录，除 `gateway/bin/`） | OriginAI desktop endpoint patch 来源；含 `desktop_*.go`、store/audit 辅助、测试 |

#### 需保留（本地 WIP，本阶段不提交）

| 路径 | 说明 |
|---|---|
| `mission-control-DjlVSzYO.js` | 根目录孤立构建产物，来源待确认 |

#### 可忽略（不入库）

| 路径 | 说明 |
|---|---|
| `.amp/` | Amp 运行缓存 |
| `apps/electron/.bun-download-temp/` | Bun 下载临时目录 |
| `gateway/bin/` | 本地编译产物 |

### 原 `~/JAcoworks` `git status --short`（46 条）

#### 已修改（需保留，与 gateway 集成无关）

| 路径 | 说明 |
|---|---|
| `desktop/src/**`（38 个文件） | Classic Tauri 桌面端本地 WIP |
| `desktop/src-tauri/Cargo.lock` | 依赖锁文件变更 |
| `.agents/skills/releasing-desktop/SKILL.md` | skill 文档 |
| `tasks/lessons.md` | 任务笔记 |

#### 未跟踪（需保留 / 本地专用）

| 路径 | 分类 | 说明 |
|---|---|---|
| `desktop/src/react/components/preview-renderers-utils.ts` | 需保留 | desktop WIP |
| `tasks/skill-cli-migration.md` | 需保留 | 任务笔记 |
| `pi-config/` | 需保留 | 本地 Pi 配置 |
| `gateway/data/` | 可忽略 | 本地 gateway 运行时数据 |

**注意**：原仓 desktop WIP 与 gateway cherry-pick 工作独立；阶段 1 仅改 `~/JAcoworks/gateway`，不触碰 desktop 工作树。

## `desktop_*.go` 文件对比

### 当前项目 `gateway/cmd/gateway/desktop_*.go`

```
gateway/cmd/gateway/desktop_audit.go
gateway/cmd/gateway/desktop_audit_integration_test.go
gateway/cmd/gateway/desktop_audit_test.go
gateway/cmd/gateway/desktop_classic_sessions.go
gateway/cmd/gateway/desktop_classic_sessions_test.go
gateway/cmd/gateway/desktop_config_test.go
gateway/cmd/gateway/desktop_feedback.go
gateway/cmd/gateway/desktop_feedback_test.go
gateway/cmd/gateway/desktop_policy.go
gateway/cmd/gateway/desktop_policy_test.go
gateway/cmd/gateway/desktop_release.go
gateway/cmd/gateway/desktop_release_feed.go
gateway/cmd/gateway/desktop_release_feed_test.go
gateway/cmd/gateway/desktop_release_test.go
gateway/cmd/gateway/desktop_session_metadata.go
gateway/cmd/gateway/desktop_session_metadata_test.go
gateway/cmd/gateway/desktop_workspace_trust.go
```

（`desktopConfigHandler` 实现在 `main.go`，测试在 `desktop_config_test.go`）

### 原 `~/JAcoworks/gateway/cmd/gateway/desktop_*.go`

```
（无）
```

## API Diff 表

| 当前项目 Endpoint | 原 gateway 是否已有 | 是否需要 cherry-pick | 备注 |
|---|---|---|---|
| `GET /api/desktop/config` | ❌ | ✅ 是 | 新客户端 LLM 配置；secret redaction 逻辑在 `main.go` + `agent_config.go` |
| `GET /api/desktop/classic-sessions` | ❌ | ✅ 是 | 复用 `store.ListSessions`（原仓已有） |
| `POST /api/desktop/session-metadata` | ❌ | ✅ 是 | 写回 `chat_sessions` 元数据 |
| `GET /api/desktop/policy` | ❌ | ✅ 是 | 含 `desktop_workspace_trust.go` 信任配置 |
| `POST /api/desktop/audit` | ❌ | ✅ 是 | 需 `internal/audit/sanitize.go` |
| `GET /api/desktop/release/latest` | ❌ | ✅ 是 | 需 `internal/store/releases.go` |
| `GET /api/desktop/release/latest.yml` | ❌ | ✅ 是 | electron-updater feed |
| `GET /api/desktop/release/latest-mac.yml` | ❌ | ✅ 是 | 同上 |
| `GET /api/desktop/release/latest-linux.yml` | ❌ | ✅ 是 | 同上 |
| `GET /api/desktop/release/latest-linux-arm64.yml` | ❌ | ✅ 是 | 同上 |
| `POST /api/desktop/feedback` | ❌ | ⚠️ 可选 | 原仓已有 `POST /api/feedback`；可补 alias 或客户端直接用已有路由 |
| `GET /api/memory/search` | ❌ | ✅ 是 | handler 在 `main.go`；需 `store.SearchMemoryFiles`（仅 Next 仓有） |
| `DELETE /api/memory/file` | ❌ | ✅ 是 | handler 在 `main.go`；需 `store.DeleteMemoryFile`（仅 Next 仓有） |
| `GET /api/agent/config` | ✅ | ❌ 否 | 原仓已有（`main.go` 内联 handler） |
| `POST /api/feedback` | ✅ | ❌ 否 | 原仓已有（`main.go` 内联 `feedbackHandler`） |
| `POST /api/memory/sync` | ✅ | ❌ 否 | 两仓均有 |
| `GET /api/memory/stats` | ✅ | ❌ 否 | 两仓均有 |
| `DELETE /api/memory` | ✅ | ❌ 否 | 两仓均有 |

### Cherry-pick 辅助文件（非 `desktop_*.go`，阶段 1 需一并评估）

| 文件 | 用途 |
|---|---|
| `gateway/cmd/gateway/agent_config.go` | `desktopConfigHandler` 共用 redaction / models 逻辑 |
| `gateway/cmd/gateway/desktop_workspace_trust.go` | policy 信任默认值 |
| `gateway/internal/audit/sanitize.go` (+ test) | audit 脱敏 |
| `gateway/internal/store/releases.go` | release / release_assets 查询 |
| `gateway/internal/store/feedback.go` | 若 feedback alias 复用 desktop handler |
| `gateway/internal/store/memory.go` | `SearchMemoryFiles`、`DeleteMemoryFile`（原仓 `memory.go` 无此二方法） |
| `gateway/cmd/gateway/main.go` | 路由注册片段（仅摘取新增路由，不改已有行为） |

## 阶段 0 验收自检

- [x] 当前项目 `git status --short` 已记录并分类
- [x] 原 `~/JAcoworks` `git status --short` 已记录并分类
- [x] API diff 表已产出
- [x] 生产 gateway source of truth 明确为 `~/JAcoworks/gateway`
- [x] 工作分支已创建，未开始大规模 rename 或复制目录
- [x] 未修改生产 gateway 逻辑

## 推荐验证命令（Amp 门禁）

```bash
git status --short
find gateway/cmd/gateway -maxdepth 1 -type f -name 'desktop_*.go' -print | sort
find ~/JAcoworks/gateway/cmd/gateway -maxdepth 1 -type f -name 'desktop_*.go' -print | sort
```

## 下一阶段入口（阶段 1，本阶段不执行）

在 `~/JAcoworks` 的 `integrate/originai-desktop-endpoints` 分支上，按 API diff 表 cherry-pick 必要 `desktop_*` endpoint 及辅助 store/audit 文件，编译测试通过后合入。