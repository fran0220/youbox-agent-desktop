# Deploy — 当前生产控制面 Schema 与部署说明

> 本目录维护当前 JAcoworks-Next / OriginAI 生产控制面的 SQL schema、测试数据、发布脚本与基础设施说明。旧 `~/JAcoworks` 仓库只作为历史归档，不再作为生产 source of truth。WebChat、oc-gateway、Incus VM、`pi-ws-wrapper` 等云端运行时已拆分到 `jaco-cloud`，不再由本仓的部署文档详述。LLM 运行时网关统一使用 `https://api.xiaomao.chat`；实际密钥由 DB `system_settings` 管理。

## SQL Schema 文件

| 文件 | 说明 |
|------|------|
| `sql/001_init_business_tables.sql` | 全量基础 schema：`users`、`auth_sessions`、`chat_sessions`、`containers`、`invite_codes`、`audit_logs` |
| `sql/002_website_tables.sql` | 官网表：`releases`、`release_assets`、`feedback` |
| `sql/003_system_settings.sql` | `system_settings` 表与默认 seed |
| `sql/004_memory_and_skills.sql` | `user_memory` + 历史 `skill_files` |
| `sql/005_games.sql` | 历史 `games` |
| `sql/006_add_host_port.sql` | `containers.host_port` |
| `sql/007_frozen_to_paused.sql` | `containers.status` 值迁移 |
| `sql/008_cron_jobs.sql` | 历史 `cron_jobs` |
| `sql/009_posthog_settings.sql` | PostHog 配置项 |
| `sql/010_container_type.sql` | `containers.container_type` |
| `sql/011_container_type_unique.sql` | `containers` 唯一键改为 `(user_id, container_type)` |
| `sql/012_llm_providers.sql` | `llm_providers` |
| `sql/013_llm_models.sql` | `llm_models` |
| `sql/014_bot_config.sql` | `containers.config` / hash / pairing 状态等历史字段 |
| `sql/002_seed_test_data.sql` | 测试数据（管理员、普通用户、激活码） |

## 测试账号

| 用途 | 用户名 | 密码 | 角色 |
|------|--------|------|------|
| 管理员 | `admin@jacoworks.local` | 从安全渠道获取；不要写入仓库 | admin |
| E2E / 手工验证 | `e2e-tester` | 从安全渠道获取；不要写入仓库 | user |

测试激活码由测试 seed / 私有环境配置管理；不要在仓库文档中记录可用明文口令或长期有效激活码。

## 数据库

PostgreSQL 位于 jingao 本机 `127.0.0.1:5432/jacoworks`。

当前 `jacoworks` 仍依赖的核心表：

- `users`
- `auth_sessions`
- `chat_sessions`
- `containers`
- `invite_codes`
- `audit_logs`
- `system_settings`
- `user_memory`
- `skill_files`（历史兼容；桌面端不再从 gateway 同步 skills）
- `games`（历史兼容；gateway `/api/games*` 返回 410）
- `releases`
- `release_assets`
- `feedback`
- `cron_jobs`（历史兼容；gateway `/api/cron*` 返回 410）
- `llm_providers`
- `llm_models`

`user_id` 为 TEXT (`gen_random_uuid()::text`)；`updated_at` 由触发器自动更新。

## 基础设施

| 服务 | 位置 | 说明 |
|------|------|------|
| Rust 官网 | jingao `82.156.239.212` | `:9527`，OpenResty 反代 `jaco.jingao.club` |
| Go gateway | jingao `82.156.239.212` | `:8847`，OpenResty 反代 `jacoapi.jingao.club` |
| PostgreSQL | jingao 本机 | `127.0.0.1:5432/jacoworks` |
| 腾讯云 COS | ap-beijing | 安装包与 release 资产存储 |
| `win-build` VM | local `100.97.254.31` | Windows 构建机，需经 `local` 跳板访问 |
| LLM 网关 | `https://api.xiaomao.chat` | 运行时模型接入；密钥由 `system_settings` 管理 |

云端协作运行时、WebChat 与相关基础设施不再属于本仓部署范围，请参见 `jaco-cloud`。

## 部署

- **桌面端管控面**：`make deploy-jingao` → 部署 gateway + website 到 jingao
- **skills / automations**：以本地 workspace 与 Craft local automations 为准，不再部署到 gateway
- **完整控制面部署**：`make deploy` → `deploy-jingao`
- **Desktop 本地发布**：`make release V=1.5.0`

## OpenResty (jingao)

| 域名 | 后端 | 说明 |
|------|------|------|
| `jaco.jingao.club` | `localhost:9527` | Rust 官网 + 管理后台 |
| `jacoapi.jingao.club` | `localhost:8847` | 桌面端 API |

配置路径：容器内 `/usr/local/openresty/nginx/conf/conf.d/`

## Desktop 发布（本地全流程）

### 前置条件

```bash
cp deploy/.env.release.example deploy/.env.release
# 填入 COS_SECRET_ID/KEY, DB_PASSWORD, APPLE_*

ssh -L 5432:127.0.0.1:5432 jingao -N -f
```

### 完整发布流程

```bash
# 1. 提交并推送代码
git add <files> && git commit && git push origin main

# 2. Bump 版本号
make release-bump V=1.5.0

# 3. 构建 macOS 产物
make release-build V=1.5.0

# 4. 构建 Windows（见下方 win-build 流程）

# 5. 上传 COS + 注册 DB + 打 tag
make release-upload V=1.5.0
git push origin v1.5.0

# 6. 更新 Release Notes
# 管理后台或直接 SQL

# 7. 部署网站与网关
make deploy
```

### Windows 构建

`win-build` VM (`192.168.122.177`) 运行在 `local` (`100.97.254.31`) 上，需经跳板访问。账号使用 `builder`，密码从安全渠道获取并通过环境变量传入。

```bash
: "${WIN_BUILD_PASSWORD:?Set WIN_BUILD_PASSWORD from the secure password store}"
WIN_SSH="ssh local \"SSHPASS='${WIN_BUILD_PASSWORD}' sshpass -e ssh -o StrictHostKeyChecking=no builder@192.168.122.177\""

# 0. 检查 VM
ssh local 'virsh domifaddr win-build'

# 1. 更新代码与依赖
ssh local "SSHPASS='${WIN_BUILD_PASSWORD}' sshpass -e ssh -o StrictHostKeyChecking=no builder@192.168.122.177 \
  'cd C:\\build\\JAcoworks-Next && git remote set-url origin https://github.com/fran0220/JAcoworks-Next.git && git fetch origin && git reset --hard origin/main && bun install'"

# 2. 构建 NSIS 安装包
ssh local "SSHPASS='${WIN_BUILD_PASSWORD}' sshpass -e ssh -o StrictHostKeyChecking=no builder@192.168.122.177 \
  'cd C:\\build\\JAcoworks-Next\\apps\\electron && powershell -ExecutionPolicy Bypass -File scripts\\build-win.ps1'"

# 3. 拉回产物
mkdir -p dist-release/<version>/windows-x86_64
ssh local "SSHPASS='${WIN_BUILD_PASSWORD}' sshpass -e scp -o StrictHostKeyChecking=no \
  builder@192.168.122.177:'C:/build/JAcoworks-Next/apps/electron/release/OriginAI-x64.exe' /tmp/"
scp local:/tmp/OriginAI-x64.exe dist-release/<version>/windows-x86_64/
```

### Windows 构建 VM 信息

| 项目 | 值 |
|------|-----|
| VM 名称 | `win-build` |
| VM IP | `192.168.122.177` |
| OS | Windows 11 LTSC |
| 用户/密码 | `builder` / 从安全渠道获取，使用 `WIN_BUILD_PASSWORD` 环境变量 |
| 构建目录 | `C:\build\JAcoworks-Next` |
| 工具 | Git, Rust, Node.js 22, Bun, VS Build Tools, NSIS |
| 构建脚本 | `apps\electron\scripts\build-win.ps1` |
| SSH 方式 | 通过 `local` 跳板 + `sshpass` |

### 分步命令速查

```bash
make release-bump V=1.5.0
make release-build V=1.5.0
make release-upload V=1.5.0
make release V=1.5.0
```

产物目录：`dist-release/<version>/{darwin-aarch64,darwin-x86_64,windows-x86_64}/`
