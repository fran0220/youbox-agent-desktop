---
name: 数据分析
description: >
  数据清洗、可视化与统计分析。
  Analyze local structured data files (CSV, Excel, JSON). Use when the user asks to analyze data, compute statistics, find trends, generate charts, create reports, pivot tables, or visualize data from local files.
---

# Data Analysis Skill

Analyze structured data from local files by writing and executing Node.js scripts. No database or cloud connectors — all operations run on local CSV/XLSX/JSON files.

**Workflow:** read data → normalize → compute → output artifacts (XLSX report / HTML chart / CSV summary).

## Capabilities & Limitations

**Can do:**
- Descriptive statistics (mean, median, mode, std dev, percentiles, quartiles)
- Correlations, trends, moving averages, growth rates
- Group-by aggregations, pivot-style summaries
- Filter, sort, deduplicate, join datasets
- Generate charts as self-contained HTML+SVG files
- Export analysis results as XLSX with formatting or CSV

**Cannot do:**
- Query databases (no SQL connectors)
- Access cloud data platforms (Snowflake, BigQuery, etc.)
- Real-time data streaming
- Machine learning / model training (use Python externally for that)

## Pre-installed Packages

| Package | Use |
|---------|-----|
| `exceljs` | Read/write XLSX with formatting, formulas, multiple sheets |
| `csv-parse` | Parse CSV/TSV files |
| `csv-stringify` | Write CSV/TSV files |

No additional packages needed — statistics and SVG chart generation are implemented directly in scripts.

---

## Analysis Workflow

### Step 1: Understand the Data

Before any analysis, read and profile the data:

```javascript
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const raw = readFileSync('data.csv', 'utf-8');
const records = parse(raw, { columns: true, skip_empty_lines: true, cast: true });

// Profile
console.log(`Rows: ${records.length}`);
console.log(`Columns: ${Object.keys(records[0]).join(', ')}`);

// Sample
console.log('\nFirst 3 rows:');
records.slice(0, 3).forEach(r => console.log(JSON.stringify(r)));

// Null check
const cols = Object.keys(records[0]);
for (const col of cols) {
  const nullCount = records.filter(r => r[col] === '' || r[col] == null).length;
  if (nullCount > 0) console.log(`  ${col}: ${nullCount} nulls (${(nullCount/records.length*100).toFixed(1)}%)`);
}
```

### Step 2: Compute Statistics

Implement stats directly — no library needed for common operations:

```javascript
function stats(values) {
  const nums = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  const variance = nums.reduce((a, v) => a + (v - mean) ** 2, 0) / nums.length;
  const percentile = (p) => {
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return {
    count: nums.length, sum, mean,
    median: percentile(50),
    stdDev: Math.sqrt(variance),
    min: sorted[0], max: sorted[sorted.length - 1],
    p25: percentile(25), p75: percentile(75),
  };
}

// Correlation (Pearson)
function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return dx2 && dy2 ? num / Math.sqrt(dx2 * dy2) : 0;
}
```

### Step 3: Output Artifacts

#### 3a. HTML + SVG Chart (recommended for visualization)

Generate a self-contained HTML file the user can open in browser or Tauri:

```javascript
import { writeFileSync } from 'node:fs';

function barChart(data, { title, xLabel, yLabel, width = 600, height = 400 }) {
  const margin = { top: 40, right: 20, bottom: 60, left: 70 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const maxVal = Math.max(...data.map(d => d.value));
  const barW = Math.min(40, w / data.length - 4);

  const bars = data.map((d, i) => {
    const x = margin.left + (i * w / data.length) + (w / data.length - barW) / 2;
    const barH = (d.value / maxVal) * h;
    const y = margin.top + h - barH;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="#4A90D9" rx="2"/>
      <text x="${x + barW/2}" y="${margin.top + h + 16}" text-anchor="middle" font-size="11">${d.label}</text>
      <text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" font-size="10">${d.value.toLocaleString()}</text>`;
  }).join('\n');

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,sans-serif">
    <text x="${width/2}" y="24" text-anchor="middle" font-size="16" font-weight="bold">${title}</text>
    <line x1="${margin.left}" y1="${margin.top+h}" x2="${margin.left+w}" y2="${margin.top+h}" stroke="#ccc"/>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top+h}" stroke="#ccc"/>
    <text x="${margin.left-8}" y="${margin.top}" text-anchor="end" font-size="10">${maxVal.toLocaleString()}</text>
    <text x="${margin.left-8}" y="${margin.top+h}" text-anchor="end" font-size="10">0</text>
    ${bars}
    <text x="${width/2}" y="${height-4}" text-anchor="middle" font-size="12">${xLabel || ''}</text>
    <text transform="rotate(-90,14,${height/2})" x="14" y="${height/2}" text-anchor="middle" font-size="12">${yLabel || ''}</text>
  </svg>`;
}

// Usage: wrap in HTML
const chartSvg = barChart(
  [{ label: 'Q1', value: 150000 }, { label: 'Q2', value: 210000 }, { label: 'Q3', value: 185000 }, { label: 'Q4', value: 260000 }],
  { title: 'Quarterly Revenue', xLabel: 'Quarter', yLabel: 'Revenue (¥)' }
);

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Analysis Report</title>
<style>body{font-family:system-ui;max-width:800px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:right}th{background:#f5f5f5}</style>
</head><body><h1>Analysis Report</h1>${chartSvg}</body></html>`;

writeFileSync('report.html', html);
console.log('Created report.html');
```

#### 3b. XLSX Report with Analysis

```javascript
import ExcelJS from 'exceljs';
const wb = new ExcelJS.Workbook();

// Raw data sheet
const raw = wb.addWorksheet('Data');
// ... populate with source data

// Summary sheet
const summary = wb.addWorksheet('Summary');
summary.columns = [{ header: 'Metric', key: 'metric', width: 20 }, { header: 'Value', key: 'value', width: 15 }];
summary.addRows([
  { metric: 'Total Records', value: 1000 },
  { metric: 'Mean Revenue', value: 52300 },
  { metric: 'Median Revenue', value: 48000 },
]);
summary.getRow(1).font = { bold: true };
await wb.xlsx.writeFile('analysis.xlsx');
```

#### 3c. CSV Summary

```javascript
import { writeFileSync } from 'node:fs';
const rows = [['category', 'count', 'total', 'average'], ...results.map(r => [r.cat, r.n, r.sum, r.avg])];
writeFileSync('summary.csv', '\uFEFF' + rows.map(r => r.join(',')).join('\n'), 'utf-8');
```

---

## Chart Types Available (SVG)

Implement these as inline SVG generators in scripts:

| Chart | Best For |
|-------|---------|
| Bar chart | Categorical comparisons |
| Line chart | Trends over time |
| Scatter plot | Correlation between two variables |
| Histogram | Distribution of a single variable |
| Horizontal bar | Ranked comparisons (top-N) |
| Stacked bar | Part-to-whole by category |

For each chart, generate self-contained SVG — no external dependencies.

## Group-By / Pivot Pattern

```javascript
function groupBy(records, keyFn, aggFn) {
  const groups = new Map();
  for (const r of records) {
    const key = keyFn(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return Array.from(groups.entries()).map(([key, items]) => ({ key, ...aggFn(items) }));
}

// Example: revenue by region
const byRegion = groupBy(records, r => r.region, items => ({
  count: items.length,
  totalRevenue: items.reduce((s, r) => s + r.revenue, 0),
  avgRevenue: items.reduce((s, r) => s + r.revenue, 0) / items.length,
}));
```

## Best Practices

- **Profile first**: always show row count, column types, null counts before analysis
- **Validate assumptions**: check for duplicates, outliers, data types before computing
- **Show your work**: output intermediate results (cleaned data, computed columns) alongside final analysis
- **Multiple output formats**: provide both human-readable (HTML chart) and machine-readable (CSV/JSON) outputs
- **Handle large files**: for files >10K rows, sample first, confirm approach with user, then run full analysis
- **CJK in charts**: use `font-family: system-ui, "Microsoft YaHei", "PingFang SC", sans-serif` in SVG
