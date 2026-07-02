# 飞书 API 端点速查

Base URL: `https://open.feishu.cn/open-apis`

## 认证

| 操作 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 获取 tenant_access_token | POST | /auth/v3/tenant_access_token/internal | Body: {app_id, app_secret} |

## 消息 (IM)

| 操作 | 方法 | 路径 | 关键参数 |
|------|------|------|---------|
| 发送消息 | POST | /im/v1/messages?receive_id_type={type} | receive_id, msg_type, content |
| 回复消息 | POST | /im/v1/messages/{message_id}/reply | msg_type, content |
| 撤回消息 | DELETE | /im/v1/messages/{message_id} | — |

## 日历 (Calendar)

| 操作 | 方法 | 路径 | 关键参数 |
|------|------|------|---------|
| 日历列表 | GET | /calendar/v4/calendars | page_size |
| 日程列表 | GET | /calendar/v4/calendars/{calendar_id}/events | start_time, end_time (Unix秒) |
| 创建日程 | POST | /calendar/v4/calendars/{calendar_id}/events | summary, start_time, end_time, attendees |
| 更新日程 | PATCH | /calendar/v4/calendars/{calendar_id}/events/{event_id} | 同上 |
| 删除日程 | DELETE | /calendar/v4/calendars/{calendar_id}/events/{event_id} | — |
| 查询空闲 | POST | /calendar/v4/freebusy/list | time_min, time_max, user_id_list |

## 通讯录 (Contact)

| 操作 | 方法 | 路径 | 关键参数 |
|------|------|------|---------|
| 搜索用户 | POST | /search/v1/user | query, page_size |
| 部门列表 | GET | /contact/v3/departments | parent_department_id, page_size |
| 部门用户 | GET | /contact/v3/users | department_id, page_size |
| 批量获取用户ID | POST | /contact/v3/users/batch_get_id | emails[], mobiles[] |

## 审批 (Approval)

| 操作 | 方法 | 路径 | 关键参数 |
|------|------|------|---------|
| 发起审批 | POST | /approval/v4/instances | approval_code, open_id, form |
| 查询实例 | GET | /approval/v4/instances/{instance_code} | — |
| 实例列表 | POST | /approval/v4/instances/query | user_id, approval_code, status |

## 多维表格 (Bitable)

| 操作 | 方法 | 路径 | 关键参数 |
|------|------|------|---------|
| 查询记录 | GET | /bitable/v1/apps/{app_token}/tables/{table_id}/records | page_size, filter |
| 搜索记录 | POST | /bitable/v1/apps/{app_token}/tables/{table_id}/records/search | filter, sort |
| 批量创建 | POST | /bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create | records[] |
| 更新记录 | PUT | /bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id} | fields |
| 删除记录 | DELETE | /bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id} | — |

## 通用说明

- **认证头**: `Authorization: Bearer {tenant_access_token}`
- **时间格式**: Unix 秒时间戳 (日历API) 或 ISO 8601 (其他)
- **分页**: `page_token` + `page_size` 模式
- **错误码**: `code=0` 为成功, 其他见 [错误码文档](https://open.feishu.cn/document/server-docs/getting-started/server-error-codes)

## 常见错误码

| code | 含义 | 处理建议 |
|------|------|---------|
| 99991663 | token 无效/过期 | 刷新 tenant_access_token |
| 99991400 | 参数错误 | 检查请求参数 |
| 99991401 | 无权限 | 检查应用权限配置 |
| 99991668 | token 过期 | 重新获取 token |
