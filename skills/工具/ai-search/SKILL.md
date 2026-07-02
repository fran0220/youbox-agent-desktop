---
name: ai-search
description: >
  Searches the web using the built-in web_search tool.
  Use when the user asks for fresh information, web research, recent news,
  documentation lookup, or current facts.
---

# Web Search

Use the built-in `web_search` tool directly — do NOT use `ai-search` CLI through bash.

## Quick Search

```
web_search(query="latest Bun release notes")
```

## AI Summary

```
web_search(query="how does bun build --compile work", mode="answer")
```

## More Results

```
web_search(query="vector database benchmark 2026", num=8)
```

## Choosing Mode

| Mode | Use when |
|------|----------|
| `fast` | Default. Quick factual lookups, docs, news |
| `answer` | Need a synthesized summary or direct answer |

## Response Handling

- The tool returns formatted text with source URLs
- Quote or summarize results for the user instead of dumping raw text
- Cite the most relevant URLs in your answer
- If search fails, explain that web search is temporarily unavailable

## Notes

- Do NOT use `ai-search` CLI through bash — use `web_search` tool directly
- Do NOT use mode `deep` — it is slow and rarely needed
- For specific URL content extraction, use `content-extract` skill instead
- For sites needing login, use `browser` skill instead
