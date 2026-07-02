#!/usr/bin/env bash
set -euo pipefail

# Upload compiled CLI tools to COS and update the cli_tools_manifest in DB.
#
# Usage:
#   VERSION=1.0.0 bash deploy/scripts/upload-tools.sh
#
# Prerequisites:
#   - deploy/.env.release (COS_SECRET_ID, COS_SECRET_KEY, DB_PASSWORD)
#   - coscli installed
#   - CLI tools compiled into apps/electron/resources/bin/<platform>/
#   - SSH tunnel to jingao DB (ssh -L 5432:127.0.0.1:5432 jingao -N -f)

VERSION="${VERSION:?Usage: VERSION=1.0.0 bash deploy/scripts/upload-tools.sh}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

COS_BUCKET="jingao-1350796151"
COS_REGION="ap-beijing"
COS_BASE_URL="https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com"

TOOLS=("ai-search" "asset-gateway" "agent-browser")

# Platform → (COS suffix, binary suffix)
# Only the current host platform is uploaded per invocation.
TARGET="${TARGET:-$(rustc -vV | grep host | cut -d' ' -f2)}"

case "$TARGET" in
  aarch64-apple-darwin) PLATFORM_KEY="darwin-arm64"; DB_PLATFORM_KEY="darwin-aarch64"; EXT="" ;;
  x86_64-apple-darwin)  PLATFORM_KEY="darwin-x64"; DB_PLATFORM_KEY="darwin-x86_64";  EXT="" ;;
  x86_64-pc-windows-msvc) PLATFORM_KEY="win32-x64"; DB_PLATFORM_KEY="windows-x86_64"; EXT=".exe" ;;
  *) echo "❌ Unsupported target: $TARGET"; exit 1 ;;
esac

TOOLS_DIR="$REPO_ROOT/apps/electron/resources/bin/$PLATFORM_KEY"

# Load secrets
ENV_FILE="$REPO_ROOT/deploy/.env.release"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
else
  echo "❌ Missing $ENV_FILE" >&2
  exit 1
fi

COS_CFG=$(mktemp /tmp/cos-tools-XXXX.yaml)
printf 'cos:\n  base:\n    secretid: %s\n    secretkey: %s\n  buckets:\n    - name: %s\n      alias: cos\n      endpoint: cos.%s.myqcloud.com\n' \
  "$COS_SECRET_ID" "$COS_SECRET_KEY" "$COS_BUCKET" "$COS_REGION" > "$COS_CFG"
trap 'rm -f "$COS_CFG"' EXIT

echo "🔧 Uploading CLI tools v${VERSION} for ${PLATFORM_KEY}"
echo ""

MANIFEST_ENTRIES=()

for TOOL in "${TOOLS[@]}"; do
  LOCAL_PATH="$TOOLS_DIR/${TOOL}${EXT}"
  if [[ ! -f "$LOCAL_PATH" ]]; then
    echo "⚠️  Skipping $TOOL (not found at $LOCAL_PATH)"
    continue
  fi

  SHA256=$(shasum -a 256 "$LOCAL_PATH" | awk '{print $1}')
  COS_KEY="tools/v${VERSION}/${TOOL}-${DB_PLATFORM_KEY}${EXT}"
  COS_PATH="cos://${COS_BUCKET}/${COS_KEY}"
  DOWNLOAD_URL="${COS_BASE_URL}/${COS_KEY}"

  SIZE=$(stat -f%z "$LOCAL_PATH" 2>/dev/null || stat -c%s "$LOCAL_PATH" 2>/dev/null || echo 0)
  PRETTY_SIZE=$(numfmt --to=iec "$SIZE" 2>/dev/null || echo "${SIZE}B")

  echo "⬆️  $TOOL ($PRETTY_SIZE) → $COS_KEY"
  coscli cp -c "$COS_CFG" "$LOCAL_PATH" "$COS_PATH"
  echo "  ✅ sha256: $SHA256"
  echo ""

  MANIFEST_ENTRIES+=("${TOOL}|${SHA256}|${DOWNLOAD_URL}")
done

if [[ ${#MANIFEST_ENTRIES[@]} -eq 0 ]]; then
  echo "❌ No tools uploaded"
  exit 1
fi

# Build or update the manifest JSON.
# Read existing manifest from DB, merge new platform entries.
DB_URL="postgresql://postgres:${DB_PASSWORD}@127.0.0.1:5432/jacoworks"
EXISTING_MANIFEST=$(psql "$DB_URL" -t -A -c \
  "SELECT value FROM system_settings WHERE key = 'cli_tools_manifest'" 2>/dev/null || echo "[]")
if [[ -z "$EXISTING_MANIFEST" || "$EXISTING_MANIFEST" == "" ]]; then
  EXISTING_MANIFEST="[]"
fi

# Use python3 to merge manifest (available on macOS)
NEW_MANIFEST=$(python3 -c "
import json, sys

existing = json.loads('''$EXISTING_MANIFEST''')
version = '$VERSION'
platform_key = '$PLATFORM_KEY'
entries_raw = '''$(printf '%s\n' "${MANIFEST_ENTRIES[@]}")'''.strip().split('\n')

by_name = {e['name']: e for e in existing}

for raw in entries_raw:
    if not raw.strip():
        continue
    name, sha256, url = raw.split('|', 2)
    if name not in by_name:
        by_name[name] = {'name': name, 'version': version, 'platforms': {}}
    entry = by_name[name]
    entry['version'] = version
    entry['platforms'][platform_key] = {'url': url, 'sha256': sha256}

print(json.dumps(list(by_name.values()), ensure_ascii=False))
")

echo "📋 Updating cli_tools_manifest in DB..."
psql "$DB_URL" -c \
  "INSERT INTO system_settings (key, value, description)
   VALUES ('cli_tools_manifest', '${NEW_MANIFEST}', 'CLI 工具版本清单 (JSON)')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"

echo ""
echo "✅ CLI tools v${VERSION} uploaded for ${PLATFORM_KEY}"
echo ""
echo "Manifest:"
echo "$NEW_MANIFEST" | python3 -m json.tool 2>/dev/null || echo "$NEW_MANIFEST"
