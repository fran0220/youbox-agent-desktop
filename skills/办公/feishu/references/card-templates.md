# 飞书消息卡片模板

> `msg_type: "interactive"`, `content` 为 JSON 字符串。变量用 `{{var}}` 标记，使用时替换为实际值。

## Header 模板颜色

blue · wathet · turquoise · green · yellow · orange · red · carmine · violet · purple · indigo · grey

---

## 1. 通知卡片

```json
{
  "config": { "wide_screen_mode": true },
  "header": {
    "title": { "tag": "plain_text", "content": "{{title}}" },
    "template": "blue"
  },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "{{content}}" } },
    { "tag": "hr" },
    { "tag": "note", "elements": [
      { "tag": "plain_text", "content": "{{footer}}" }
    ]}
  ]
}
```

## 2. 日程提醒卡片

```json
{
  "config": { "wide_screen_mode": true },
  "header": {
    "title": { "tag": "plain_text", "content": "📅 {{title}}" },
    "template": "turquoise"
  },
  "elements": [
    { "tag": "div", "fields": [
      { "is_short": true, "text": { "tag": "lark_md", "content": "**时间**\n{{time}}" } },
      { "is_short": true, "text": { "tag": "lark_md", "content": "**地点**\n{{location}}" } }
    ]},
    { "tag": "div", "text": { "tag": "lark_md", "content": "**参会人**: {{attendees}}" } },
    { "tag": "action", "actions": [
      {
        "tag": "button", "text": { "tag": "plain_text", "content": "查看详情" },
        "type": "primary", "url": "{{detail_url}}"
      }
    ]}
  ]
}
```

## 3. 审批卡片

```json
{
  "config": { "wide_screen_mode": true },
  "header": {
    "title": { "tag": "plain_text", "content": "📋 {{approval_type}}" },
    "template": "orange"
  },
  "elements": [
    { "tag": "div", "fields": [
      { "is_short": true, "text": { "tag": "lark_md", "content": "**申请人**\n{{applicant}}" } },
      { "is_short": true, "text": { "tag": "lark_md", "content": "**状态**\n{{status}}" } }
    ]},
    { "tag": "div", "text": { "tag": "lark_md", "content": "**事由**: {{reason}}" } },
    { "tag": "hr" },
    { "tag": "action", "actions": [
      {
        "tag": "button", "text": { "tag": "plain_text", "content": "✅ 同意" },
        "type": "primary",
        "value": { "action": "approve", "instance_code": "{{instance_code}}" }
      },
      {
        "tag": "button", "text": { "tag": "plain_text", "content": "❌ 拒绝" },
        "type": "danger",
        "value": { "action": "reject", "instance_code": "{{instance_code}}" }
      }
    ]}
  ]
}
```

## 4. 数据表格卡片

```json
{
  "config": { "wide_screen_mode": true },
  "header": {
    "title": { "tag": "plain_text", "content": "{{title}}" },
    "template": "indigo"
  },
  "elements": [
    {
      "tag": "table",
      "page_size": 5,
      "row_height": "low",
      "header_style": { "text_align": "left", "text_size": "normal", "background_style": "grey", "bold": true },
      "columns": [
        { "name": "col1", "display_name": "{{col1_header}}", "data_type": "text", "width": "auto" },
        { "name": "col2", "display_name": "{{col2_header}}", "data_type": "text", "width": "auto" },
        { "name": "col3", "display_name": "{{col3_header}}", "data_type": "number", "width": "auto" }
      ],
      "rows": [
        { "col1": "{{row1_val1}}", "col2": "{{row1_val2}}", "col3": "{{row1_val3}}" }
      ]
    }
  ]
}
```

## 5. 确认卡片

```json
{
  "config": { "wide_screen_mode": true },
  "header": {
    "title": { "tag": "plain_text", "content": "{{title}}" },
    "template": "yellow"
  },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "{{question}}" } },
    { "tag": "action", "actions": [
      {
        "tag": "button", "text": { "tag": "plain_text", "content": "✅ 确认" },
        "type": "primary",
        "value": { "action": "confirm", "payload": "{{payload}}" }
      },
      {
        "tag": "button", "text": { "tag": "plain_text", "content": "取消" },
        "type": "default",
        "value": { "action": "cancel", "payload": "{{payload}}" }
      }
    ]}
  ]
}
```
