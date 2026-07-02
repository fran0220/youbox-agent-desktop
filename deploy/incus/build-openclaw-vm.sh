#!/usr/bin/env bash
# Build the golden OpenClaw Desktop VM image for JAcoworks.
# Creates a full Ubuntu Desktop VM with OpenClaw + VNC + noVNC.
#
# Run on the local server (x86_64) where Incus is installed.
# Usage: ./build-openclaw-vm.sh [--force]

set -euo pipefail

IMAGE_ALIAS="openclaw-ready"
BUILD_INSTANCE="oc-vm-build-$$"
OPENCLAW_VERSION="latest"
VNC_PORT=5901
NOVNC_PORT=6080

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
    FORCE=true
fi

if ! command -v incus &>/dev/null; then
    echo "❌ incus not found"
    exit 1
fi

if incus image alias list --format csv | grep -q "^${IMAGE_ALIAS},"; then
    if [[ "$FORCE" == "true" ]]; then
        echo "🗑️  Removing existing image: ${IMAGE_ALIAS}"
        incus image delete "${IMAGE_ALIAS}" 2>/dev/null || true
    else
        echo "✅ Image '${IMAGE_ALIAS}' already exists. Use --force to rebuild."
        exit 0
    fi
fi

echo "📦 Building OpenClaw Desktop VM image..."
echo "   Instance: ${BUILD_INSTANCE}"
echo "   Base: images:ubuntu/24.04 --vm"

# ── 1. Launch VM ──────────────────────────────────────
incus launch images:ubuntu/24.04 "${BUILD_INSTANCE}" --vm \
    -c limits.cpu=4 \
    -c limits.memory=4GiB

echo "⏳ Waiting for VM to boot..."
for i in $(seq 1 60); do
    if incus exec "${BUILD_INSTANCE}" -- hostname &>/dev/null 2>&1; then
        break
    fi
    sleep 2
done
incus exec "${BUILD_INSTANCE}" -- cloud-init status --wait 2>/dev/null || true
echo "✅ VM booted"

# ── 2. System packages ───────────────────────────────
echo "📥 Installing system packages..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
    curl wget git ca-certificates gnupg \
    build-essential jq tmux unzip \
    dbus-x11 xauth
"

# ── 2b. Development & media tools ───────────────────
echo "📥 Installing development & media tools..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq --no-install-recommends \
    python3 python3-pip python3-venv python3-dev \
    ffmpeg imagemagick poppler-utils \
    zip p7zip-full \
    htop ncdu tree file \
    sqlite3 \
    fonts-liberation fonts-dejavu-core \
    libreoffice-calc libreoffice-writer libreoffice-impress
"

# ── 3. Desktop environment (XFCE, lightweight) ───────
echo "🖥️  Installing XFCE desktop..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq \
    xfce4 xfce4-terminal xfce4-goodies \
    fonts-noto-cjk fonts-noto-color-emoji \
    thunar mousepad ristretto \
    dbus-x11 at-spi2-core
"

# ── 4. VNC server (TigerVNC) ─────────────────────────
echo "📺 Installing TigerVNC..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq tigervnc-standalone-server tigervnc-common
"

# ── 5. noVNC + websockify (browser VNC access) ───────
echo "🌐 Installing noVNC..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq novnc python3-websockify
# Symlink for consistent path
ln -sf /usr/share/novnc /opt/novnc
"

# ── 6. Node.js 22 ────────────────────────────────────
echo "📥 Installing Node.js 22..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs
"

# ── 7. OpenClaw ──────────────────────────────────────
echo "📥 Installing OpenClaw..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
npm install -g openclaw@${OPENCLAW_VERSION}
"

# ── 7b. Python packages for skills ───────────────────
echo "📥 Installing Python packages for skills..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
pip3 install --break-system-packages \
    openpyxl pandas \
    requests beautifulsoup4 lxml \
    python-docx \
    Pillow \
    pyyaml toml \
    markdown \
    chardet
"

# ── 7c. npm global tools ─────────────────────────────
echo "📥 Installing global npm tools..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
npm install -g @doufunao123/asset-gateway
"

# ── 7e. Lark CLI (飞书集成) ───────────────────────────
echo "📥 Installing Lark CLI..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
npm install -g @larksuite/cli
"

# ── 7d. Agent Reach (互联网能力) ─────────────────────
echo "📥 Installing Agent Reach and internet tools..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
pip3 install --break-system-packages \
    https://github.com/Panniantong/agent-reach/archive/main.zip \
    feedparser

# yt-dlp (视频字幕提取)
pip3 install --break-system-packages yt-dlp

# bird CLI (Twitter 读取)
npm install -g @steipete/bird

# mcporter (MCP 工具转接)
npm install -g mcporter

# gh CLI (GitHub)
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo 'deb [arch=\$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
apt-get update -qq && apt-get install -y -qq gh
"

# ── 8. Create node user (uid 1000) ───────────────────
echo "👤 Setting up node user..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
if ! id node &>/dev/null; then
    existing_user=\$(getent passwd 1000 | cut -d: -f1)
    if [ -n \"\$existing_user\" ] && [ \"\$existing_user\" != 'node' ]; then
        usermod -l node -d /home/node -m \"\$existing_user\"
        groupmod -n node \"\$existing_user\" 2>/dev/null || true
    else
        useradd -m -s /bin/bash node
    fi
fi
mkdir -p /home/node/.openclaw /home/node/.openclaw/skills /home/node/.openclaw/credentials /data/workspace
chown -R node:node /home/node /data
"

# ── 9. VNC config for node user ──────────────────────
echo "🔧 Configuring VNC..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
mkdir -p /home/node/.vnc

# VNC startup script — launches XFCE
cat > /home/node/.vnc/xstartup << "XSTARTUP"
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XDG_SESSION_TYPE=x11
exec startxfce4
XSTARTUP
chmod +x /home/node/.vnc/xstartup

# Default VNC password: "openclaw" (changeable later)
echo "openclaw" | vncpasswd -f > /home/node/.vnc/passwd
chmod 600 /home/node/.vnc/passwd

chown -R node:node /home/node/.vnc
'

# ── 10. Systemd services ─────────────────────────────
echo "🔧 Creating systemd services..."
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

cat > /etc/systemd/system/vncserver.service << EOF
[Unit]
Description=TigerVNC Server
After=network-online.target

[Service]
Type=simple
User=node
Group=node
ExecStartPre=/bin/sh -c "/usr/bin/vncserver -kill :1 2>/dev/null || true"
ExecStart=/usr/bin/vncserver :1 -geometry 1920x1080 -depth 24 -localhost no -fg
ExecStop=/usr/bin/vncserver -kill :1
Restart=on-failure
RestartSec=3
Environment=HOME=/home/node

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/novnc.service << EOF
[Unit]
Description=noVNC WebSocket Proxy
After=vncserver.service
Requires=vncserver.service

[Service]
Type=simple
User=node
Group=node
ExecStart=/usr/bin/websockify --web /opt/novnc 6080 localhost:5901
Restart=on-failure
RestartSec=3
Environment=HOME=/home/node

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openclaw.service vncserver.service novnc.service
'

# ── 11. Install JMOS binary ──────────────────────────
echo "📥 Installing JMOS binary..."
JMOS_BIN="$(cd "$(dirname "$0")" && pwd)/jmos"
if [[ -f "$JMOS_BIN" ]]; then
    incus file push "$JMOS_BIN" "${BUILD_INSTANCE}/usr/local/bin/jmos"
    incus exec "${BUILD_INSTANCE}" -- chmod +x /usr/local/bin/jmos
    incus exec "${BUILD_INSTANCE}" -- bash -c '
    mkdir -p /etc/jmos /data/workspace/jamoss/data /data/workspace/jamoss/logs
    chown -R node:node /data/workspace/jamoss

    cat > /etc/systemd/system/jmos.service << EOF
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
    echo "   ✅ JMOS installed"
else
    echo "   ⚠️  JMOS binary not found at $JMOS_BIN, skipping"
fi

# ── 11b. Verify installations ────────────────────────
echo "🔍 Verifying installations..."
incus exec "${BUILD_INSTANCE}" -- bash -c '
set -euo pipefail

echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo "  OpenClaw: $(openclaw --version 2>&1 | head -1 || openclaw --help 2>&1 | head -1)"
echo "  Python: $(python3 --version)"
echo "  pip: $(pip3 --version | cut -d" " -f1-2)"
echo "  ffmpeg: $(ffmpeg -version 2>&1 | head -1)"
echo "  libreoffice: $(libreoffice --version 2>&1 | head -1)"
echo "  imagemagick: $(magick --version 2>&1 | head -1 || convert --version 2>&1 | head -1)"
echo "  poppler: $(pdftotext -v 2>&1 | head -1)"
echo "  sqlite3: $(sqlite3 --version | cut -d" " -f1)"
echo "  asset-gateway: $(asset-gateway --version 2>&1 | head -1 || echo installed)"
echo "  agent-reach: $(agent-reach --version 2>&1 | head -1 || echo installed)"
echo "  yt-dlp: $(yt-dlp --version 2>&1 | head -1)"
echo "  bird: $(bird --version 2>&1 | head -1 || echo installed)"
echo "  mcporter: $(mcporter --version 2>&1 | head -1 || echo installed)"
echo "  lark-cli: $(lark-cli --version 2>&1 | head -1 || echo installed)"
echo "  gh: $(gh --version 2>&1 | head -1)"

python3 - <<"PY"
import bs4
import chardet
import docx
import feedparser
import lxml
import markdown
import openpyxl
import pandas
import requests
import toml
import yaml
from PIL import Image

print(f"  openpyxl: {openpyxl.__version__}")
print(f"  pandas: {pandas.__version__}")
print(f"  requests: {requests.__version__}")
print(f"  beautifulsoup4: {bs4.__version__}")
print(f"  lxml: {lxml.__version__}")
print(f"  python-docx: {docx.__version__}")
print(f"  Pillow: {Image.__version__}")
print(f"  pyyaml: {yaml.__version__}")
print(f"  toml: {toml.__version__}")
print(f"  markdown: {markdown.__version__}")
print(f"  chardet: {chardet.__version__}")
print(f"  feedparser: {feedparser.__version__}")
PY

test -d /home/node/.openclaw/skills
test -d /home/node/.openclaw/credentials
echo "  node skill dirs: ok"

if command -v jmos >/dev/null 2>&1; then
    echo "  JMOS binary: $(command -v jmos)"
else
    echo "  JMOS binary: skipped"
fi
'

# ── 12. Clean up ─────────────────────────────────────
echo "🧹 Cleaning up..."
incus exec "${BUILD_INSTANCE}" -- bash -c "
apt-get autoremove -y -qq
apt-get clean
npm cache clean --force
pip3 cache purge || true
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
rm -rf /root/.cache/pip
"

# ── 13. Publish image ────────────────────────────────
echo "📸 Stopping VM and publishing as '${IMAGE_ALIAS}'..."
incus stop "${BUILD_INSTANCE}"
incus publish "${BUILD_INSTANCE}" --alias "${IMAGE_ALIAS}" \
    --compression zstd
incus delete "${BUILD_INSTANCE}"

echo ""
echo "✅ Desktop VM image '${IMAGE_ALIAS}' built successfully!"
echo ""
echo "   Image type: VIRTUAL-MACHINE"
echo "   Desktop: XFCE4"
echo "   VNC: TigerVNC :1 (port 5901)"
echo "   noVNC: websockify :6080"
echo "   OpenClaw: port 18789"
echo "   Preinstalled Python: openpyxl, pandas, requests, python-docx, Pillow"
echo "   Preinstalled tools: asset-gateway, ffmpeg, ImageMagick, poppler-utils, sqlite3"
echo "   Internet: agent-reach, bird (Twitter), yt-dlp (YouTube/B站), mcporter (MCP), gh CLI"
echo "   Conversion stack: LibreOffice Writer/Calc/Impress"
echo ""
echo "   Test: incus launch ${IMAGE_ALIAS} test-vm --vm -c limits.cpu=2 -c limits.memory=2GiB"
