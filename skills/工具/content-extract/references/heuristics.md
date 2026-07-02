# Extraction heuristics (probe → fallback)

This file defines **when to accept fetch output** vs **when to report failure**.

## Accept when

- HTTP status is 200 and extracted content has meaningful body text.
- Content length > 800 chars for articles (adjust by site).
- Does NOT look like a captcha/interstitial page.

## Report failure when

### Domain blocklist (skip fetch)
If URL host matches the blocklist (WeChat, Zhihu, Xiaohongshu, etc.), advise user
that direct extraction is unlikely to work.

### Obvious interstitial / anti-bot patterns

If fetched content contains any of:
- "环境异常"
- "完成验证"
- "拖动下方滑块"
- "验证码"
- "请在微信客户端打开"
- "访问过于频繁"
- "Just a moment..." (Cloudflare)
- "Enable JavaScript" (JS-required pages)

### Content too thin / nav-only

- Content length < 800 chars and URL is expected to be an article.
- Extracted text is mostly navigation items / footer.

### Fetch failure

- curl returns 401/403/429/5xx.
- curl times out.

## Fallback suggestions

When extraction fails, suggest to the user:
1. Paste the content directly into the chat
2. Provide a screenshot (for image-heavy content)
3. Try a cached version via web search
