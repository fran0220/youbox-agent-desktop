# OriginAI 接入原 JAcoworks 体系执行计划

## 目标

当前项目作为 **OriginAI** 新客户端主线，复用原 JAcoworks 的生产后端体系：

- 原 JAcoworks gateway 继续作为生产 gateway source of truth。
- 原 PostgreSQL 数据库继续作为用户、会话、配置、发布、反馈等业务数据 source of truth。
- 原 website/admin 后台继续作为短期管理后台 source of truth。
- 当前项目聚焦 OriginAI Desktop / WebUI / CLI / runtime 适配。
- 不把 YouBox 纳入本计划。

## 非目标

- 不重写原 JAcoworks gateway。
- 不迁移或重建整套数据库 schema。
- 不把原 Rust website/admin 整体搬进当前项目作为第一阶段目标。
- 不让当前仓库与原仓库长期维护两份生产 gateway。
- 不在此阶段考虑 Craft upstream 同步策略。

## 总体架构

```diagram
╭──────────────────────────────────────────────╮
│ 原 JAcoworks 生产体系                         │
│ ~/JAcoworks                                  │
│                                              │
│ Go gateway  : jacoapi.jingao.club            │
│ Rust website: jaco.jingao.club/admin         │
│ PostgreSQL  : jacoworks                      │
│ Release DB  : releases / release_assets      │
╰──────────────────────┬───────────────────────╯
                       │ HTTPS API / shared DB via gateway/admin
                       ▼
╭──────────────────────────────────────────────╮
│ OriginAI 新客户端体系                         │
│ 当前 JAcoworks-Next                           │
│                                              │
│ Electron Desktop / WebUI / CLI / runtime      │
│ gateway adapter / auth / config / update      │
╰──────────────────────────────────────────────╯
```

---

# 阶段 0：基线冻结与差异确认

## 目标

在任何迁移/改名/补 API 前，冻结两个仓库的当前状态，并确认“生产 source of truth”。

## 工作项

1. 在当前项目创建工作分支，例如 `plan/originai-jacoworks-integration`。
2. 在原 `~/JAcoworks` 创建工作分支，例如 `integrate/originai-desktop-endpoints`。
3. 记录两个仓库当前 commit、未提交变更、生产部署分支。
4. 明确生产 gateway 使用原 `~/JAcoworks/gateway`，当前项目 `gateway/` 只作为 patch 来源或本地开发参考。
5. 列出当前项目新增的 `desktop_*` gateway endpoint 与原 gateway 缺口。

## 验收门禁

- [ ] 当前项目 `git status --short` 已记录并分类：可提交、需保留、可忽略。
- [ ] 原 `~/JAcoworks` `git status --short` 已记录并分类。
- [ ] 有一份 API diff 表：`当前项目 endpoint` / `原 gateway 是否已有` / `是否需要 cherry-pick`。
- [ ] 明确写下：生产 gateway source of truth 是原 `~/JAcoworks/gateway`。
- [ ] 没有在未冻结状态下开始大规模 rename 或复制目录。

## 推荐验证命令

```bash
git status --short
git log --oneline --decorate --max-count=10

# 当前项目
find gateway/cmd/gateway -maxdepth 1 -type f -name 'desktop_*.go' -print | sort

# 原 JAcoworks
find ~/JAcoworks/gateway/cmd/gateway -maxdepth 1 -type f -name 'desktop_*.go' -print | sort
```

## 回滚点

本阶段不改生产逻辑；如发现分支状态混乱，停止后续阶段，先整理工作树。

---

# 阶段 1：最小补齐原 gateway 的 OriginAI 客户端端点

## 目标

不复制整套 gateway，只把当前 OriginAI 客户端需要、但原 gateway 缺失的少量 endpoint 合回原 `~/JAcoworks/gateway`。

## 候选 endpoint

以下 endpoint 需要逐项确认原 gateway 是否已有：

| Endpoint | 用途 | 处理策略 |
|---|---|---|
| `GET /api/desktop/config` | 新客户端 LLM 配置 | 缺则 cherry-pick |
| `GET /api/desktop/classic-sessions` | 旧会话只读导入 | 缺则 cherry-pick |
| `POST /api/desktop/session-metadata` | 新 session 元数据写回 `chat_sessions` | 缺则 cherry-pick |
| `GET /api/desktop/policy` | 桌面权限策略 | 缺则 cherry-pick |
| `POST /api/desktop/audit` | 桌面审计上报 | 缺则 cherry-pick |
| `GET /api/desktop/release/latest` | release JSON 查询 | 缺则 cherry-pick |
| `GET /api/desktop/release/latest*.yml` | Electron updater feed | 缺则 cherry-pick |
| `POST /api/desktop/feedback` | feedback alias | 可补 alias，或客户端直接用 `/api/feedback` |
| `GET /api/memory/search` | memory source 搜索 | 缺则 cherry-pick |
| `DELETE /api/memory/file` | 单文件 memory 删除 | 缺则 cherry-pick |

## 工作项

1. 从当前项目挑选必要的 `gateway/cmd/gateway/desktop_*.go` 文件和相关 store/audit helper。
2. 合入原 `~/JAcoworks/gateway`。
3. 只改原 gateway 的路由注册，不改变已有 endpoint 行为。
4. 保留旧 `/api/agent/config`、`/api/feedback`、`/api/skills/*` 等已有接口兼容。
5. 补测试：每个新增 endpoint 至少一个 handler 单测或集成测试。

## 验收门禁

- [ ] 原 gateway 编译通过。
- [ ] 原 gateway 测试通过。
- [ ] 旧客户端已有核心接口仍返回兼容结果。
- [ ] 新 OriginAI 客户端需要的 endpoint 全部返回预期格式。
- [ ] 所有新增 endpoint 都使用原 auth middleware，不绕过认证。
- [ ] 不引入第二套 DB schema；所有读写仍落原 JAcoworks DB 表。
- [ ] `410 Gone` 历史迁移路由仍保持原语义。

## 推荐验证命令

```bash
cd ~/JAcoworks/gateway
go vet ./...
go test ./...
go build -o /tmp/jacoworks-gateway ./cmd/gateway
```

## API smoke 验收

在本地启动原 gateway 后，用真实或测试账号验证：

```bash
curl -sf http://127.0.0.1:8847/health

TOKEN=$(curl -sS -X POST http://127.0.0.1:8847/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"TEST_USER","password":"TEST_PASS"}' | jq -r .token)

curl -sf -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8847/api/users/me
curl -sf -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8847/api/desktop/config
curl -sf -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8847/api/desktop/classic-sessions
curl -sf -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8847/api/desktop/policy
```

## 回滚点

所有变更都在原 gateway 一个 feature 分支中。若任一旧客户端接口回归，回滚该分支，不影响当前项目。

---

# 阶段 2：OriginAI 命名与兼容 alias

## 目标

把当前项目用户可见产品名改为 **OriginAI**，但保留旧 OriginCoworks/JAcoworks 配置 alias，避免破坏已有开发环境和用户数据。

## 工作项

1. 用户可见名称：`OriginCoworks Next` → `OriginAI`。
2. 新增 env：`ORIGINAI_GATEWAY_URL`。
3. 保留 env alias：`ORIGINCOWORKS_GATEWAY_URL`。
4. 默认生产 gateway 指向原 JAcoworks gateway，可通过构建环境覆盖。
5. 新增 deeplink scheme：`originai://`。
6. 保留 `origincoworks://` 兼容一段时间。
7. 新数据目录：`~/.originai`。
8. 保留读取 `~/.origincoworks-next` 的迁移逻辑或 fallback。
9. Electron app metadata 改为 OriginAI。
10. CLI 文案与 help 改为 OriginAI。

## 验收门禁

- [ ] UI 标题、登录页、WebUI manifest、Electron productName 均显示 OriginAI。
- [ ] `ORIGINAI_GATEWAY_URL` 优先生效。
- [ ] `ORIGINCOWORKS_GATEWAY_URL` 仍可用。
- [ ] 未设置 env 时，本地开发仍默认 `http://127.0.0.1:8847` 或明确的开发默认值。
- [ ] `originai://` deeplink 可解析。
- [ ] `origincoworks://` deeplink 仍可解析或有明确兼容策略。
- [ ] 新用户数据写入 `~/.originai`。
- [ ] 老用户数据不会被静默删除。
- [ ] CLI help、README、安装说明不再主推 OriginCoworks。

## 推荐验证命令

```bash
bun run typecheck:electron
cd apps/webui && bun run typecheck
cd apps/cli && bun run typecheck

rg -n "OriginCoworks|origincoworks|ORIGINCOWORKS" README.md apps packages scripts docs
```

允许残留清单必须明确，例如：兼容 alias、迁移注释、旧 scheme 测试。

## 回滚点

若打包或数据目录迁移出现风险，保留代码内部包名 `packages/origincoworks`，只回滚用户可见 metadata，不回滚 gateway 适配逻辑。

---

# 阶段 3：当前 OriginAI 客户端接原 JAcoworks gateway 验证

## 目标

当前项目的 Desktop / WebUI / CLI 都能使用原 JAcoworks gateway 登录、取配置、运行会话。

## 工作项

1. Desktop 登录原 gateway。
2. Desktop 成功拉取 `/api/desktop/config` 并生成 managed LLM connection。
3. Desktop 能创建新本地 session，并把 metadata 写回原 `chat_sessions`。
4. Desktop 能读取 classic sessions。
5. WebUI 登录原 gateway，spawn per-user backend。
6. CLI 登录原 gateway，token 持久化到 OriginAI 配置目录。
7. Logout 能 revoke gateway session 并清本地 token。

## 验收门禁

- [ ] Desktop 未登录时显示 OriginAI 登录页。
- [ ] 使用原 JAcoworks 账号可登录。
- [ ] 登录后 `/api/users/me` 显示正确用户。
- [ ] LLM connection 来自 gateway，而不是手工 provider onboarding。
- [ ] 新建 session 可正常发消息。
- [ ] 退出登录后再次访问需要重新登录。
- [ ] WebUI 多用户 session 目录隔离。
- [ ] CLI `login` 后可以 `health/ping/send` 基本操作。
- [ ] gateway 日志中能看到对应用户请求，不是匿名或 admin token fallback。

## 推荐验证命令

```bash
# Gateway smoke
curl -sf https://jacoapi.jingao.club/health

# Desktop build/typecheck
bun run typecheck:electron
bun run electron:build

# WebUI
bun run server:build:subprocess
bun run webui:build
cd apps/webui && bun run typecheck

# CLI
cd apps/cli && bun run typecheck && bun test src/
```

## 浏览器验收

使用 `agent-browser` 或手工：

- 打开 WebUI login。
- 输入测试账号。
- 确认进入 OriginAI shell。
- 刷新页面仍保持登录。
- Logout 后无法继续访问 RPC。

## 回滚点

若原 gateway API 行为不满足新客户端，优先修原 gateway 的兼容 endpoint；不要在客户端写特例绕过认证或直接读 DB。

---

# 阶段 4：原 website/download 更新为 OriginAI

## 目标

原 `jaco.jingao.club` 继续作为官网和后台，但下载页与公开文案切到 OriginAI 新客户端。

## 工作项

1. 下载页展示 OriginAI Electron 客户端。
2. 保留 JAcoworks Classic/Tauri 下载入口，若仍需支持老版本。
3. 更新公开页面文案：新客户端是 OriginAI，账号仍为 JAcoworks 账号体系。
4. 后台 login/settings/releases/providers/users 等功能先保持原样。
5. 下载按钮指向 release_assets 中 Electron 产物。
6. 文档说明新旧客户端差异和迁移路径。

## 验收门禁

- [ ] `/download` 页面展示 OriginAI 新客户端版本。
- [ ] 管理后台 `/admin` 可登录且功能不回归。
- [ ] 原 release 管理页面仍可创建/编辑 release。
- [ ] 下载链接来自 `release_assets`，不是硬编码临时 URL。
- [ ] Classic 客户端如保留，其 updater/download 不被破坏。
- [ ] 官网没有把 YouBox 或其他公司产品混入 OriginAI/JAcoworks 文案。

## 推荐验证命令

```bash
cd ~/JAcoworks/website
cargo check
cargo test
```

## 回滚点

website 更新独立发布；如果下载页或后台异常，回滚 website 部署，不影响 gateway 和当前 OriginAI 客户端。

---

# 阶段 5：Electron 发布体系接原 releases / release_assets

## 目标

复用原 JAcoworks 发布表和后台，建立 OriginAI Electron 构建、上传、登记、更新检查闭环。

## 工作项

1. 明确 `release_assets.platform` 规范，例如：
   - `darwin-arm64`
   - `darwin-x64`
   - `win32-x64`
   - `linux-x64`
   - `linux-arm64`
2. Electron build 输出产物。
3. 计算 electron-updater 需要的 sha512。
4. 上传产物到 COS/object storage。
5. 写入 `releases` / `release_assets`。
6. 设置 `is_latest = true`。
7. gateway `/api/desktop/release/latest*.yml` 返回真实 sha512，不再使用 placeholder。
8. 验证已安装旧版本 OriginAI 能检查到更新。

## 验收门禁

- [ ] macOS arm64 release 产物可安装启动。
- [ ] Windows release 产物可安装启动，若本阶段支持 Windows。
- [ ] release_assets 每个平台有正确 download_url、file_size、sha512/signature。
- [ ] `latest-mac.yml` 返回真实 sha512。
- [ ] feed 中 `url` 能正确解析到下载文件。
- [ ] 客户端 update check 成功，不报 hash mismatch。
- [ ] 后台可查看该 release 和 assets。
- [ ] 回滚 latest 到上一版本可操作。

## 推荐验证命令

```bash
bun run electron:dist:mac

# 检查 feed
curl -sf -H "Authorization: Bearer $TOKEN" \
  https://jacoapi.jingao.club/api/desktop/release/latest-mac.yml

curl -sf -H "Authorization: Bearer $TOKEN" \
  https://jacoapi.jingao.club/api/desktop/release/latest
```

## 回滚点

release 表中 `is_latest` 可切回上一版本；对象存储产物不删除，先通过 DB latest 回滚。

---

# 阶段 6：system skills 复用与发布

## 目标

复用原 JAcoworks system skills，但让 OriginAI 新 runtime 能正确拉取、安装、执行。

## 工作项

1. 盘点原 `vm-agent/skills` 中哪些 skills 仍适配新 runtime。
2. 复制或同步可复用的 skills 到明确源目录，例如当前项目 `skills/` 或继续由原仓维护。
3. 复用或改造 `push-skills.sh` 上传到 `skill_files`。
4. OriginAI Desktop 登录后拉取 system/user skills。
5. 验证 workspace skills cache 和 runtime skill discovery。
6. 对依赖旧 vm-agent 特定工具的 skills 标记为 classic-only 或改造。

## 验收门禁

- [ ] `skill_files` 中 system owner 有预期 skills。
- [ ] OriginAI 登录后能拉取 system skills。
- [ ] 至少 3 个核心办公 skills 在新 runtime 中可被发现。
- [ ] 不兼容旧 vm-agent 的 skills 有明确标记或已移除。
- [ ] `push-skills` 可重复执行且 checksum 稳定。

## 推荐验证命令

```bash
# 原仓或当前仓，取决于最终维护位置
bash deploy/push-skills.sh

# 当前项目
bun test packages/origincoworks/src/__tests__/skill-writeback.test.ts
bun test packages/origincoworks/src/__tests__/required-sources.test.ts
```

## 回滚点

保留上一版 system skills checksum；如新 skills 引发 runtime 问题，可回滚 `skill_files` 到上一批上传内容。

---

# 阶段 7：生产联调与发布前总门禁

## 目标

确认 OriginAI + 原 JAcoworks 后端体系可以作为新版本端到端运行。

## 总体验收门禁

### 后端

- [ ] 原 gateway `go test ./...` 通过。
- [ ] 原 website `cargo check` / 关键测试通过。
- [ ] 生产 DB migrations 无待执行项或已记录。
- [ ] `/health` 正常。
- [ ] 登录、用户信息、desktop config、release feed、feedback、audit endpoint 正常。

### Desktop

- [ ] macOS 本地安装包可启动。
- [ ] 登录原 JAcoworks 账号成功。
- [ ] 获取 gateway LLM config 成功。
- [ ] 新建 session 可跑一次最小 agent 对话。
- [ ] Classic session 列表可显示。
- [ ] Logout 后 token 清理。
- [ ] update check 成功。

### WebUI

- [ ] 登录页品牌为 OriginAI。
- [ ] 原 JAcoworks 账号登录成功。
- [ ] WebSocket/RPC 鉴权通过。
- [ ] 不同用户 backend/config dir 隔离。
- [ ] Logout tear down 或失效 session。

### CLI

- [ ] CLI help 品牌为 OriginAI。
- [ ] CLI login 成功。
- [ ] CLI token 写入 OriginAI 配置目录。
- [ ] CLI 能连接 server 或执行基本命令。

### 管理后台

- [ ] 原 `/admin` 可登录。
- [ ] users/settings/releases/providers/feedback/audit 关键页面可打开。
- [ ] release set latest 后 OriginAI update feed 反映变化。

### 安全与兼容

- [ ] 没有新接口绕过 auth。
- [ ] 没有把 gateway admin token 写入客户端。
- [ ] 非 LLM secrets 不从 `/api/desktop/config` 泄露。
- [ ] 旧客户端必要接口仍可用或明确 410 Gone。
- [ ] OriginAI 文案不再混用 YouBox。

## 推荐总验证命令

```bash
# 当前项目
bun run typecheck:all
bun run test:shared:all
bun run webui:build
bun run electron:build

# 原 gateway
cd ~/JAcoworks/gateway && go vet ./... && go test ./...

# 原 website
cd ~/JAcoworks/website && cargo check
```

## 发布判定

只有所有 P0/P1 门禁满足后，才允许：

- 更新官网下载入口。
- 设置 OriginAI release 为 latest。
- 推送给真实用户。

---

# 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| 维护两份 gateway | 后续功能分叉、线上行为不一致 | 原 gateway 是唯一生产 source of truth，当前 gateway 只作 patch 来源 |
| Electron updater 与 Tauri updater 不兼容 | 发布失败或更新失败 | 两套 updater endpoint 并存，release_assets 增加平台规范 |
| OriginAI 改名破坏本地数据 | 用户登录态/历史 session 丢失 | 数据目录迁移/fallback，保留旧 env 和 deeplink alias |
| `/api/desktop/config` 泄露非 LLM secret | 安全事故 | 保持 redaction 测试，禁止返回 GitHub/Feishu/tool tokens |
| system skills 依赖旧 vm-agent | 新 runtime 执行失败 | 逐个验收核心 skills，不兼容标记 classic-only |
| 官网先改但发布没闭环 | 用户下载不可用版本 | 下载页更新必须晚于 release feed 验收 |

---

# 推荐最终任务拆分

1. `gateway-api-diff`：产出原 gateway 缺口表。
2. `gateway-desktop-endpoints`：把必要 desktop endpoints 合入原 gateway。
3. `originai-rename-aliases`：当前项目 OriginAI 命名和兼容 alias。
4. `originai-gateway-e2e`：Desktop/WebUI/CLI 接原 gateway 端到端。
5. `website-download-originai`：旧 website 下载页和文档更新。
6. `electron-release-pipeline`：Electron 发布、上传、release_assets 登记、update feed。
7. `system-skills-sync`：复用并验收 system skills。
8. `production-release-gate`：总验收与发布。
