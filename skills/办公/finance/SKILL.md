---
name: 财务分析
description: >
  财务报表分析与建议。
  Analyze financial data from local spreadsheets, perform variance analysis, prepare journal entries, reconciliations, and generate financial reports. Use when the user asks to analyze budgets, compare actuals vs forecast, reconcile accounts, prepare financial statements, or generate finance reports from Excel/CSV files.
---

# Finance Skill

Assist with financial analysis and reporting by reading local spreadsheet files (XLSX/CSV) and producing structured outputs. All computations use Node.js scripts executed via bash.

⚠️ **MANDATORY DISCLAIMER**: Always include at the end of every financial analysis output:
> This analysis is for internal reference and drafting purposes only. All financial figures, calculations, and recommendations must be verified by qualified accounting/finance personnel before use in official reporting, filings, or decision-making.

## Capabilities & Limitations

**Can do:**
- Read financial data from local XLSX/CSV files
- Variance analysis (budget vs actual vs forecast)
- Financial statement generation (P&L, balance sheet summaries)
- Reconciliation workpapers
- Journal entry preparation and validation
- Ratio analysis and KPI computation
- Trend analysis and period-over-period comparisons
- Export formatted reports as XLSX or HTML

**Cannot do:**
- Connect to ERP/accounting systems (SAP, NetSuite, QuickBooks, etc.)
- Access general ledger databases
- Make GAAP/IFRS compliance determinations
- Provide tax advice or prepare tax filings
- Perform audit sign-offs

**Context to establish first:**
- Accounting standard (GAAP / IFRS / local standard)
- Currency and number format
- Fiscal year period (calendar year or custom)
- Materiality thresholds (if applicable)

---

## Variance Analysis

The most common financial analysis task. Framework:

### Three-Way Comparison

```
| Line Item | Budget | Actual | Forecast | Bud Var ($) | Bud Var (%) | Fct Var ($) | Fct Var (%) |
```

### Variance Decomposition

For revenue variances, decompose into **Price × Volume**:

```javascript
// Price/Volume decomposition
function priceVolumeVariance(budgetPrice, budgetVolume, actualPrice, actualVolume) {
  const budgetRevenue = budgetPrice * budgetVolume;
  const actualRevenue = actualPrice * actualVolume;
  const totalVariance = actualRevenue - budgetRevenue;

  const priceVariance = (actualPrice - budgetPrice) * actualVolume;
  const volumeVariance = (actualVolume - budgetVolume) * budgetPrice;
  const mixVariance = totalVariance - priceVariance - volumeVariance;

  return { totalVariance, priceVariance, volumeVariance, mixVariance };
}
```

For headcount/compensation variances, decompose into **Rate × Headcount**:

```javascript
function rateHeadcountVariance(budgetRate, budgetHC, actualRate, actualHC) {
  return {
    rateVariance: (actualRate - budgetRate) * actualHC,
    headcountVariance: (actualHC - budgetHC) * budgetRate,
    total: actualRate * actualHC - budgetRate * budgetHC,
  };
}
```

### Materiality Rules

- Flag variances exceeding thresholds (default: >10% AND >$10K absolute)
- Always show both percentage AND absolute variance
- Sort by absolute variance descending — biggest items first
- Require narrative explanation for material variances

### Variance Narrative Format

```markdown
**[Line Item]**: Actual $X vs Budget $Y, variance $(Z) or N%

**Driver:** [root cause — what happened]
**Impact:** [downstream effect on P&L or cash]
**Action:** [what's being done about it, or if one-time/recurring]
```

---

## Reconciliation

### Workflow

1. Read source data (GL extract, bank statement, subledger) from XLSX/CSV
2. Match records by amount, date, reference number
3. Identify unmatched items
4. Produce reconciliation workpaper

### Reconciliation Workpaper Format

```markdown
## Account Reconciliation: [Account Name] — [Period]

**Prepared by:** [name]  **Date:** [date]
**Reviewed by:** ________  **Date:** ________

### Summary
| Source | Balance |
|--------|---------|
| GL Balance | $XXX |
| Subledger/Bank Balance | $YYY |
| **Difference** | **$ZZZ** |

### Reconciling Items
| # | Date | Description | Amount | Type | Status |
|---|------|-------------|--------|------|--------|
| 1 | 2026-01-15 | Timing — check in transit | $5,000 | Timing | Expected to clear by 01/20 |
| 2 | 2026-01-18 | Unrecorded bank fee | ($25) | Adjustment needed | JE required |

### Adjusted Balance
GL Balance: $XXX
+ Timing items: $A
+ Adjustments: $B
= Adjusted Balance: $XXX

Bank/Subledger Balance: $YYY
+ Timing items: $C
+ Adjustments: $D
= Adjusted Balance: $YYY

**Reconciled:** ☐ Yes / ☐ No — Difference: $___
```

### Matching Script Pattern

```javascript
function reconcile(sourceA, sourceB, matchKeys = ['amount', 'date']) {
  const matched = [];
  const unmatchedA = [...sourceA];
  const unmatchedB = [...sourceB];

  for (let i = unmatchedA.length - 1; i >= 0; i--) {
    const idx = unmatchedB.findIndex(b =>
      matchKeys.every(k => String(unmatchedA[i][k]) === String(b[k]))
    );
    if (idx !== -1) {
      matched.push({ a: unmatchedA[i], b: unmatchedB[idx] });
      unmatchedA.splice(i, 1);
      unmatchedB.splice(idx, 1);
    }
  }
  return { matched, unmatchedA, unmatchedB };
}
```

---

## Journal Entry Preparation

### Format

```markdown
## Journal Entry: [Description]

**Date:** [effective date]  **Period:** [fiscal period]
**Prepared by:** [name]  **Approved by:** ________

| Account Code | Account Name | Debit ($) | Credit ($) | Memo |
|--------------|-------------|-----------|------------|------|
| 4100-100 | Revenue — Product | | 50,000 | Q1 revenue accrual |
| 1200-100 | Accounts Receivable | 50,000 | | Customer ABC |
| **Total** | | **50,000** | **50,000** | |

**Supporting documentation:** [reference to source]
**Reversal required:** Yes / No  **Reversal date:** ___
```

### Validation Rules

Always validate before presenting:
- Total debits = total credits (must balance)
- No zero-amount lines
- Account codes follow consistent format
- Effective date within open period
- Memo/description for every line

---

## Financial Ratios

Common ratios to compute when analyzing financial data:

| Category | Ratio | Formula |
|----------|-------|---------|
| **Liquidity** | Current Ratio | Current Assets / Current Liabilities |
| | Quick Ratio | (Current Assets - Inventory) / Current Liabilities |
| **Profitability** | Gross Margin | (Revenue - COGS) / Revenue |
| | Operating Margin | Operating Income / Revenue |
| | Net Margin | Net Income / Revenue |
| **Efficiency** | DSO | (AR / Revenue) × Days |
| | DPO | (AP / COGS) × Days |
| | Inventory Turns | COGS / Average Inventory |
| **Leverage** | Debt/Equity | Total Debt / Total Equity |

---

## Output Formats

### XLSX Report
Use exceljs to create formatted reports:
- Summary sheet with key metrics and conditional formatting
- Detail sheet with full data
- Charts sheet (basic exceljs charts if applicable)
- Bold headers, number formatting (accounting style), freeze panes

### HTML Report
Self-contained HTML with:
- Summary table at top
- SVG charts for trends/comparisons (follow data-analysis skill chart patterns)
- Detailed tables below
- Print-friendly CSS

---

## Best Practices

- **Tie-out everything**: totals must reconcile across all views of the data
- **Show assumptions**: explicitly state period, currency, rounding, materiality threshold
- **Period consistency**: ensure comparing like-for-like periods (same # of days, same scope)
- **Reasonableness check**: does the result make business sense? Flag anomalies
- **Audit trail**: show where every number comes from (source file, row, column)
- **Version control**: include "as of" date and data source in all outputs
- **Sensitive data**: financial data is confidential — don't include in conversation summaries, keep in files
