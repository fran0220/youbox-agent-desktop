---
name: 内容提取
description: >
  URL 内容提取与转换。
  Extracts the readable contents of a specific public URL with curl-based
  fetching and cleanup. Use when the user already gave an exact link and wants
  the page content, not for general web research or interactive browser tasks.
---

# Content Extract — URL 内容提取

把 URL → 可读 Markdown，带质量检测和降级策略。

## 适用边界

- 仅用于“已经有具体 URL，要读这篇内容”的场景。
- **不要**用于通用网络调研、找资料、追最新信息；这类需求应优先使用 `ai-search`。
- **不要**用于需要登录态、点击交互、截图、等待前端渲染的页面；这类需求应优先使用 `browser`。

## 工作流（Decision Tree）

输入：`url`

### Step 1: Domain 预判

如果 URL 属于高概率反爬/动态站点，直接告知用户可能无法获取：
- `mp.weixin.qq.com` — 微信公众号
- `zhuanlan.zhihu.com` / `zhihu.com` — 知乎
- `xhslink.com` / `xiaohongshu.com` — 小红书
- `weibo.com` — 微博

对这些站点，建议用户直接粘贴内容或提供截图。

### Step 2: Fetch（curl）

用 bash 获取页面内容：

```bash
curl -sL -m 30 -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "<URL>" 2>/dev/null | head -c 80000
```

### Step 3: 质量检测

判断返回内容是否可用（见 `references/heuristics.md`）：

**接受条件**：
- HTTP 200 且有实际正文内容
- 内容长度 > 800 字符（文章类）
- 不包含反爬/验证码特征文本

**拒绝条件**（需告知用户）：
- 403/401/429 — 访问被拒
- 包含 "环境异常"、"完成验证"、"验证码"、"请在微信客户端打开" 等
- 内容极短或全是导航/页脚
- 超时无响应

### Step 4: 内容清理

如果返回的是 HTML：
- 提取 `<article>`, `<main>`, 或主体 `<div>` 中的文本
- 去除 `<script>`, `<style>`, `<nav>`, `<footer>`, 广告元素
- 保留标题层级、链接、列表、代码块结构
- 转换为 Markdown 格式

### Step 5: 输出

以清洁 Markdown 呈现给用户，标注来源 URL。

## 降级策略

如果 curl 获取失败：
1. 告知用户该页面无法直接获取
2. 建议替代方案：
   - 使用 `ai-search` 搜索该页面标题、站点名或缓存线索
   - 使用 `browser` 打开页面（如果问题是登录态、动态渲染或交互拦截）
   - 请用户粘贴页面内容
   - 请用户提供截图（如果是图文内容）

## References

- 质量检测规则: `references/heuristics.md`
