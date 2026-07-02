#!/usr/bin/env bash
# Build the golden OpenClaw Incus image for JAcoworks.
# Run on the local server (x86_64) where Incus is installed.
#
# Usage: ./build-openclaw-image.sh [--force]
#   --force: delete existing image and rebuild

set -euo pipefail

IMAGE_ALIAS="openclaw-base"
BUILD_INSTANCE="oc-build-$$"
OPENCLAW_VERSION="latest"

# Parse args
FORCE=false
if [[ "${1:-}" == "--force" ]]; then
    FORCE=true
fi

# Check Incus is available
if ! command -v incus &>/dev/null; then
    echo "❌ incus not found. Install from https://github.com/zabbly/incus"
    exit 1
fi

# Check if image already exists
if incus image alias list --format csv | grep -q "^${IMAGE_ALIAS},"; then
    if [[ "$FORCE" == "true" ]]; then
        echo "🗑️  Removing existing image: ${IMAGE_ALIAS}"
        incus image delete "${IMAGE_ALIAS}" 2>/dev/null || true
    else
        echo "✅ Image '${IMAGE_ALIAS}' already exists. Use --force to rebuild."
        exit 0
    fi
fi

echo "📦 Building OpenClaw golden image..."
echo "   Instance: ${BUILD_INSTANCE}"
echo "   Base: ubuntu/24.04"

# 1. Launch build instance
incus launch images:ubuntu/24.04 "${BUILD_INSTANCE}"

# Wait for cloud-init / network
echo "⏳ Waiting for instance to be ready..."
sleep 5
incus exec "${BUILD_INSTANCE}" -- bash -c "cloud-init status --wait 2>/dev/null || true"

# 2. Install system packages
echo "📥 Installing system packages..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    curl wget git ca-certificates gnupg \
    build-essential jq tmux
"

# 3. Install Node.js 22 LTS
echo "📥 Installing Node.js 22..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs
"

# 4. Install OpenClaw
echo "📥 Installing OpenClaw..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
npm install -g openclaw@${OPENCLAW_VERSION}
"

# 5. Create node user (uid 1000) for OpenClaw
echo "👤 Creating node user..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
if ! id node &>/dev/null; then
    # UID 1000 may be taken by 'ubuntu' default user; use -o to allow non-unique or pick another UID
    existing_user=\$(getent passwd 1000 | cut -d: -f1)
    if [ -n \"\$existing_user\" ] && [ \"\$existing_user\" != 'node' ]; then
        usermod -l node -d /home/node -m \"\$existing_user\"
        groupmod -n node \"\$existing_user\" 2>/dev/null || true
    else
        useradd -m -s /bin/bash node
    fi
fi
mkdir -p /home/node/.openclaw /data/workspace
chown -R node:node /home/node /data
"

# 6. Create systemd service for OpenClaw
echo "🔧 Creating OpenClaw systemd service..."
incus exec "${BUILD_INSTANCE}" -- bash -c 'cat > /etc/systemd/system/openclaw.service << EOF
[Unit]
Description=OpenClaw AI Agent Runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=node
Group=node
WorkingDirectory=/home/node
ExecStart=/usr/bin/openclaw gateway --port 18789
Restart=always
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=5
Environment=NODE_ENV=production
Environment=HOME=/home/node
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openclaw

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable openclaw.service
'

# 7. Install JMOS Go binary
# The pre-built binary must exist at deploy/incus/jmos (linux/amd64, CGO_ENABLED=0).
# Build it first: cd openclaw/jmos && make build && cp bin/jmos ../../deploy/incus/jmos
echo "📥 Installing JMOS binary..."
JMOS_BIN="$(cd "$(dirname "$0")" && pwd)/jmos"
if [[ ! -f "$JMOS_BIN" ]]; then
    echo "❌ JMOS binary not found at $JMOS_BIN"
    echo "   Build it first: cd openclaw/jmos && make build && cp bin/jmos deploy/incus/jmos"
    incus delete -f "${BUILD_INSTANCE}" 2>/dev/null || true
    exit 1
fi
incus file push "$JMOS_BIN" "${BUILD_INSTANCE}/usr/local/bin/jmos"
incus exec "${BUILD_INSTANCE}" -- chmod +x /usr/local/bin/jmos

# 8. Create JMOS directories and default config
echo "🔧 Setting up JMOS directories..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
mkdir -p /etc/jmos /data/workspace/jamoss/data /data/workspace/jamoss/logs
chown -R node:node /data/workspace/jamoss
"

# 9. Create JMOS systemd service
echo "🔧 Creating JMOS systemd service..."
incus exec "${BUILD_INSTANCE}" -- bash -c 'cat > /etc/systemd/system/jmos.service << EOF
[Unit]
Description=JMOS Collaboration Gateway
After=network-online.target openclaw.service

[Service]
Type=simple
User=node
Group=node
ExecStart=/usr/local/bin/jmos --config /etc/jmos/config.yaml
Restart=on-failure
RestartSec=5
Environment=HOME=/home/node
StandardOutput=journal
StandardError=journal
SyslogIdentifier=jmos

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable jmos.service
'

# 10. Clean up caches
echo "🧹 Cleaning up..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
npm cache clean --force
"

# 11. Stop and publish
echo "📸 Publishing image as '${IMAGE_ALIAS}'..."
incus stop "${BUILD_INSTANCE}"
incus publish "${BUILD_INSTANCE}" --alias "${IMAGE_ALIAS}"
incus delete "${BUILD_INSTANCE}"

echo ""
echo "✅ Golden image '${IMAGE_ALIAS}' built successfully!"
echo ""
echo "   Usage: incus launch ${IMAGE_ALIAS} oc-mycontainer"
echo "   Size: $(incus image info ${IMAGE_ALIAS} | grep Size)"
