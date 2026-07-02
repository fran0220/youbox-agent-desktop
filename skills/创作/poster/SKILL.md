---
name: 海报生成
description: >
  生成专业海报，12种类型×25种视觉风格，含 VLM 审查。
  Generates professional posters with 12 poster types and 25 visual styles.
  Analyzes content, recommends type×style combinations, generates publication-ready posters,
  and reviews output with Gemini Flash vision model for text accuracy and aesthetic quality.
  Use when user asks to create "poster", "海报", "宣传图", "key visual", or "banner".
---

# Poster Generator

Two dimensions: **poster type** (information architecture & purpose) × **style** (visual aesthetics). Freely combine any type with any style.

## Usage

```bash
/poster "AI 产品发布会海报"
/poster "音乐节海报" --type event-concert --style cyberpunk-neon
/poster "励志名言海报" --aspect square --lang zh
/poster content.md --type product-launch --resolution 4K
```

## Options

| Option | Values |
|--------|--------|
| `--type` | 12 options (see Poster Type Gallery), default: auto-detect |
| `--style` | 25 options (see Style Gallery), default: swiss-typography |
| `--aspect` | 2:3 (default), 3:4, 1:1, 9:16, 16:9, 11:17, A4 |
| `--lang` | en, zh, ja, etc. |
| `--resolution` | 1K (draft), 2K, 4K (final) |
| `--no-review` | Skip VLM review step |

## Poster Type Gallery

| Type | Best For |
|------|----------|
| `movie-cinematic` | 电影海报、影视宣传、剧集关键视觉 |
| `event-concert` | 演唱会、音乐节、活动宣传 |
| `product-launch` | 产品发布、新品上市、科技产品 |
| `travel-destination` | 旅行目的地、旅游宣传 |
| `motivational` | 励志名言、鸡汤、引言海报 |
| `sports-event` | 体育赛事、运动会、比赛 |
| `social-cause` | 公益、环保、社会议题 |
| `exhibition-gallery` | 展览、画廊、艺术展 |
| `food-restaurant` | 美食、餐厅、菜品推广 |
| `tech-conference` | 科技大会、开发者峰会、论坛 |
| `music-album` | 音乐专辑封面、EP、单曲 |
| `educational` | 教育科普、知识海报、课程宣传 |

Full definitions: `references/poster-types/<type>.md`

## Style Gallery

### Poster-Specific Styles (5)

| Style | Description |
|-------|-------------|
| `film-noir` | 黑色电影风格，高对比度，阴影戏剧化 |
| `swiss-typography` | 瑞士国际主义排版，网格严谨 (default) |
| `art-deco` | 装饰艺术，几何对称，金色点缀 |
| `brutalist` | 粗野主义，粗重字体，原始质感 |
| `vintage-retro` | 复古怀旧，做旧纹理，暖色调 |

### Shared Styles (from infographic, 20)

| Style | Description |
|-------|-------------|
| `craft-handmade` | 手绘手作，纸张质感 |
| `claymation` | 3D 黏土，定格动画 |
| `kawaii` | 日系可爱，粉彩 |
| `storybook-watercolor` | 水彩绘本，柔和 |
| `chalkboard` | 粉笔黑板 |
| `cyberpunk-neon` | 赛博朋克，霓虹 |
| `bold-graphic` | 漫画风，半调网点 |
| `aged-academia` | 复古学术，棕褐 |
| `corporate-memphis` | 扁平矢量，商务 |
| `technical-schematic` | 蓝图，工程制图 |
| `origami` | 折纸，几何 |
| `pixel-art` | 像素复古 8-bit |
| `ui-wireframe` | 灰度线框 |
| `subway-map` | 地铁图风格 |
| `ikea-manual` | 极简线条 |
| `knolling` | 整齐平铺 |
| `lego-brick` | 乐高积木 |
| `pop-laboratory` | 实验室网格 |
| `morandi-journal` | 莫兰迪手账 |
| `retro-pop-grid` | 70s 复古波普 |

Shared style definitions: `../infographic/references/styles/<style>.md`
Poster-specific style definitions: `references/styles/<style>.md`

## Recommended Combinations

| Scenario | Type + Style |
|----------|-------------|
| 科幻电影 | `movie-cinematic` + `cyberpunk-neon` |
| 产品发布 | `product-launch` + `swiss-typography` |
| 文艺展览 | `exhibition-gallery` + `art-deco` |
| 音乐节 | `event-concert` + `bold-graphic` |
| 美食推荐 | `food-restaurant` + `craft-handmade` |
| 科技峰会 | `tech-conference` + `brutalist` |
| 环保公益 | `social-cause` + `storybook-watercolor` |
| 复古旅行 | `travel-destination` + `vintage-retro` |
| 运动赛事 | `sports-event` + `bold-graphic` |
| 励志名言 | `motivational` + `swiss-typography` |
| 专辑封面 | `music-album` + `film-noir` |
| 教育科普 | `educational` + `corporate-memphis` |

## Keyword Shortcuts

| User Keyword | Type | Recommended Styles | Default Aspect |
|--------------|------|--------------------|----------------|
| 电影海报 / movie poster | `movie-cinematic` | `film-noir`, `cyberpunk-neon` | 2:3 |
| 演唱会 / concert / 音乐节 | `event-concert` | `bold-graphic`, `cyberpunk-neon` | 11:17 |
| 产品发布 / product launch | `product-launch` | `swiss-typography`, `brutalist` | 2:3 |
| 励志 / motivational / 名言 | `motivational` | `swiss-typography`, `aged-academia` | 2:3 |
| 展览 / exhibition / 画展 | `exhibition-gallery` | `art-deco`, `swiss-typography` | 2:3 |
| 美食 / food / 餐厅 | `food-restaurant` | `craft-handmade`, `morandi-journal` | 3:4 |

## Poster Sizes

See `references/sizes.md` for full size mapping.

| User Says | Aspect | Use Case |
|-----------|--------|----------|
| 默认 / 竖版海报 | 2:3 | 标准电影/活动海报 |
| 方形 / square | 1:1 | 社交媒体、专辑封面 |
| 手机屏 / story | 9:16 | 手机壁纸、Story |
| 横版 / banner | 16:9 | 数字屏幕、横幅 |
| A4 / 打印 | ~1:1.414 | 打印海报 |

## Output Structure

```
poster/{topic-slug}/
├── analysis.md
├── structured-content.md
├── prompts/poster.md
├── poster.png               ← 最终海报
└── review.md                ← VLM 审查报告 (可选)
```

Slug: 2-4 words kebab-case from topic. Conflict: append `-YYYYMMDD-HHMMSS`.

## Core Principles

- **文字优先**: 海报中的文字是第一公民，必须清晰可读
- **层次分明**: 标题 > 副标题 > 正文 > 细节，视觉层次明确
- **留白有度**: 关键信息区域留出安全边距
- **风格统一**: 色彩、字体、图形元素保持一致性

## Workflow

### Step 1: Setup & Analyze

**1.1 Load Preferences (EXTEND.md)**

Use Bash to check EXTEND.md existence (priority order):

```bash
# Check project-level first
test -f .jacoworks/skills/poster/EXTEND.md && echo "project"

# Then user-level
test -f "$HOME/.jacoworks/skills/poster/EXTEND.md" && echo "user"
```

| Path | Location |
|------|----------|
| `.jacoworks/skills/poster/EXTEND.md` | Project directory |
| `$HOME/.jacoworks/skills/poster/EXTEND.md` | User home |

| Result | Action |
|--------|--------|
| Found | Read, parse, display summary |
| Not found | Use defaults, continue |

**EXTEND.md Supports**: Preferred type/style | Default aspect | Brand colors | Logo path | Language

**1.2 Analyze Content → `analysis.md`**

1. Parse user request: extract topic, text content, target audience, mood
2. Identify poster text elements:
   - **Title** (主标题): 1-8 words, the hero text
   - **Subtitle** (副标题): optional, 5-15 words
   - **Body** (正文): optional, key details
   - **CTA** (行动号召): date/location/URL/QR
3. Detect language
4. Save analysis

### Step 2: Generate Structured Content → `structured-content.md`

Transform into poster structure:

1. **Hero Zone** (40-50% of poster): Main visual + title
2. **Info Zone** (30-40%): Subtitle, key details, supporting visuals
3. **Action Zone** (10-20%): CTA, date, location, logos

**Rules**: Text must be concise. Maximum ~50 words total on poster. Every word earns its space.

### Step 3: Recommend Combinations

**3.1 Check Keyword Shortcuts first**: If user input matches a keyword, auto-select type and prioritize styles.

**3.2 Otherwise**, recommend 3-5 type×style combinations based on:
- Content purpose → matching poster type
- Mood/tone → matching style
- Target audience
- User design instructions

### Step 4: Confirm Options

Use **single confirmation** to get all choices:

| Question | When | Options |
|----------|------|---------|
| **Combination** | Always | 3+ type×style combos with rationale |
| **Aspect** | Always | 2:3, 3:4, 1:1, 9:16, 16:9 |
| **Resolution** | Always | 1K (draft), 2K (medium), 4K (final) |
| **Language** | If ambiguous | Language for text content |

### Step 5: Generate Prompt → `prompts/poster.md`

**Backup rule**: If `prompts/poster.md` exists, rename to `prompts/poster-backup-YYYYMMDD-HHMMSS.md`

Combine:
1. Poster type definition from `references/poster-types/<type>.md`
2. Style definition from `references/styles/<style>.md` or `../infographic/references/styles/<style>.md`
3. Base template from `references/base-prompt.md`
4. Size specification from `references/sizes.md`
5. Structured content from Step 2
6. All text in confirmed language

### Step 6: Generate Image

1. **Check for existing file**: If `poster.png` exists, rename to `poster-backup-YYYYMMDD-HHMMSS.png`
2. Call asset-gateway:

```bash
asset-gateway generate image --prompt "$(cat prompts/poster.md)" --size 1024x1024 --output-dir .
```

3. On failure, auto-retry once with simplified prompt

### Step 7: VLM Review (unless `--no-review`)

Use Gemini 3 Flash as vision model to review the generated poster.

**Review method**: Read the generated `poster.png` image and evaluate against the checklist in `references/review-checklist.md`.

**Review dimensions** (score 1-10 each):

| Dimension | Check |
|-----------|-------|
| **Text Legibility** | 所有文字清晰可读，无截断、无重叠 |
| **Text Accuracy** | 拼写正确，语言正确，无乱码 |
| **Layout Balance** | 视觉重心稳定，留白合理 |
| **Color Harmony** | 配色协调，对比度充足 |
| **Style Consistency** | 风格统一，无混搭违和 |
| **Overall Aesthetics** | 整体美学，专业程度 |

**Decision logic**:
- Average ≥ 7 且无单项 < 5 → ✅ **通过**，输出 `review.md`
- 否则 → ⚠️ **需修改**，根据低分项调整 prompt，回到 Step 6 重试（最多 2 次）

**Review prompt template**:
```
Review this poster image. Score each dimension 1-10:
1. Text Legibility: Are all texts clearly readable?
2. Text Accuracy: Any spelling errors or garbled text?
3. Layout Balance: Is the visual weight balanced?
4. Color Harmony: Do colors work well together?
5. Style Consistency: Is the style unified?
6. Overall Aesthetics: Professional quality?

For any score below 5, explain what's wrong and suggest fixes.
Output JSON: {"scores": {...}, "average": N, "pass": bool, "issues": [...]}
```

### Step 8: Output Summary

Report: topic, type, style, aspect, resolution, review scores, output path, files created.

## References

- `references/base-prompt.md` - Prompt template
- `references/sizes.md` - Size specifications
- `references/review-checklist.md` - VLM review criteria
- `references/poster-types/<type>.md` - 12 poster type definitions
- `references/styles/<style>.md` - 5 poster-specific style definitions
- `../infographic/references/styles/<style>.md` - 20 shared style definitions

## Extension Support

Custom configurations via EXTEND.md:

```markdown
## Poster Preferences

- preferred-type: product-launch
- preferred-style: swiss-typography
- default-aspect: 2:3
- default-resolution: 2K
- brand-colors: ["#1a1a2e", "#00d9ff", "#ffffff"]
- logo-path: ./assets/logo.png
- language: zh
```
