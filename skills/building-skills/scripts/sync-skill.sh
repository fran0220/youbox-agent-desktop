#!/bin/sh
# sync-skill.sh — 将用户技能同步到 Gateway DB（持久化 + 容器热推送）
#
# 用法: sync-skill.sh <skill-id>
#
# 环境变量:
#   GATEWAY_URL     — Gateway 地址
#   GATEWAY_TOKEN   — 容器认证 token
#   USER_SKILLS_DIR — 用户技能目录 (默认 ~/.jacoworks/skills)

set -e

SKILL_ID="$1"
if [ -z "$SKILL_ID" ]; then
  echo "用法: sync-skill.sh <skill-id>" >&2
  exit 1
fi

# Validate skill-id
case "$SKILL_ID" in
  *..* | */* | *\\*)
    echo "错误: 无效的 skill-id" >&2
    exit 1
    ;;
esac

GATEWAY="${GATEWAY_URL:-}"
TOKEN="${GATEWAY_TOKEN:-}"
SKILLS_DIR="${USER_SKILLS_DIR:-$HOME/.jacoworks/skills}"
SKILL_DIR="$SKILLS_DIR/$SKILL_ID"

if [ -z "$GATEWAY" ] || [ -z "$TOKEN" ]; then
  echo "错误: 缺少 GATEWAY_URL 或 GATEWAY_TOKEN 环境变量" >&2
  exit 1
fi

if [ ! -d "$SKILL_DIR" ]; then
  echo "错误: 技能目录不存在: $SKILL_DIR" >&2
  exit 1
fi

# Build JSON payload with python3 (always available in vm-agent containers)
PAYLOAD=$(SKILL_DIR="$SKILL_DIR" python3 - <<'PY'
import json, os
skill_dir = os.environ['SKILL_DIR']
files = []
for root, _, names in os.walk(skill_dir):
    for name in sorted(names):
        fpath = os.path.join(root, name)
        relpath = os.path.relpath(fpath, skill_dir)
        try:
            with open(fpath, 'r') as f:
                files.append({'path': relpath, 'content': f.read()})
        except Exception:
            pass
print(json.dumps({'files': files}))
PY
)

RESP=$(mktemp)
trap 'rm -f "$RESP"' EXIT

HTTP_CODE=$(curl -s -o "$RESP" -w "%{http_code}" \
  -X PUT \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$PAYLOAD" \
  "$GATEWAY/api/skills/$SKILL_ID")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ 技能 '$SKILL_ID' 已同步到云端"
else
  echo "❌ 同步失败 (HTTP $HTTP_CODE): $(cat "$RESP")" >&2
  exit 1
fi
