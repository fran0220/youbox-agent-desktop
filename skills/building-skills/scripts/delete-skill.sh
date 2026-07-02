#!/bin/sh
# delete-skill.sh — 从 Gateway DB 中删除用户技能
#
# 用法: delete-skill.sh <skill-id>
#
# 环境变量:
#   GATEWAY_URL     — Gateway 地址
#   GATEWAY_TOKEN   — 容器认证 token

set -e

SKILL_ID="$1"
if [ -z "$SKILL_ID" ]; then
  echo "用法: delete-skill.sh <skill-id>" >&2
  exit 1
fi

case "$SKILL_ID" in
  *..* | */* | *\\*)
    echo "错误: 无效的 skill-id" >&2
    exit 1
    ;;
esac

GATEWAY="${GATEWAY_URL:-}"
TOKEN="${GATEWAY_TOKEN:-}"

if [ -z "$GATEWAY" ] || [ -z "$TOKEN" ]; then
  echo "错误: 缺少 GATEWAY_URL 或 GATEWAY_TOKEN 环境变量" >&2
  exit 1
fi

RESP=$(mktemp)
trap 'rm -f "$RESP"' EXIT

HTTP_CODE=$(curl -s -o "$RESP" -w "%{http_code}" \
  -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "$GATEWAY/api/skills/$SKILL_ID")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ 技能 '$SKILL_ID' 已从云端删除"
else
  echo "❌ 删除失败 (HTTP $HTTP_CODE): $(cat "$RESP")" >&2
  exit 1
fi
