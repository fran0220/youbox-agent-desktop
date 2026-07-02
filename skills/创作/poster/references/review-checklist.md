# VLM Review Checklist

## Review Method

Use Gemini 3 Flash (gemini-3-flash-preview) as vision model to review the generated poster image.

## Review Dimensions

### 1. Text Legibility (权重: 最高)
- 所有文字清晰可读，无模糊
- 文字与背景对比度充足 (WCAG AA: ≥ 4.5:1)
- 标题从远处可辨识
- 文字无截断、无溢出边界
- 字体大小层次分明

### 2. Text Accuracy (权重: 最高)
- 拼写完全正确
- 语言一致（无混杂）
- 无乱码或变形字符
- 数字、日期格式正确
- 标点符号正确

### 3. Layout Balance (权重: 高)
- 视觉重心稳定
- 留白合理，不拥挤
- 元素间距一致
- 视觉引导线自然（视线流动）
- 关键信息在视觉焦点区域

### 4. Color Harmony (权重: 中)
- 配色协调，无刺眼组合
- 主色/辅色/强调色比例合理
- 文字颜色与背景形成足够对比
- 色调符合海报主题氛围

### 5. Style Consistency (权重: 中)
- 风格统一，无混搭违和
- 图形元素风格一致
- 字体选择与整体风格匹配
- 光影/纹理处理一致

### 6. Overall Aesthetics (权重: 中)
- 整体专业程度
- 吸引力和冲击力
- 传达信息的有效性
- 目标受众适配度

## Scoring

每个维度 1-10 分:
- 9-10: 优秀，专业级
- 7-8: 良好，可直接使用
- 5-6: 及格，有明显不足
- 3-4: 较差，需要修改
- 1-2: 不可用

## Pass/Fail Logic

```
PASS: average ≥ 7 AND no dimension < 5
FAIL: average < 7 OR any dimension < 5
```

## Retry Strategy

失败时根据最低分维度调整 prompt:

| 低分维度 | 修改策略 |
|---------|---------|
| Text Legibility | 增加 "bold, high-contrast text, large readable font" |
| Text Accuracy | 简化文字内容，减少字数 |
| Layout Balance | 增加 "balanced composition, ample whitespace, clear visual hierarchy" |
| Color Harmony | 指定具体配色方案，增加 "harmonious color palette" |
| Style Consistency | 强化风格关键词，移除冲突描述 |
| Overall Aesthetics | 增加 "professional, polished, publication-ready" |

最多重试 2 次。第 2 次仍失败则输出当前最佳版本 + 审查报告。

## Output Format

```json
{
  "scores": {
    "text_legibility": 8,
    "text_accuracy": 9,
    "layout_balance": 7,
    "color_harmony": 8,
    "style_consistency": 7,
    "overall_aesthetics": 8
  },
  "average": 7.8,
  "pass": true,
  "issues": [],
  "suggestions": []
}
```
