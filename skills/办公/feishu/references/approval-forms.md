# 飞书审批表单构建指南

## approval_code

每个审批定义在飞书管理后台有唯一 `approval_code`（如 `"D9A99060-xxx"`）。发起审批时必须指定此 code，表单字段 ID 需与该审批定义中的字段一一对应。

> 在「飞书管理后台 → 审批 → 审批管理」中查看/配置审批定义和字段。

## 表单字段类型

| 类型 | 说明 | JSON 示例 |
|------|------|----------|
| input | 单行文本 | `{"id": "widget1", "type": "input", "value": "出差北京"}` |
| textarea | 多行文本 | `{"id": "widget2", "type": "textarea", "value": "项目需求讨论..."}` |
| number | 数字 | `{"id": "widget3", "type": "number", "value": "8"}` |
| date | 日期 | `{"id": "widget4", "type": "date", "value": "2026-02-26"}` |
| dateInterval | 日期区间 | `{"id": "widget5", "type": "dateInterval", "value": ["2026-02-26", "2026-02-28"]}` |
| amount | 金额 | `{"id": "widget6", "type": "amount", "value": "1000.00", "currency": "CNY"}` |
| contact | 联系人 | `{"id": "widget7", "type": "contact", "value": ["ou_abc123"]}` |
| attachmentV2 | 附件 | 通过 API 上传后引用 file_key（不常用） |

## 常见审批场景

### 1. 请假

字段: `dateInterval`(起止日期) + `textarea`(事由)

### 2. 报销

字段: `amount`(金额) + `input`(费用类别) + `textarea`(说明)

### 3. 加班

字段: `date`(日期) + `number`(时长/小时) + `textarea`(事由)

### 4. 出差

字段: `dateInterval`(起止日期) + `input`(目的地) + `amount`(预算) + `textarea`(出差目的)

## 完整示例: 发起请假审批

```bash
POST /open-apis/approval/v4/instances
Authorization: Bearer {tenant_access_token}
Content-Type: application/json
```

```json
{
  "approval_code": "D9A99060-CC51-4DDD-B5F1-2E479F6E1B78",
  "open_id": "ou_abc123def456",
  "form": "[{\"id\":\"widget1\",\"type\":\"dateInterval\",\"value\":[\"2026-03-01\",\"2026-03-03\"]},{\"id\":\"widget2\",\"type\":\"textarea\",\"value\":\"家中有事，请假三天\"}]"
}
```

> **注意**: `form` 字段的值是 **JSON 字符串**（需转义），不是 JSON 对象。

## 查询审批状态

```bash
GET /open-apis/approval/v4/instances/{instance_code}
```

返回 `status` 值: `PENDING` | `APPROVED` | `REJECTED` | `CANCELED` | `DELETED`
