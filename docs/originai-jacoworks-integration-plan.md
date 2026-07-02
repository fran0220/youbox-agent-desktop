# OriginAI 生产控制面迁移状态

## 当前结论（2026-07-01）

`JAcoworks-Next` 是后续开发与生产部署的唯一 source of truth。旧 `~/JAcoworks` 仓库只作为历史归档，不再作为 gateway、website/admin、deploy 或 release 脚本的维护来源。

生产环境仍可继续使用现有域名、数据库、COS bucket 与 systemd 服务名，以避免一次性基础设施改名带来的风险；但这些服务的代码来源必须切到当前仓库：

```diagram
╭────────────────────────────────────────────╮
│ 当前仓库：JAcoworks-Next                   │
│                                            │
│ apps/electron  Electron Desktop            │
│ gateway        Go control-plane API        │
│ website        Rust website/admin          │
│ deploy         SQL / systemd / release     │
│ skills         local/default skills source │
╰──────────────────────┬─────────────────────╯
                       │ deploy / release
                       ▼
╭────────────────────────────────────────────╮
│ 现有生产基础设施                            │
│                                            │
│ jacoapi.jingao.club → gateway :8847        │
│ jaco.jingao.club    → website :9527        │
│ PostgreSQL jacoworks                       │
│ COS jingao-1350796151                      │
╰────────────────────────────────────────────╯
```

## 已迁入当前仓库

- `gateway/`：OriginAI desktop config / policy / audit / feedback / release / memory / session 端点已在当前仓维护；skills / cron / games 仅保留 410 兼容桩。
- `website/`：原 Rust website/admin 已迁入当前仓，并保留下载页、release admin、feedback、settings、providers 等管理能力。
- `deploy/`：SQL schema、systemd、gateway/website 部署脚本、release 上传与 DB 登记脚本已迁入当前仓。
- `skills/`：default/local skills 源目录已迁入当前仓；不再通过 gateway 同步到桌面端 workspace。
- `Makefile`：当前仓提供 gateway + website + Electron desktop 的本地构建、验证、部署和 release 入口。
- `.agents/skills/releasing-desktop`：发版 skill 已改为只依赖当前仓。

## 仍保留的兼容边界

- 数据库名、表结构、域名、COS bucket 和 systemd service 名称暂不强制改名；它们是生产基础设施标识，不代表旧仓仍是代码来源。
- `packages/origincoworks`、`ORIGINCOWORKS_GATEWAY_URL`、`origincoworks://` 等命名保留为客户端兼容层。
- Website 的 `/api/update/:target/:arch/:version` 仅作为 legacy Tauri updater 兼容接口；OriginAI Electron 更新使用 gateway 的 `/api/desktop/release/latest*.yml`。
- Gateway 的部分 `410 Gone` 路由保留，用于老客户端获得明确迁移错误。

## 当前部署流

### 同步生产 checkout

`make deploy-sync` 会把生产 checkout 的 `origin` 指向当前仓库，并 reset 到 `origin/main`：

```bash
make deploy-sync
```

如果远端 `REPO_DIR` 已存在但不是 git checkout，脚本会停止并要求人工挪走，避免误删生产目录。

### 部署控制面

```bash
make deploy-gateway
make deploy-website
make deploy          # gateway + website
```

### 发布 Electron Desktop

```bash
cp deploy/.env.release.example deploy/.env.release
# 填入 COS_SECRET_ID/KEY、DB_PASSWORD、APPLE_*，并开启 DB SSH 隧道

make release-bump V=1.5.0
make release-build V=1.5.0
make release-upload V=1.5.0
git push origin v1.5.0
```

Release 脚本从当前仓的 `apps/electron` 构建，上传到 COS，并写入当前生产 DB 的 `releases` / `release_assets`。

## 验收门禁

### 代码级

```bash
cd gateway && go vet ./... && go test ./...
cd website && cargo check && cargo test
bun run typecheck:electron
bash -n deploy/release.sh
```

### 线上级

- `https://jacoapi.jingao.club/health` 返回 OK。
- `https://jaco.jingao.club/download` 显示 OriginAI 下载页，链接来自 DB `release_assets`。
- 管理后台可登录，release assets 可维护。
- 已安装旧版 OriginAI 能通过 gateway feed 检查更新、下载 COS 绝对 URL、校验 sha512 并重启安装。
- Gateway `/api/skills*`、`/api/cron*`、`/api/games*` 返回 410，桌面端 skills 与 automations 以本地 Craft workspace 为准。

## 风险与处理

| 风险 | 处理 |
|---|---|
| 生产 checkout 仍指向旧仓 | `make deploy-sync` 显式 `git remote set-url origin https://github.com/fran0220/JAcoworks-Next.git` |
| 文档或脚本继续要求改旧仓 | 视为错误；改当前仓对应文件 |
| 基础设施仍使用 `jacoworks` 命名 | 暂时接受为生产兼容标识；不要解读为旧仓依赖 |
| Electron updater hash mismatch | 确认 `release_assets.signature` 是上传产物的 base64 SHA-512 |
| default/local skills 与新 runtime 不兼容 | 在当前仓 `skills/` 或对应 workspace skills 中修正后随应用/工作区分发 |
