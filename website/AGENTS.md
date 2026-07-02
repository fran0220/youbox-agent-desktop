# Website — Rust 官网 + 管理后台

> Axum :9527, jingao 同机, OpenResty 反代 jaco.jingao.club。当前仓库是 OriginAI 官网、下载页、反馈、游戏画廊与管理后台的 source of truth。`/api/update/:target/:arch/:version` 仅作为 legacy Tauri updater 兼容接口保留；OriginAI Electron 更新 feed 由 gateway `/api/desktop/release/latest*.yml` 提供。

## 代码结构

```
src/
  main.rs                      Axum 入口, 路由注册, admin 登录/登出
  config.rs                    TOML 配置 (website.toml)
  db.rs                        sqlx PgPool 工厂
  error.rs                     AppError → IntoResponse
  auth.rs                      Admin cookie 认证 + AdminUser 提取器 (bcrypt + sha256 双格式)
  models/                      user, invite, release, feedback, audit, session, auth_session, game, skill, provider
  routes/
    pages.rs                   首页 / 下载 / 关于
    chat.rs                    /chat → React SPA (注入 auth token; 嵌入模式，主入口已迁移到 chat.jingao.club)
    docs.rs                    文档渲染 (Markdown → HTML)
    feedback.rs                反馈表单 (公开)
    games.rs                   游戏画廊 (gallery + play 页面)
    update.rs                  Legacy Tauri updater API (GET /api/update/:target/:arch/:version)
    admin/
      mod.rs                   Admin 路由组
      dashboard.rs             统计仪表盘
      users.rs                 用户 CRUD
      invites.rs               激活码管理 (创建/列表/撤销)
      releases.rs              版本发布 (CRUD + 安装包上传)
      containers.rs            容器管理 (代理 Gateway API)
      feedback.rs              反馈管理 (回复/状态变更)
      audit.rs                 审计日志 (分页+筛选)
      settings.rs              系统设置 (LLM 密钥管理, 网关/DB 状态, 模型列表)
      skills.rs                技能管理 (上传/列表/删除)
      providers.rs              模型配置 (LLM Provider/Model CRUD)
      bots.rs                   Bot 管理 (OpenClaw 容器状态/配置同步/重启)
  services/
    docs.rs                    Markdown 解析 + TOC + 导航树
    gateway.rs                 Gateway Admin API HTTP 客户端 (容器管理 + 配置同步 + 日志)

templates/                     Askama HTML 模板
  base.html                    公开页面布局 (Tailwind + HTMX CDN)
  chat.html                    React SPA 壳 (注入 __GATEWAY_URL__ / __AUTH_TOKEN__, 加载 webchat JS)
  pages/{index,download,about}.html
  docs/{layout,index}.html     文档三栏布局
  feedback.html                反馈表单
  games/{gallery,play}.html    游戏画廊 + 游戏播放页
  admin/
    login.html                 管理登录 (独立布局)
    layout.html                管理后台布局 (深色侧边栏)
    {dashboard,users,invites,releases,release_edit}.html
    {containers,feedback_list,audit,settings,skills}.html
    {providers,bots}.html        模型配置 + Bot 管理
    partials/bot_row.html        Bot 行内更新 (HTMX partial)

static/css/style.css           自定义样式
static/js/app.js               平台检测 + Toast + HTMX 事件
static/chat/                   webchat React SPA 构建产物 (chat.js + CSS)
content/                       Markdown 文档源文件
```

## 环境变量

**website.toml** (env override `WEBSITE_*`):
```toml
cookie_secret = "32-byte-hex-string"
[server]
host = "0.0.0.0"
port = 9527
[database]
url = "postgresql://...@127.0.0.1:5432/jacoworks"
[gateway]
url = "http://localhost:8847"
admin_token = "your-admin-token"
[site]
name = "OriginAI"
description = "Agent-native AI 工作台"
base_url = "https://jaco.jingao.club"
```

**安装包分发**: 下载 URL 存储在 DB `release_assets.download_url`，指向腾讯云 COS (`jingao-1350796151.cos.ap-beijing.myqcloud.com`)。Website 不再托管静态安装包文件。

## 测试

```bash
# Rust smoke tests (验证关键路由可达)
cargo test
```

`tests/smoke_routes.rs` — 覆盖 10 条关键路由的 HTTP 状态码检查。

## 开发规范

- **Rust Axum + Askama + sqlx + pulldown-cmark**
- **模板**: Askama HTML 模板 + Tailwind CDN + HTMX
- **共享 PostgreSQL**: 与 Gateway 共享 jingao 本地数据库
- **容器操作代理**: 容器管理通过 Gateway Admin API 代理
- 开发: `make dev-website` → localhost:9527
- 部署 (桌面端管控面): `make deploy-jingao` → gateway + website
- 部署 (仅官网): `make deploy-website` → SSH jingao 远程编译 + 重启
