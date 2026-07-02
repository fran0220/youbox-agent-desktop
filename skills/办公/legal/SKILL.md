---
name: 法律助手
description: >
  法律文书审查与建议。
  Review contracts, triage NDAs, assess legal risks, and draft legal memos from local document files. Use when the user asks to review a contract, check an NDA, analyze legal terms, flag risks, suggest redlines, or prepare legal summaries.
---

# Legal Skill

Assist with legal document review and risk triage by reading local document files (.docx/.pdf) and producing structured analysis. This is a **triage and drafting aid** — all outputs require review by qualified legal counsel.

⚠️ **MANDATORY DISCLAIMER**: Always include at the end of every legal analysis output:
> This analysis is for internal triage and drafting purposes only. It does not constitute legal advice. All findings, risk assessments, and suggested edits must be reviewed and approved by qualified legal counsel before any action is taken.

## Capabilities & Limitations

**Can do:**
- Read contracts/NDAs from local .docx/.pdf files
- Clause-by-clause risk analysis with severity classification
- Generate redline suggestions with rationale
- NDA quick triage checklist
- Summarize key terms and obligations
- Flag missing standard clauses
- Compare two document versions

**Cannot do:**
- Access legal databases (Westlaw, LexisNexis, etc.)
- Provide jurisdiction-specific legal opinions
- Make compliance determinations (regulatory, tax, securities)
- Handle litigation matters, M&A due diligence, or regulatory filings

**Stop conditions** — Recommend escalation to counsel when:
- Active or threatened litigation is involved
- Regulatory filing or compliance certification is required
- M&A, securities, or investment matters
- Criminal law, immigration, or labor disputes
- Multi-jurisdiction conflicts of law

---

## Contract Review Workflow

### Step 1: Read the Document

Use bash to run a mammoth/pdf-parse script to extract text, then analyze:

```javascript
import mammoth from 'mammoth';
const { value } = await mammoth.extractRawText({ path: 'contract.docx' });
console.log(value);
```

### Step 2: Ask for Context (if not provided)

Before analysis, establish:
- **Contract type**: SaaS agreement, services contract, NDA, licensing, employment, vendor/procurement
- **Our role**: buyer or seller / disclosing or receiving party
- **Jurisdiction**: if not stated in the document, ask
- **Company standards**: any existing playbook, fallback positions, or must-have terms

### Step 3: Clause-by-Clause Analysis

For each material clause, produce a structured assessment:

#### Risk Classification

| Level | Meaning | Action |
|-------|---------|--------|
| 🟢 GREEN | Acceptable as-is or minor observation | No change needed |
| 🟡 YELLOW | Deviates from standard, negotiate | Suggest revision |
| 🔴 RED | Unacceptable risk, escalate | Must change or reject |
| ⚫ MISSING | Standard clause absent | Flag for addition |

#### Analysis Format

For each clause found in the document, output:

```
### [Clause Name] — [🟢/🟡/🔴]

**Current language:** "[exact quote from document]"

**Assessment:** [What this clause means and why it matters]

**Risk:** [Specific risk to our organization]

**Suggested revision:** "[proposed alternative language]"
- Priority: Must-have / Should-have / Nice-to-have
- Rationale: [why this change matters]
- Fallback: [acceptable compromise if counterparty pushes back]
```

#### Standard Clauses to Check

Always review these categories (flag as ⚫ MISSING if absent):

| Category | Key Issues |
|----------|-----------|
| **Term & Termination** | Duration, auto-renewal, termination for convenience, cure periods |
| **IP Ownership** | Work product ownership, background IP, license grants, license scope |
| **Confidentiality** | Scope of confidential info, exceptions, duration, return/destruction |
| **Data Protection** | Personal data handling, GDPR/PIPL compliance, sub-processors, breach notification |
| **Liability** | Cap on liability, exclusions (consequential, indirect), carve-outs |
| **Indemnification** | Scope, IP indemnity, mutual vs one-way, process requirements |
| **Representations & Warranties** | Scope, disclaimer, survival period |
| **Governing Law & Dispute** | Jurisdiction, arbitration vs litigation, venue |
| **Assignment** | Consent requirements, change of control |
| **Force Majeure** | Covered events, notice requirements, termination right |
| **Insurance** | Required coverage types and amounts |

---

## NDA Quick Triage

For NDAs, use this fast checklist:

```markdown
## NDA Triage: [Document Name]

- [ ] **Type**: Mutual / One-way (we disclose / we receive)
- [ ] **Definition of Confidential Info**: Broad / Narrow / Marked-only
- [ ] **Exclusions**: Standard 5 exceptions present? (public domain, prior knowledge, independent development, third party, compelled disclosure)
- [ ] **Term**: ___ years confidentiality obligation
- [ ] **Permitted Use**: Limited to stated purpose?
- [ ] **Permitted Disclosure**: Employees / advisors / affiliates — need-to-know basis?
- [ ] **Return/Destruction**: Required on termination?
- [ ] **Residuals Clause**: Present? (allows use of general knowledge)
- [ ] **Non-Solicitation**: Present? Scope?
- [ ] **Governing Law**: ___
- [ ] **IP Carve-out**: No IP transfer via NDA?
- [ ] **Injunctive Relief**: Stated?

**Overall**: 🟢 Standard / 🟡 Review needed / 🔴 Non-standard, escalate
**Notes**: [specific concerns]
```

---

## Output Formats

### Full Contract Review
Generate as a structured markdown output with:
1. Executive Summary (1 paragraph: what this contract does, key risks, recommendation)
2. Key Terms Table (parties, term, value, governing law)
3. Clause-by-Clause Analysis (per format above)
4. Risk Summary Table (all clauses with risk levels)
5. Recommended Next Steps
6. Disclaimer

### Redline Document
If user requests a redline .docx:
- Use the `docx` npm package to create a new document
- Include original and suggested language with comments (using Comment API)
- Follow the document-processing skill's docx write pattern

### Comparison Report
When comparing two versions:
- Read both documents
- Identify added, removed, and modified clauses
- Output a diff-style comparison with risk assessment of changes

---

## Best Practices

- **Read the full document** before starting analysis — don't analyze clause-by-clause in isolation
- **Quote exactly** — always reference the specific language from the document
- **Be specific about risk** — not just "this is risky" but "this exposes us to X because Y"
- **Provide alternatives** — every YELLOW/RED should have a suggested revision
- **Consider both sides** — note where the counterparty's position may be reasonable
- **Flag ambiguity** — unclear or vague terms are often the highest risk
- **Assumptions section** — explicitly state what you're assuming about our role, jurisdiction, and risk tolerance
