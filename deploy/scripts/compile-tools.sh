#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?Usage: compile-tools.sh <target-triple>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

GLOBAL_NPM_ROOT="$(npm root -g 2>/dev/null || true)"

case "$TARGET" in
  aarch64-apple-darwin)
    PLATFORM_KEY="darwin-arm64"
    BUN_TARGET="bun-darwin-arm64"
    TOOL_EXT=""
    AGENT_BROWSER_BINARY="agent-browser-darwin-arm64"
    ;;
  x86_64-apple-darwin)
    PLATFORM_KEY="darwin-x64"
    BUN_TARGET="bun-darwin-x64"
    TOOL_EXT=""
    AGENT_BROWSER_BINARY="agent-browser-darwin-x64"
    ;;
  x86_64-pc-windows-msvc)
    PLATFORM_KEY="win32-x64"
    BUN_TARGET="bun-windows-x64"
    TOOL_EXT=".exe"
    AGENT_BROWSER_BINARY="agent-browser-win32-x64.exe"
    ;;
  *)
    echo "❌ Unsupported target triple: $TARGET" >&2
    exit 1
    ;;
esac

TOOLS_DIR="$REPO_ROOT/apps/electron/resources/bin/$PLATFORM_KEY"

resolve_file() {
  local label="$1"
  local env_name="$2"
  shift 2

  local explicit="${!env_name:-}"
  if [[ -n "$explicit" ]]; then
    if [[ -f "$explicit" ]]; then
      printf '%s\n' "$explicit"
      return 0
    fi
    echo "❌ $label from $env_name does not exist: $explicit" >&2
    exit 1
  fi

  local candidate
  for candidate in "$@"; do
    if [[ -n "$candidate" ]] && [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "❌ Could not find $label. Set $env_name to override the path." >&2
  exit 1
}

resolve_dir() {
  local label="$1"
  local env_name="$2"
  shift 2

  local explicit="${!env_name:-}"
  if [[ -n "$explicit" ]]; then
    if [[ -d "$explicit" ]]; then
      printf '%s\n' "$explicit"
      return 0
    fi
    echo "❌ $label from $env_name does not exist: $explicit" >&2
    exit 1
  fi

  local candidate
  for candidate in "$@"; do
    if [[ -n "$candidate" ]] && [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "❌ Could not find $label. Set $env_name to override the path." >&2
  exit 1
}

file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

pretty_size() {
  local size="$1"
  numfmt --to=iec "$size" 2>/dev/null || echo "${size}B"
}

build_bun_tool() {
  local label="$1"
  local entry="$2"
  local output="$3"

  echo "📦 Compiling $label"
  echo "   entry: $entry"
  bun build --compile "$entry" --target "$BUN_TARGET" --outfile "$output"
  chmod +x "$output" 2>/dev/null || true

  local size
  size="$(file_size "$output")"
  if [[ "$size" -lt 1024 ]]; then
    echo "❌ $label output is too small: $output (${size}B)" >&2
    exit 1
  fi

  echo "  ✅ $label → $(basename "$output") ($(pretty_size "$size"))"
}

copy_native_tool() {
  local label="$1"
  local source="$2"
  local output="$3"

  echo "📦 Copying $label"
  echo "   source: $source"
  cp "$source" "$output"
  chmod +x "$output" 2>/dev/null || true

  local size
  size="$(file_size "$output")"
  if [[ "$size" -lt 1024 ]]; then
    echo "❌ $label output is too small: $output (${size}B)" >&2
    exit 1
  fi

  echo "  ✅ $label → $(basename "$output") ($(pretty_size "$size"))"
}

mkdir -p "$TOOLS_DIR"
rm -f \
  "$TOOLS_DIR/ai-search" "$TOOLS_DIR/ai-search.exe" \
  "$TOOLS_DIR/asset-gateway" "$TOOLS_DIR/asset-gateway.exe" \
  "$TOOLS_DIR/agent-browser" "$TOOLS_DIR/agent-browser.exe"

# ai-search and asset-gateway CLIs are no longer compiled —
# replaced by OriginAI runtime integrations. Keep this script focused on native
# helper binaries that must ship inside apps/electron/resources/bin/<platform>/.

AGENT_BROWSER_PACKAGE_DIR="$(resolve_dir \
  "agent-browser package directory" \
  "AGENT_BROWSER_PACKAGE_DIR" \
  "$REPO_ROOT/node_modules/agent-browser" \
  "$GLOBAL_NPM_ROOT/agent-browser" \
  "/Users/fan/.npm-global/lib/node_modules/agent-browser")"
AGENT_BROWSER_SOURCE="$AGENT_BROWSER_PACKAGE_DIR/bin/$AGENT_BROWSER_BINARY"

if [[ ! -f "$AGENT_BROWSER_SOURCE" ]]; then
  echo "❌ agent-browser binary not found for $TARGET: $AGENT_BROWSER_SOURCE" >&2
  exit 1
fi

echo "🔧 Compiling bundled CLI tools for $TARGET"
echo ""

copy_native_tool "agent-browser" "$AGENT_BROWSER_SOURCE" "$TOOLS_DIR/agent-browser$TOOL_EXT"

# ─── macOS code signing (required for notarization) ──────────────

case "$TARGET" in
  *apple-darwin*)
    SIGN_ID="${APPLE_SIGNING_IDENTITY:-Developer ID Application: fan Z (9UUWCMKMDH)}"
    echo "🔏 Signing CLI tools with: $SIGN_ID"
    for tool in "$TOOLS_DIR"/agent-browser; do
      if [[ -f "$tool" ]]; then
        codesign --force --options runtime --timestamp \
          --sign "$SIGN_ID" "$tool" 2>/dev/null && \
          echo "  ✅ $(basename "$tool")" || \
          echo "  ❌ Failed to sign $(basename "$tool")"
      fi
    done
    ;;
esac

echo ""
echo "✅ Bundled CLI tools are ready in $TOOLS_DIR"
