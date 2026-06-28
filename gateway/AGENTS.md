# Gateway — 桌面端管控面网关

> `gateway` (jingao `:8847`) 是 JAcoworks 桌面端与管理后台共用的管控面 API，负责认证、桌面会话 CRUD、LLM 配置下发、memory / skills / cron / feedback / games，以及系统设置与激活码管理。WebChat、oc-gateway、云端运行时已迁至 `jaco-cloud`；本仓仅保留少量历史路由作为 `410 Gone` 兼容桩。`OcGatewayURL` 配置仍然有效，用于飞书 Bot 将消息转发到 `jaco-cloud` 侧的聊天入口。

## 代码结构

```
cmd/gateway/main.go            入口：路由注册、DB settings 热加载、PostHog、Feishu SSO

internal/
  agent/
    types.go                   事件类型定义
    ws_ticket.go               桌面端 WS ticket 签发/校验 (HMAC-SHA256, 30s TTL)
  audit/logger.go              审计日志写入
  auth/
    middleware.go              鉴权与管理员校验
    handlers.go                登录 / 激活码注册 / 登出 / 飞书 SSO
    feishu/                    Goth Feishu Provider
  config/config.go             YAML + env override；含 LLM、PostHog、OcGatewayURL、历史 PiVM 元数据
  feishubot/
    client.go                  飞书 API 客户端
    handler.go                 webhook、cron 通知、转发到 jaco-cloud
  games/handler.go             游戏画廊 API
  github/client.go             GitHub Issue / 附件上传
  middleware/middleware.go     PanicRecovery / RequestID / RequestLog
  store/
    pg.go                      PostgreSQL 连接
    users.go                   用户与绑定信息
    sessions.go                聊天会话 CRUD
    containers.go              历史容器元数据；`/api/cowork/container-status` 仍在使用
    invites.go                 激活码
    settings.go                `system_settings`
    memory.go                  记忆同步
    skills.go                  技能 CRUD / 校验和 / 拉取
    games.go                   游戏元数据
    cron.go                    云端定时任务
    providers.go               `llm_providers` / `llm_models`
    bot_config.go              历史容器配置记录（保留 DB 兼容）
```

## API 端点

### 活跃端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/feishu/webhook` | 飞书 Bot webhook，无需认证 |
| POST | `/api/auth/login` | 用户名/邮箱 + 密码登录 |
| POST | `/api/auth/activate` | 激活码注册 |
| GET | `/api/auth/feishu` | 飞书 SSO 入口 |
| GET | `/api/auth/feishu/callback` | 飞书 SSO 回调 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/users/me` | 当前用户 |
| GET/POST/PUT/DELETE | `/api/sessions[/{id}]` | 桌面端会话 CRUD |
| GET | `/api/agent/config` | 下发 LLM 配置、默认模型与 provider |
| GET | `/api/desktop/config` | 下发桌面 LLM 配置（省略 exa/tavily/fal/mineru/jimeng/asset/ai_search/openai 等非 LLM 密钥） |
| GET | `/api/desktop/classic-sessions` | 只读列出当前用户在 `chat_sessions` 中的历史会话（空则 `[]`） |
| GET | `/api/desktop/policy` | 桌面端角色与能力策略 |
| POST | `/api/desktop/audit` | 桌面端审计上报（写入 `audit_logs`，需认证，204） |
| POST | `/api/memory/sync` | 记忆双向同步 |
| GET | `/api/memory/stats` | 记忆统计 |
| DELETE | `/api/memory` | 清空用户记忆 |
| GET | `/api/skills` | 技能列表 |
| PUT | `/api/skills/{skillId}` | 创建/更新用户技能 |
| DELETE | `/api/skills/{skillId}` | 删除用户技能 |
| POST | `/api/skills/upload` | 旧版 system skill 上传接口；`push-skills.sh` 仍使用 |
| GET | `/api/skills/checksum` | 旧版技能校验和接口 |
| GET | `/api/skills/pull` | 旧版 system skills 拉取接口 |
| GET | `/api/cowork/container-status` | 返回历史容器记录状态；旧桌面客户端仍会查询 |
| POST | `/api/cron/announce` | 接收 sidecar / runtime 的定时任务结果并推送飞书 |
| POST | `/api/cron/jobs` | 创建云端定时任务 |
| GET | `/api/cron/jobs` | 列出用户定时任务 |
| DELETE | `/api/cron/jobs/{id}` | 删除定时任务 |
| POST | `/api/cron/jobs/{id}/run` | 手动触发定时任务（stub） |
| GET | `/api/cron/jobs/{id}/history` | 查询执行历史（stub） |
| GET | `/api/games` | 游戏列表（公开） |
| POST | `/api/games/deploy` | 上传游戏包 |
| DELETE | `/api/games/{id}` | 删除游戏 |
| POST | `/api/feedback` | 提交桌面端反馈并同步 GitHub Issue |
| POST | `/api/agent/ws-ticket` | 桌面端 ticket 签发 |
| POST | `/api/admin/invite-codes` | 创建激活码（管理员） |
| GET | `/api/admin/invite-codes` | 列出激活码（管理员） |
| GET | `/api/admin/settings` | 读取系统设置（管理员） |
| PUT | `/api/admin/settings` | 更新系统设置并热重载（管理员） |
| GET | `/health` | 健康检查 |

### `410 Gone` 兼容桩

以下路由已迁到 `jaco-cloud` 或已不再由本仓实现。它们保留在 `gateway` 中，仅用于让旧客户端得到明确的 `410 Gone` 响应，而不是误以为超时或 404：

| 方法 | 路径 | 现状 |
|------|------|------|
| POST | `/api/cowork/provision` | 已迁至 `jaco-cloud` |
| POST | `/api/oc/ws-ticket` | 已迁至 `jaco-cloud` |
| GET | `/ws/oc` | 已迁至 `jaco-cloud` |
| GET | `/api/oc/stream` | 已迁至 `jaco-cloud` |
| POST | `/api/oc/send` | 已迁至 `jaco-cloud` |
| GET | `/api/oc/status` | 已迁至 `jaco-cloud` |
| GET | `/api/teams` | 已迁至 `jaco-cloud` |
| POST | `/api/teams/install` | 已迁至 `jaco-cloud` |
| GET | `/api/admin/containers` | 已迁至 `jaco-cloud` |
| GET | `/api/admin/templates` | 已迁至 `jaco-cloud` |
| POST | `/api/admin/containers/{id}/start` | 已迁至 `jaco-cloud` |
| POST | `/api/admin/containers/{id}/stop` | 已迁至 `jaco-cloud` |
| POST | `/api/admin/containers/{id}/sync-config` | 已迁至 `jaco-cloud` |
| POST | `/api/admin/containers/{id}/install-template` | 已迁至 `jaco-cloud` |
| POST | `/api/admin/containers/{id}/restart` | 已迁至 `jaco-cloud` |
| GET | `/api/admin/logs` | 已迁至 `jaco-cloud` |

## 环境变量

`gateway.yaml` 支持 YAML + `GATEWAY_*` env override：

```yaml
server:
  port: 8847
  host: "0.0.0.0"
  public_url: "https://jacoapi.jingao.club"

auth:
  admin_token: ""
  feishu_client_id: ""
  feishu_client_secret: ""
  session_ttl_hours: 720

database:
  url: "postgresql://...@127.0.0.1:5432/jacoworks"

llm:
  proxy_url: "https://api.xiaomao.chat"
  proxy_key: ""

github:
  token: ""
  repo: ""

posthog:
  api_key: ""
  endpoint: ""

oc_gateway_url: "https://chat.jingao.club"

openclaw:               # 历史键名；config.go 仍映射到 PiVMConfig，供 legacy 容器元数据使用
  image: "pi-ready"
  port: 18789
  host_ip: ""
  base_port: 18800
  data_root: "/srv/jacoworks/openclaw"
```

说明：

- LLM 真实运行时配置优先来自 DB `system_settings`，YAML 只作示例或开发默认值。
- `oc_gateway_url` 仅用于飞书 Bot 把消息转发到 `jaco-cloud`，不代表本仓仍承载 oc-gateway。
- `openclaw` / `PiVMConfig` 仍需保留，因历史容器记录与 `/api/cowork/container-status` 还在依赖其命名约定。

常用环境变量：

- `GATEWAY_DATABASE_URL`
- `GATEWAY_SERVER_PUBLIC_URL`
- `GATEWAY_AUTH_SESSION_TTL_HOURS`
- `GATEWAY_GITHUB_TOKEN` / `GATEWAY_GITHUB_REPO`
- `GATEWAY_POSTHOG_API_KEY` / `GATEWAY_POSTHOG_ENDPOINT`
- `GATEWAY_OC_GATEWAY_URL`

## CORS

- 允许 Tauri 桌面端 origin：`tauri://localhost`、`https://tauri.localhost`
- 允许本地开发：`http://localhost:*`、`127.0.0.1`、`::1`
- 允许官网后台：`https://jaco.jingao.club`
- 本仓默认不再为 `chat.jingao.club` 维护专门浏览器 CORS 规则

## 日志与可观测性

- **zerolog**：终端使用 `ConsoleWriter`，systemd / journald 走结构化 JSON
- **中间件链**：`PanicRecovery → RequestID → RequestLog → CORS → mux`
- **request_id**：自动写入响应头 `X-Request-ID`
- **PostHog**：`posthog-go` 客户端可被后台设置热重载
- **Feishu 转发**：Feishu Bot 转发到 `jaco-cloud` 时会记录请求 URL、user_id 与错误信息
- **journald 查询**：`journalctl -u jacoworks-gateway -f`

## 测试

```bash
go vet ./...
go test ./...
```

主要覆盖：auth、handlers、config、`ws_ticket`、store、feishu bot、games 与各 API 路径。文档改动无需额外 E2E；改动网关行为时以 `go test ./...` 为最低验证标准。

## 开发规范

- **Go 标准** + golangci-lint
- **桌面端管控面优先**：这里不是 WebChat 后端，不再继续增加云端运行时细节
- **配置集中管理**：敏感配置统一由 DB `system_settings` 管理，启动加载 + 热重载
- **Feishu 云端对话是转发，不是本地实现**：若问题落在 `OcGatewayURL` 对端，请到 `jaco-cloud` 排查
- **历史 410 路由不要随意删除**：它们用于老版本客户端的明确错误提示与迁移过渡
- **本地开发**：`make dev-gateway` → `localhost:8847`
- **部署**：`make deploy-jingao`（gateway + website），`make push-skills` 负责 system skills 入库

## 新增 system_settings 配置项 Checklist

新增配置项必须同时修改四处，缺一不可：

- [ ] `deploy/sql/0XX_*.sql` 迁移 + 更新 `003_system_settings.sql` seed
- [ ] `gateway/cmd/gateway/main.go` 启动加载 switch case + `updateSettingsHandler` allowedKeys + 热重载
- [ ] `gateway/internal/config/config.go` 结构体字段 + env override
- [ ] `website/src/routes/admin/settings.rs` `UpdateSettingsForm` 字段 + `is_secret_key()` + 提交处理
- [ ] 线上 DB 执行迁移 SQL (`sudo -u postgres psql -d jacoworks`)
