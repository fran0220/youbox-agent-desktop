#!/usr/bin/env bash
# ============================================================================
# release.sh — 本地构建 + 发布 OriginAI Electron Desktop
#
# 本脚本在当前 JAcoworks-Next 仓库内完成版本号更新、macOS 构建、COS 上传、
# DB 登记和 git tag。旧 ~/JAcoworks 仓库不再参与发布流程。
# Windows/Linux 可由对应构建机产出后放入 dist-release 再上传。
#
# Usage:
#   ./deploy/release.sh <version>               # 完整流程 (构建 macOS + 上传 + 注册)
#   ./deploy/release.sh <version> build          # 仅构建 macOS Electron 产物
#   ./deploy/release.sh <version> upload         # 仅上传 + 注册 (含已放入 dist-release 的 Win/Linux)
#   ./deploy/release.sh <version> bump           # 仅更新 OriginAI Electron 版本号
#
# Prerequisites:
#   1. cp deploy/.env.release.example deploy/.env.release && 填入 COS/DB/Apple 凭据
#   2. SSH 隧道: ssh -L 5432:127.0.0.1:5432 jingao -N -f
#   3. Apple 签名证书已导入 Keychain（正式发版）
# ============================================================================
set -euo pipefail

VERSION="${1:?Usage: ./deploy/release.sh <version> [build|upload|bump]}"
PHASE="${2:-all}"

# Strip 'v' prefix if provided (v1.5.0 → 1.5.0). COS paths and tags add it back.
VERSION="${VERSION#v}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_DIR="$REPO_ROOT/apps/electron"
DIST_DIR="$REPO_ROOT/dist-release/${VERSION}"

COS_BUCKET="jingao-1350796151"
COS_REGION="ap-beijing"
COS_BASE_URL="https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/releases/v${VERSION}"

MAC_TARGETS=(
  "darwin-aarch64:arm64"
  "darwin-x86_64:x64"
)

# ─── Load release environment ────────────────────────────────────

ENV_FILE="$REPO_ROOT/deploy/.env.release"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
elif [[ "$PHASE" != "bump" ]]; then
  echo "❌ Missing $ENV_FILE"
  echo "   cp deploy/.env.release.example deploy/.env.release"
  exit 1
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-jacoworks}"

# ─── Helpers ─────────────────────────────────────────────────────

log()  { echo ""; echo "═══ $1 ═══"; }
info() { echo "  ✅ $1"; }
warn() { echo "  ⚠️  $1"; }
fail() { echo "  ❌ $1"; exit 1; }

ensure_originai_repo() {
  [[ -d "$REPO_ROOT/.git" ]] || fail "OriginAI repo not found: $REPO_ROOT"
  [[ -f "$ELECTRON_DIR/electron-builder.yml" ]] || fail "Electron config not found: $ELECTRON_DIR/electron-builder.yml"
}

ensure_coscli() {
  if command -v coscli &>/dev/null; then return; fi
  echo "📥 Installing coscli..."
  local coscli_path="$HOME/.local/bin/coscli"
  mkdir -p "$(dirname "$coscli_path")"
  curl -fsSL "https://cosbrowser.cloud.tencent.com/software/coscli/coscli-darwin-arm64" -o "$coscli_path"
  chmod +x "$coscli_path"
  export PATH="$HOME/.local/bin:$PATH"
  info "coscli installed → $coscli_path"
}

ensure_tools() {
  local missing=()
  command -v bun &>/dev/null     || missing+=(bun)
  command -v node &>/dev/null    || missing+=(node)
  command -v openssl &>/dev/null || missing+=(openssl)
  if (( ${#missing[@]} > 0 )); then
    fail "Missing tools: ${missing[*]}"
  fi
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

sha512_base64() {
  openssl dgst -sha512 -binary "$1" | openssl base64 -A
}

copy_artifact() {
  local source_file="$1"
  local platform="$2"
  local required="${3:-1}"
  local target_dir="$DIST_DIR/$platform"
  mkdir -p "$target_dir"

  if [[ -f "$source_file" ]]; then
    cp "$source_file" "$target_dir/"
    info "$(basename "$source_file") → $platform"
    return
  fi

  if [[ "$required" == "1" ]]; then
    fail "Expected artifact not found: $source_file"
  fi
}

append_asset_sql() {
  local sql_file="$1"
  local db_platform="$2"
  local download_url="$3"
  local signature="$4"
  local file_size="$5"
  local version_sql
  local platform_sql
  local url_sql
  local signature_sql
  version_sql=$(sql_escape "$VERSION")
  platform_sql=$(sql_escape "$db_platform")
  url_sql=$(sql_escape "$download_url")
  signature_sql=$(sql_escape "$signature")

  cat >> "$sql_file" <<SQL
INSERT INTO release_assets (id, release_id, platform, download_url, signature, file_size)
  SELECT gen_random_uuid()::text, r.id, '${platform_sql}', '${url_sql}', '${signature_sql}', ${file_size}
  FROM releases r WHERE r.version = '${version_sql}'
  ON CONFLICT (release_id, platform) DO UPDATE SET download_url = EXCLUDED.download_url, signature = EXCLUDED.signature, file_size = EXCLUDED.file_size;
SQL
  echo "  📦 ${db_platform} → $(basename "$download_url")"
}

update_json_version() {
  local json_path="$1"
  node - "$json_path" "$VERSION" <<'NODE'
const fs = require('fs')
const [file, version] = process.argv.slice(2)
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const previous = data.version
data.version = version
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
console.log(`${file}: ${previous} -> ${version}`)
NODE
}

# ─── Phase: bump ─────────────────────────────────────────────────

do_bump() {
  ensure_originai_repo
  log "Bump OriginAI Electron version → ${VERSION}"

  update_json_version "$REPO_ROOT/package.json"
  update_json_version "$ELECTRON_DIR/package.json"
}

# ─── Phase: build ────────────────────────────────────────────────

do_build() {
  ensure_originai_repo
  log "Build Electron macOS artifacts"
  rm -rf "$DIST_DIR/darwin-aarch64" "$DIST_DIR/darwin-x86_64"
  mkdir -p "$DIST_DIR"

  # electron-builder needs per-arch staging of bundled Bun / SDK native binaries.
  # Use the OriginAI platform build script rather than the generic root
  # electron:dist:mac task so arm64 and x64 packages do not accidentally share
  # the host architecture's native resources.
  export APPLE_APP_SPECIFIC_PASSWORD="${APPLE_APP_SPECIFIC_PASSWORD:-${APPLE_PASSWORD:-}}"

  for entry in "${MAC_TARGETS[@]}"; do
    IFS=: read -r platform arch <<< "$entry"
    log "Build macOS ${arch}"
    bash "$ELECTRON_DIR/scripts/build-dmg.sh" "$arch"

    log "Collect macOS ${arch} artifacts"
    copy_artifact "$ELECTRON_DIR/release/OriginAI-${arch}.dmg" "$platform" 1
    copy_artifact "$ELECTRON_DIR/release/OriginAI-${arch}.zip" "$platform" 1
    copy_artifact "$ELECTRON_DIR/release/OriginAI-${arch}.dmg.blockmap" "$platform" 0
    copy_artifact "$ELECTRON_DIR/release/OriginAI-${arch}.zip.blockmap" "$platform" 0
  done

  echo ""
  echo "📦 macOS 构建完成! 产物在: $DIST_DIR/"
  ls -la "$DIST_DIR"/*/
  echo ""
  echo "💡 Windows/Linux 产物可由对应构建机生成后放入:"
  echo "   $DIST_DIR/windows-x86_64/OriginAI-x64.exe"
  echo "   $DIST_DIR/linux-x86_64/OriginAI-x64.AppImage"
  echo ""
  echo "   上传并登记: ./deploy/release.sh ${VERSION} upload"
}

# ─── Phase: upload ───────────────────────────────────────────────

do_upload() {
  log "Upload to COS"

  : "${COS_SECRET_ID:?Set COS_SECRET_ID}"
  : "${COS_SECRET_KEY:?Set COS_SECRET_KEY}"

  ensure_coscli

  local cos_cfg
  cos_cfg=$(mktemp /tmp/cos-release-XXXXXX.yaml)
  printf 'cos:\n  base:\n    secretid: %s\n    secretkey: %s\n  buckets:\n    - name: %s\n      alias: cos\n      endpoint: cos.%s.myqcloud.com\n' \
    "$COS_SECRET_ID" "$COS_SECRET_KEY" "$COS_BUCKET" "$COS_REGION" > "$cos_cfg"

  if [[ ! -d "$DIST_DIR" ]]; then
    fail "No artifacts at $DIST_DIR — run build first"
  fi

  local uploaded=0 failed=0

  for platform_dir in "$DIST_DIR"/*/; do
    [[ -d "$platform_dir" ]] || continue
    local platform
    platform=$(basename "$platform_dir")
    echo "📦 $platform:"

    for file in "${platform_dir}"*; do
      [[ -f "$file" ]] || continue
      local filename filesize cos_path
      filename=$(basename "$file")
      filesize=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
      cos_path="cos://${COS_BUCKET}/releases/v${VERSION}/${platform}/${filename}"

      echo "  ⬆️  ${filename} ($(numfmt --to=iec "$filesize" 2>/dev/null || echo "${filesize}B"))"
      if coscli cp -c "$cos_cfg" "$file" "$cos_path"; then
        uploaded=$((uploaded + 1))
      else
        echo "  ❌ Upload failed!"
        failed=$((failed + 1))
      fi
    done
  done

  rm -f "$cos_cfg"

  echo ""
  echo "📊 Upload: ${uploaded} succeeded, ${failed} failed"
  if [[ "$failed" -gt 0 ]]; then fail "Some uploads failed!"; fi
  if [[ "$uploaded" -eq 0 ]]; then fail "No files uploaded!"; fi
  info "All at: ${COS_BASE_URL}/"

  # ── Register in database ──
  log "Register release in DB"

  : "${DB_PASSWORD:?Set DB_PASSWORD}"

  if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; then
    echo "⚠️  数据库不可达，尝试开启 SSH 隧道..."
    if [[ "$DB_HOST" == "127.0.0.1" || "$DB_HOST" == "localhost" ]]; then
      ssh -L "${DB_PORT}:127.0.0.1:5432" jingao -N -f 2>/dev/null || true
    fi
    sleep 1
    if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; then
      fail "数据库不可达! 请手动运行: ssh -L ${DB_PORT}:127.0.0.1:5432 jingao -N -f"
    fi
  fi

  local sql_file version_sql
  sql_file=$(mktemp)
  version_sql=$(sql_escape "$VERSION")
  cat > "$sql_file" <<SQL
BEGIN;
UPDATE releases SET is_latest = false WHERE is_latest = true;
INSERT INTO releases (id, version, notes, pub_date, is_latest)
  VALUES (gen_random_uuid()::text, '${version_sql}', 'See changelog for details.', now(), true)
  ON CONFLICT (version) DO UPDATE SET is_latest = true, notes = EXCLUDED.notes;
SQL

  for platform_dir in "$DIST_DIR"/*/; do
    [[ -d "$platform_dir" ]] || continue
    local platform
    platform=$(basename "$platform_dir")

    for file in "${platform_dir}"*; do
      [[ -f "$file" ]] || continue
      local filename filesize download_url signature
      filename=$(basename "$file")
      case "$filename" in
        *.blockmap|latest*.yml|latest*.yaml|*.sig|platform.txt) continue ;;
      esac

      filesize=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
      download_url="${COS_BASE_URL}/${platform}/${filename}"
      signature=$(sha512_base64 "$file")

      case "$filename" in
        *.dmg)
          append_asset_sql "$sql_file" "$platform" "$download_url" "$signature" "$filesize"
          ;;
        *.zip)
          if [[ "$platform" == darwin-* ]]; then
            append_asset_sql "$sql_file" "${platform}-updater" "$download_url" "$signature" "$filesize"
          else
            warn "Skipping non-mac zip for DB registration: ${platform}/${filename}"
          fi
          ;;
        *.exe)
          append_asset_sql "$sql_file" "$platform" "$download_url" "$signature" "$filesize"
          append_asset_sql "$sql_file" "${platform}-updater" "$download_url" "$signature" "$filesize"
          ;;
        *.AppImage)
          append_asset_sql "$sql_file" "$platform" "$download_url" "$signature" "$filesize"
          append_asset_sql "$sql_file" "${platform}-updater" "$download_url" "$signature" "$filesize"
          ;;
        *)
          warn "Skipping unknown artifact for DB registration: ${platform}/${filename}"
          ;;
      esac
    done
  done

  echo "COMMIT;" >> "$sql_file"

  PGPASSWORD="${DB_PASSWORD}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$sql_file"
  rm -f "$sql_file"
  info "Release v${VERSION} registered (is_latest=true)"
}

# ─── Phase: tag ──────────────────────────────────────────────────

do_tag() {
  ensure_originai_repo
  log "Git tag OriginAI repo"

  cd "$REPO_ROOT"

  if git tag -l "v${VERSION}" | grep -q .; then
    warn "Tag v${VERSION} already exists in $REPO_ROOT"
  else
    git tag -a "v${VERSION}" -m "Release v${VERSION}"
    info "Tagged OriginAI repo: v${VERSION}"
    echo "   Push with: git push origin v${VERSION}"
  fi
}

# ─── Main ────────────────────────────────────────────────────────

main() {
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  OriginAI Electron — Local Release v${VERSION}       "
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  echo "Repo: $REPO_ROOT"
  echo ""

  ensure_tools

  case "$PHASE" in
    bump)
      do_bump
      ;;
    build)
      do_bump
      do_build
      ;;
    upload)
      do_upload
      do_tag
      ;;
    all)
      do_bump
      do_build
      do_upload
      do_tag
      ;;
    *)
      echo "Usage: ./deploy/release.sh <version> [build|upload|bump|all]"
      exit 1
      ;;
  esac

  echo ""
  echo "🎉 Done!"
}

main
