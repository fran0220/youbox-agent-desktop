---
name: browser
description: >
  Automates web pages through the bundled agent-browser CLI. Use when the user
  asks to open a page, click or fill elements, take screenshots, inspect DOM
  state, reuse Chrome login sessions, or perform browser-based workflows via bash.
---

# Browser

Use the bundled `agent-browser` CLI through `bash`.

## When To Use

- Use for opening pages, clicking, typing, filling forms, taking screenshots, reading page content, or running JS in the page.
- Prefer this over `content-extract` when the page is interactive, login-protected, or needs screenshots.
- Prefer `--auto-connect` when the user likely needs their existing Chrome session and cookies.

## Standard Workflow

Use this sequence unless there is a better reason not to:

```bash
agent-browser --auto-connect open <url>
agent-browser --auto-connect wait --load networkidle
agent-browser --auto-connect snapshot -i
agent-browser --auto-connect screenshot ./page.png
agent-browser --auto-connect click @e3
agent-browser --auto-connect fill @e5 "text"
agent-browser --auto-connect get text @e1
agent-browser --auto-connect close
```

## Best Practices

- Start with `snapshot -i` before clicking or filling so you can use stable refs like `@e1` and `@e2`.
- After navigation or a major DOM update, take a fresh snapshot before reusing old refs.
- Use `wait --load networkidle`, `wait --text`, or `wait --fn` when the page is slow or reactive.
- Save screenshots into the workspace when the user needs proof, debugging, or visual review.

## Reusing User Login State

For logged-in sites, prefer Chrome auto-connect:

```bash
agent-browser --auto-connect open https://example.com/dashboard
```

This reuses the user's running Chrome session, cookies, and login state.

## First-Time Setup

If the browser runtime is not installed yet:

```bash
agent-browser install
```

Then rerun the workflow.

## Common Commands

### Open and inspect a page

```bash
agent-browser open https://example.com
agent-browser wait --load networkidle
agent-browser snapshot -i
```

### Click a referenced element

```bash
agent-browser click @e3
```

### Fill a form field

```bash
agent-browser fill @e5 "fan@example.com"
```

### Type with key events

```bash
agent-browser type @e5 "hello world"
```

### Read text

```bash
agent-browser get text @e1
```

### Read page title or URL

```bash
agent-browser get title
agent-browser get url
```

### Run JavaScript

```bash
agent-browser eval "document.title"
```

### Wait for content

```bash
agent-browser wait --load networkidle
agent-browser wait --text "Welcome back"
agent-browser wait --fn "window.appReady === true"
```

### Take screenshots

```bash
agent-browser screenshot ./page.png
agent-browser screenshot --full ./full-page.png
agent-browser screenshot --annotate ./annotated-page.png
```

### Close the session

```bash
agent-browser close
```

## Command Chaining

The CLI supports chaining with `&&` because the browser persists through its daemon:

```bash
agent-browser --auto-connect open https://example.com && \
agent-browser --auto-connect wait --load networkidle && \
agent-browser --auto-connect snapshot -i
```

Use this for short deterministic flows. For longer tasks, separate commands are often easier to inspect.

## Useful Extras

### Interactive-only snapshot

```bash
agent-browser snapshot -i
```

### Annotated screenshot for debugging

```bash
agent-browser screenshot --annotate ./debug.png
```

### Persistent profile

```bash
agent-browser --profile ./browser-profile open https://example.com
```

### JSON output

```bash
agent-browser --json snapshot -i
```

## Troubleshooting

- If a command says the browser is missing, run `agent-browser install`.
- If an element ref stops working after navigation, run `snapshot -i` again to get fresh refs.
- If a site requires login, retry with `--auto-connect`.
- If a page is still loading, wait with `wait --load networkidle` or `wait --text "..."` before the next action.
- If selectors are brittle, prefer `@eN` refs from snapshots instead of hand-written CSS.

## Quick Reference

| Goal | Command |
|------|---------|
| Open page | `agent-browser open <url>` |
| Reuse logged-in Chrome | `agent-browser --auto-connect open <url>` |
| Wait for load | `agent-browser wait --load networkidle` |
| Inspect elements | `agent-browser snapshot -i` |
| Click | `agent-browser click @e3` |
| Fill | `agent-browser fill @e5 "text"` |
| Read text | `agent-browser get text @e1` |
| Screenshot | `agent-browser screenshot ./page.png` |
| Run JS | `agent-browser eval "document.title"` |
| Install runtime | `agent-browser install` |
| Help | `agent-browser --help` |
