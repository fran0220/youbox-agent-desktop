# Vendored Design Content Pack

Source repository: https://github.com/nexu-io/open-design

Source commit: `f24bda9c97cf80a7d95c118ea7a5bbcdfe69f30d`

License summary: upstream open-design is Apache-2.0. The two copied upstream deck templates ship per-directory MIT LICENSE files, preserved verbatim in `templates/guizang-ppt/LICENSE` and `templates/html-ppt/LICENSE`. Copied skill directories that ship upstream MIT licenses also preserve them verbatim: `skills/brutalist-skill/LICENSE`, `skills/gpt-tasteskill/LICENSE`, `skills/minimalist-skill/LICENSE`, and `skills/web-design-guidelines/LICENSE`.

## Curated contents

### Templates

- `guizang-ppt`: kept `assets/template.html`, core reference guides, and the upstream MIT LICENSE. Dropped README translations, example slides, and non-runtime prose bloat.
- `html-ppt`: kept the deck starter, core CSS/runtime/animation assets, selected reusable single-page layouts, selected high-signal themes, references, and the upstream MIT LICENSE. Dropped screenshots, demo media, generated docs montages, shell render scripts, and exhaustive theme/layout demos.
- `blank-prototype` and `blank-doc`: minimal in-house starters, not upstream content.

### Design systems

Selected 12 high-signal `DESIGN.md` systems for stylistic diversity: Arc, Canva, Hugging Face, Mistral AI, Notion, Perplexity, Stripe, Vercel, OpenAI, Material, Neo Brutalism, and Editorial. Rejected generic or near-duplicate systems where the guidance was thin, style-only, or redundant with the selected set.

### Skills

Selected 8 substantive skills that can operate locally from their `SKILL.md` instructions: impeccable design polish, design brief parsing, motion polish, high-taste visual critique, brutalist interfaces, minimalist interfaces, frontend design, and web design guidelines. Rejected thin catalogue-pointer entries whose bodies only route users to upstream repositories, plus provider-specific media generation skills requiring external authenticated services outside this pack. Open Design `od:` and `triggers:` frontmatter extensions were moved into body text, leaving loader-compatible `name` and `description` frontmatter.

## One-time byte-diff verification

At vendoring time, upstream LICENSE files were verified byte-identical against `/tmp/od-vendor-probe/open-design` at the commit above. Copied design-system `DESIGN.md` files and selected template/runtime/reference files were copied directly from that snapshot; intentional differences are the documented trims, generated `template.json` files, in-house blank templates, manifest, and adapted skill frontmatter/body formatting.
