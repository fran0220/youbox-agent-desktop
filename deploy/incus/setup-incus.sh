#!/usr/bin/env bash
# One-time Incus setup for JAcoworks OpenClaw containers.
# Run on the local server (x86_64 Ubuntu 22.04+).
set -euo pipefail

echo "📦 Installing Incus from Zabbly repository..."
if ! command -v incus &>/dev/null; then
    curl -fsSL https://pkgs.zabbly.com/get/incus-stable | sudo bash
else
    echo "   Incus already installed: $(incus version)"
fi

echo ""
echo "🔧 Initializing Incus (if not already done)..."
if ! incus storage list --format csv 2>/dev/null | grep -q default; then
    incus admin init --auto --storage-backend=dir
    echo "   Initialized with 'dir' storage backend"
    echo "   (For production, consider 'btrfs' or 'zfs' for CoW snapshots)"
else
    echo "   Already initialized"
fi

echo ""
echo "📂 Creating data directories..."
sudo mkdir -p /srv/jacoworks/openclaw
sudo chown root:root /srv/jacoworks/openclaw

echo ""
echo "✅ Incus setup complete!"
echo ""
echo "Next steps:"
echo "  1. Build golden image: ./deploy/incus/build-openclaw-image.sh"
echo "  2. Deploy oc-gateway:  make deploy-oc-gateway"
