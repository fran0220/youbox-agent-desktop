---
name: 营销助手
description: >
  营销文案与策略生成。
  Create marketing content, review brand voice consistency, plan campaigns, and analyze SEO. Use when the user asks to write blog posts, draft emails, create social media content, plan marketing campaigns, review brand voice, audit SEO, or generate marketing copy.
---

# Marketing Skill

Assist with marketing content creation, brand voice management, campaign planning, and SEO analysis. Operates on local files and uses web_search for public research.

## Capabilities & Limitations

**Can do:**
- Draft content: blog posts, email sequences, social media posts, newsletters, landing page copy
- Brand voice review and consistency checks
- SEO keyword research and content optimization (via web_search)
- Campaign planning with timelines and channel strategy
- Competitive content analysis (via web_search + web_fetch)
- Generate formatted content documents (DOCX/HTML)
- A/B copy variant generation

**Cannot do:**
- Access ad platforms (Google Ads, Meta Ads, etc.)
- Access CRM or marketing automation (HubSpot, Klaviyo, Mailchimp)
- Access analytics platforms (Google Analytics, Amplitude)
- Publish content directly
- Generate images or design assets

---

## Brand Voice

### Establishing Brand Voice

If no brand guide exists, help the user define one. Ask for:

1. **Sample content**: 3-5 pieces of existing content that represent the desired voice
2. **Audience**: who they're writing for
3. **Personality attributes**: pick 3-5 from:

| Attribute Spectrum |
|---|
| Formal ←→ Casual |
| Serious ←→ Playful |
| Technical ←→ Accessible |
| Reserved ←→ Bold |
| Corporate ←→ Personal |

4. **Tone rules**: specific do's and don'ts

### Brand Voice Document Format

Store as `brand-voice.md` in workspace:

```markdown
# Brand Voice Guide

## Personality
- [Attribute 1]: [description + example]
- [Attribute 2]: [description + example]
- [Attribute 3]: [description + example]

## Audience
- Primary: [description]
- Secondary: [description]

## Tone Rules
### Always
- [rule + example]

### Never
- [rule + counter-example]

## Vocabulary
### Preferred Terms
| Instead of | Use |
|-----------|-----|
| users | customers |
| buy | get started |

### Banned Words
- [word]: [reason]

## Examples
### Good ✅
> [example paragraph in brand voice]

### Bad ❌
> [same content written wrong, with notes on why]
```

### Voice Consistency Review

When reviewing content for brand voice:
1. Read the brand-voice.md if it exists in workspace
2. Check every paragraph against tone rules
3. Flag specific phrases that violate the guide
4. Provide corrected alternatives

---

## Content Creation

### Blog Post Structure

```markdown
# [Title — keyword-optimized, under 60 chars]

**Meta description:** [150-160 chars, includes primary keyword]

## [Introduction — hook + problem statement + what reader will learn]

[2-3 sentences. Start with a question, statistic, or bold claim.]

## [H2 Section 1 — primary keyword variation]

[Content. Use short paragraphs (2-4 sentences). Include relevant data.]

### [H3 Subsection if needed]

## [H2 Section 2]

## [H2 Section 3]

## [Conclusion — summary + CTA]

[What to do next. Clear single CTA.]

---
**Word count:** [target]
**Primary keyword:** [keyword]
**Secondary keywords:** [keyword1, keyword2]
**Internal links:** [suggest 2-3 relevant pages]
```

### Email Sequence

```markdown
## Email Sequence: [Campaign Name]

**Goal:** [conversion goal]
**Audience:** [segment]
**Trigger:** [what starts the sequence]

### Email 1: [Subject Line] — Day 0
- **From:** [name]
- **Subject:** [A/B variants]
  - A: [subject]
  - B: [subject]
- **Preview text:** [40-90 chars]
- **Body:**
  [email content]
- **CTA:** [button text + link description]

### Email 2: [Subject Line] — Day 3
[same structure]

### Email 3: [Subject Line] — Day 7
[same structure]
```

### Social Media Post

```markdown
## [Platform]: [Topic]

**Post:**
[content — respect platform character limits]

**Hashtags:** [3-5 relevant]
**Media:** [describe image/video needed]
**CTA:** [action]
**Best posting time:** [day/time based on platform]

**Character count:** X/Y limit
```

Platform limits:
| Platform | Limit | Best Practice |
|----------|-------|--------------|
| Twitter/X | 280 chars | 200-250 for engagement |
| LinkedIn | 3,000 chars | 150-300 for feed posts |
| Instagram | 2,200 chars | First 125 chars visible |
| WeChat | 20,000 chars | 1,500-3,000 optimal |

---

## SEO Analysis

### Keyword Research Process

1. **Seed keywords**: user provides 3-5 core topics
2. **Web research**: use web_search to find:
   - Related search terms and questions
   - Competitor content ranking for these terms
   - "People also ask" patterns
3. **Keyword map**: organize into clusters

```markdown
## Keyword Research: [Topic]

### Primary Keywords
| Keyword | Est. Competition | Content Type | Priority |
|---------|-----------------|--------------|----------|
| [keyword] | High/Med/Low | Blog/Landing/Guide | P1/P2/P3 |

### Long-tail Keywords
| Keyword | Parent Topic | Intent |
|---------|-------------|--------|
| [long-tail keyword] | [primary] | Informational/Transactional |

### Content Gaps
- [topic competitors cover that we don't]
```

### On-Page SEO Checklist

When reviewing existing content:

```markdown
## SEO Audit: [Page Title]

- [ ] **Title tag**: under 60 chars, includes primary keyword
- [ ] **Meta description**: 150-160 chars, compelling, includes keyword
- [ ] **H1**: one per page, includes primary keyword
- [ ] **H2/H3 structure**: logical hierarchy, includes secondary keywords
- [ ] **Keyword density**: primary keyword appears naturally (1-2%)
- [ ] **First paragraph**: keyword appears in first 100 words
- [ ] **Internal links**: 2-5 relevant links to other pages
- [ ] **External links**: 1-3 authoritative sources
- [ ] **Image alt text**: descriptive, includes keyword where natural
- [ ] **URL structure**: short, includes keyword, uses hyphens
- [ ] **Content length**: competitive with top results (check via web_search)
- [ ] **Readability**: short paragraphs, subheadings every 300 words
```

---

## Campaign Planning

### Campaign Brief Format

```markdown
# Campaign Brief: [Campaign Name]

## Overview
- **Objective:** [specific, measurable goal]
- **Audience:** [target segment]
- **Timeline:** [start date — end date]
- **Budget:** [if known]
- **Success Metrics:** [KPIs]

## Messaging
- **Key message:** [one sentence]
- **Supporting points:**
  1. [point]
  2. [point]
  3. [point]
- **Tone:** [per brand voice guide]

## Channel Plan
| Channel | Content Type | Frequency | Owner | Status |
|---------|-------------|-----------|-------|--------|
| Blog | Article | 2x/month | [name] | Draft |
| Email | Sequence | 3 emails | [name] | Planning |
| LinkedIn | Posts | 3x/week | [name] | Planning |
| WeChat | Article | 1x/week | [name] | Planning |

## Timeline
| Week | Milestone | Deliverables |
|------|-----------|-------------|
| W1 | Planning | Brief, content calendar |
| W2-3 | Creation | Draft content for all channels |
| W4 | Review | Brand voice review, approval |
| W5 | Launch | Publish, distribute |
| W6-8 | Optimize | Monitor, adjust, report |

## Content Calendar
| Date | Channel | Content | Status |
|------|---------|---------|--------|
| [date] | [channel] | [title/description] | [status] |
```

---

## Output Formats

### Content Documents
- **Markdown**: default for drafts (easy to review and iterate)
- **DOCX**: for formal deliverables (use docx package)
- **HTML**: for email templates with inline styles

### Reports
- **HTML**: SEO audits, campaign plans (with tables and formatting)
- **XLSX**: content calendars, keyword research data

---

## Best Practices

- **Read existing content first**: check workspace for brand-voice.md, previous content, style guides
- **Web research before writing**: use web_search to understand current landscape, competitor content
- **One CTA per piece**: every content piece should have a single, clear call-to-action
- **Localization awareness**: for Chinese market content, adapt cultural references and platform choices (WeChat > LinkedIn, Xiaohongshu > Instagram)
- **A/B variants**: always provide 2-3 subject line / headline options
- **Data-driven**: reference specific numbers, statistics, and research when possible
- **Iterate**: first draft is fast, then refine based on feedback — don't over-polish the first pass
