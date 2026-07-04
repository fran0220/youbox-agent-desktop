# Themes catalog

Every theme is a short CSS file in `assets/themes/` that overrides tokens
defined in `assets/base.css`. Switch themes by changing the `href` of
`<link id="theme-link">` or by pressing **T** if the deck has a
`data-themes="a,b,c"` attribute on `<body>` or `<html>`.

All themes define the same variables: `--bg`, `--bg-soft`, `--surface`,
`--surface-2`, `--border`, `--text-1/2/3`, `--accent`, `--accent-2/3`,
`--good`, `--warn`, `--bad`, `--grad`, `--grad-soft`, `--radius*`, `--shadow*`,
`--font-sans`, `--font-display`.

This vendored pack intentionally ships a trimmed set of six theme files. Only
use the names listed below unless you also add the matching CSS file under
`assets/themes/`.

## Shipped themes

| name | description | when to use |
|---|---|---|
| `minimal-white` | 极简白，克制高级。Inter，强文字层级，极低阴影。 | 内部汇报、一对一技术评审、不抢内容的严肃话题 |
| `editorial-serif` | 杂志风 Playfair 衬线 + 奶油底。 | 品牌故事、文字密度大的长文演讲 |
| `soft-pastel` | 柔和马卡龙三色渐变。 | 产品发布、面向消费者、轻松话题 |
| `arctic-cool` | 蓝/青/石板灰 浅色版。 | 商业分析、金融、冷静理性 |
| `tokyo-night` | Tokyo Night 蓝夜。 | 偏冷技术分享、基础设施 |
| `neo-brutalism` | 厚描边、硬阴影、明黄 accent。 | 创业路演、敢说敢做的调性 |

## How to apply

```html
<link rel="stylesheet" id="theme-link" href="../assets/themes/tokyo-night.css">
```

Or enable `T`-cycling by listing themes on the body:

```html
<body data-themes="minimal-white,editorial-serif,soft-pastel,arctic-cool,tokyo-night,neo-brutalism" data-theme-base="../assets/themes/">
```

## How to extend

Copy an existing theme, rename it, and override only the variables you want to
change. Keep each theme under ~200 lines. Prefer adjusting tokens to adding
new selectors.
