#!/usr/bin/env bash
set -euo pipefail

# OriginAI Website Deployment Script
# Usage: ./deploy.sh <host>

if [ $# -lt 1 ]; then
  echo "Usage: $0 <host>" >&2
  echo "Example: $0 jingao" >&2
  exit 1
fi

HOST="$1"
REMOTE_DIR="/opt/jacoworks/www"
LOCAL_ROOT="$(cd "$(dirname "$0")/../.." && pwd)/website"

echo "=== Building website (release) ==="
cd "$LOCAL_ROOT"
cargo build --release

echo "=== Preparing deploy package ==="
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
mkdir -p "$TMPDIR/www"
cp target/release/jacoworks-website "$TMPDIR/www/"
cp -r content "$TMPDIR/www/"
cp -r static "$TMPDIR/www/"
cp -r templates "$TMPDIR/www/"

echo "=== Uploading to $HOST ==="
ssh "$HOST" "sudo mkdir -p $REMOTE_DIR"
ssh "$HOST" "sudo systemctl stop jacoworks-website 2>/dev/null || true"
rsync -avz --delete --rsync-path="sudo rsync" "$TMPDIR/www/" "$HOST:$REMOTE_DIR/"

echo "=== Installing systemd service ==="
scp "$(dirname "$0")/jacoworks-website.service" "$HOST:/tmp/jacoworks-website.service"
ssh "$HOST" "sudo mv /tmp/jacoworks-website.service /etc/systemd/system/jacoworks-website.service && sudo systemctl daemon-reload"
ssh "$HOST" "sudo systemctl enable --now jacoworks-website"

if [ -n "${FRPC_CONFIG:-}" ]; then
  if grep -q 'YOUR_FRP_TOKEN' "$FRPC_CONFIG"; then
    echo "Refusing to deploy FRPC_CONFIG with placeholder token: $FRPC_CONFIG" >&2
    exit 1
  fi
  echo "=== Updating frpc config from FRPC_CONFIG ==="
  scp "$FRPC_CONFIG" "$HOST:/tmp/frpc.toml"
  ssh "$HOST" "sudo mv /tmp/frpc.toml /opt/jacoworks/frpc.toml && (sudo systemctl restart frpc 2>/dev/null || sudo systemctl restart frps 2>/dev/null || true)"
else
  echo "=== Skipping frpc config update (set FRPC_CONFIG to deploy it explicitly) ==="
fi

echo "=== Done! Website should be live on the configured OpenResty route ==="
echo "Check status: ssh $HOST 'systemctl status jacoworks-website'"
