---
name: releasing-desktop
description: "Releases OriginAI Electron Desktop from the current JAcoworks-Next repo — version bump, macOS/Windows/Linux artifact collection, COS upload, DB registration, git tag. Use when the user says 'release', 'publish', '发版', '发布版本', or mentions a version number like 'v1.6.1'."
---

# Releasing OriginAI Electron Desktop

End-to-end release workflow for the OriginAI Electron desktop app. The current JAcoworks-Next repo is the production source of truth for Electron, gateway, website/admin, deploy scripts, release metadata, and system skills. The old `~/JAcoworks` repo is historical only.

## Prerequisites

Verify before starting — **do NOT skip**:

1. Run commands from the current `JAcoworks-Next` repo root.
2. `deploy/.env.release` exists in this repo (secrets: COS, DB, Apple certs).
3. Apple signing identity in Keychain: `Developer ID Application: fan Z (9UUWCMKMDH)`.
4. SSH tunnel for DB: `ssh -L 5432:127.0.0.1:5432 jingao -N -f`.
5. Optional Windows/Linux builders have already produced their Electron artifacts if those platforms will be included.

## Release Workflow

Execute these steps **in order**. Each step must succeed before proceeding.

### Step 1: Commit & Push

Stage only files related to the release. Never `git add -A`.

```bash
git add <relevant files>
git commit -m "<conventional commit message>"
git push origin main
```

### Step 2: Bump Version

```bash
make release-bump V=<version>
# Verify:
node -p "require('./package.json').version"
node -p "require('./apps/electron/package.json').version"
```

Then commit and push the bump:

```bash
git add package.json apps/electron/package.json bun.lock
git commit -m "chore(desktop): bump version to <version>"
git push origin main
```

### Step 3: Build macOS Electron artifacts (arm64 + x64)

```bash
make release-build V=<version>
```

This calls the OriginAI Electron per-architecture build script from this repo, stages the correct Bun / SDK native binary for each arch, signs if signing env is present, and produces DMG + updater ZIP artifacts.
Output in this repo: `dist-release/<version>/darwin-{aarch64,x86_64}/`

Expected artifacts per platform:
- `OriginAI-arm64.dmg` / `OriginAI-x64.dmg` (installer download assets)
- `OriginAI-arm64.zip` / `OriginAI-x64.zip` (electron-updater assets)
- optional `.blockmap` files

### Step 4: Build Windows / Linux Electron artifacts

The upload script registers any platform directory already present under `dist-release/<version>/`.
Expected names:

- `dist-release/<version>/windows-x86_64/OriginAI-x64.exe`
- `dist-release/<version>/linux-x86_64/OriginAI-x64.AppImage`

Build Windows on the Windows builder from this repo, then copy the installer into this repo's `dist-release` directory:

```bash
VERSION=<version>
mkdir -p dist-release/${VERSION}/windows-x86_64
# Run apps/electron/scripts/build-win.ps1 on the Windows builder, then copy:
#   <OriginAI repo>/apps/electron/release/OriginAI-x64.exe
# into dist-release/${VERSION}/windows-x86_64/
```

### Step 5: Upload COS + Register DB + Git Tag

```bash
make release-upload V=<version>
git push origin v<version>
```

This uploads all platform directories to COS, registers the release in PostgreSQL (`releases` + `release_assets` tables, `is_latest=true`), computes electron-updater `sha512` for updater assets, and creates a git tag in the OriginAI source repo.

If you get `mktemp: mkstemp failed on /tmp/cos-release-XXXX.yaml: File exists`, run:
```bash
rm -f /tmp/cos-release-*.yaml
```

### Step 6: Update Release Notes (optional)

Via admin panel or SQL:
```bash
source deploy/.env.release
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U postgres -d jacoworks \
  -c "UPDATE releases SET notes = '...' WHERE version = 'v<version>';"
```

### Step 7: Deploy Gateway + Website

```bash
make deploy
```

Makes the new release visible on the download page and enables the gateway Electron updater feed under `/api/desktop/release/latest*.yml`.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `mkstemp failed` during upload | `rm -f /tmp/cos-release-*.yaml` |
| Electron updater hash mismatch | Ensure `release_assets.signature` is the base64 SHA-512 of the exact uploaded `.zip` / `.exe` / `.AppImage` |
| Windows build cannot find artifacts | Copy `apps/electron/release/OriginAI-x64.exe` into `dist-release/<version>/windows-x86_64/` before `release-upload` |
| Notarization timeout | Retry or set `SKIP_NOTARIZE=1` for testing |
| DB unreachable | `ssh -L 5432:127.0.0.1:5432 jingao -N -f` |
| Local PG occupies 5432 | `brew services stop postgresql@14` → tunnel → `brew services start postgresql@14` after release |
| VM not running | `ssh local 'virsh start win-build'` then wait 60s |
| Windows log frozen at "vite built in Xs" | Check the builder's `apps/electron/release/` directory for `OriginAI-x64.exe` before retrying |
| SCP local↔Mac stalls at ~5 KB/s | Tailscale uses DERP relay (~770ms RTT). **Don't pull large files Mac↔local** — see "Slow link workaround" below |

### Slow link workaround (Mac↔local via Tailscale relay)

If `ping local` shows >300ms RTT, the link is on a DERP relay and SCP large files
is unusable (~2.5 KB/s for 200MB+). **Mac→COS direct works at 12 MB/s** because COS
endpoints in `cos.ap-beijing.myqcloud.com` are direct internet, not via relay.

Pattern: upload Windows from `local`, upload macOS from Mac, register DB manually.

```bash
# 1. Install coscli on local (one-time, fast — local is in China region)
ssh local 'mkdir -p ~/.local/bin && curl -sSL -o ~/.local/bin/coscli \
  https://cosbrowser.cloud.tencent.com/software/coscli/coscli-linux-amd64 && \
  chmod +x ~/.local/bin/coscli'

# 2. Push secrets to local (small, private temp file; cleaned on exit)
source deploy/.env.release
REMOTE_COS_CFG=$(ssh local 'umask 077; mktemp /tmp/cos-cfg.XXXXXX.yaml')
MAC_COS_CFG=$(umask 077; mktemp /tmp/cos-cfg-mac.XXXXXX.yaml)
cleanup_cos_cfg() {
  ssh local "rm -f '$REMOTE_COS_CFG'" 2>/dev/null || true
  rm -f "$MAC_COS_CFG"
}
trap cleanup_cos_cfg EXIT

ssh local "cat > '$REMOTE_COS_CFG' <<EOF
cos:
  base:
    secretid: ${COS_SECRET_ID}
    secretkey: ${COS_SECRET_KEY}
  buckets:
    - name: jingao-1350796151
      alias: cos
      endpoint: cos.ap-beijing.myqcloud.com
EOF
chmod 600 '$REMOTE_COS_CFG'"

# 3. Upload Windows from local (file already in /tmp from build); takes ~20s for 210MB
VERSION=X.Y.Z
ssh local "~/.local/bin/coscli cp -c '$REMOTE_COS_CFG' \
  /tmp/OriginAI-x64.exe \
  cos://jingao-1350796151/releases/v${VERSION}/windows-x86_64/OriginAI-x64.exe"

# 4. Upload macOS from Mac in parallel (2× zip + 2× dmg + optional blockmaps)
cat > "$MAC_COS_CFG" <<EOF
cos:
  base:
    secretid: ${COS_SECRET_ID}
    secretkey: ${COS_SECRET_KEY}
  buckets:
    - name: jingao-1350796151
      alias: cos
      endpoint: cos.ap-beijing.myqcloud.com
EOF
chmod 600 "$MAC_COS_CFG"
for plat in darwin-aarch64 darwin-x86_64; do
  for f in dist-release/${VERSION}/$plat/*; do
    fname=$(basename "$f")
    ~/.local/bin/coscli cp -c "$MAC_COS_CFG" "$f" \
      "cos://jingao-1350796151/releases/v${VERSION}/$plat/$fname"
  done
done

# 5. Verify files in COS
~/.local/bin/coscli ls -c "$MAC_COS_CFG" \
  cos://jingao-1350796151/releases/v${VERSION}/ -r

# 6. Register DB manually — release.sh's DB step needs the .exe present locally,
#    but with this workaround it isn't. Build SQL with sizes from coscli ls
#    output + sha512_base64(file) values. Template:
#
#    BEGIN;
#    UPDATE releases SET is_latest = false WHERE is_latest = true;
#    INSERT INTO releases (id, version, notes, pub_date, is_latest)
#      VALUES (gen_random_uuid()::text, '${VERSION}', '...', now(), true)
#      ON CONFLICT (version) DO UPDATE SET is_latest = true, notes = EXCLUDED.notes;
#    -- one INSERT per asset:
#    --   darwin-aarch64         → OriginAI-arm64.dmg, signature=sha512_base64(dmg)
#    --   darwin-aarch64-updater → OriginAI-arm64.zip, signature=sha512_base64(zip)
#    --   darwin-x86_64          → OriginAI-x64.dmg, signature=sha512_base64(dmg)
#    --   darwin-x86_64-updater  → OriginAI-x64.zip, signature=sha512_base64(zip)
#    --   windows-x86_64         → OriginAI-x64.exe, signature=sha512_base64(exe)
#    COMMIT;
#
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U postgres -d jacoworks -f /tmp/release-${VERSION}.sql

# 7. Tag + push manually since we skipped release.sh upload phase
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin "v${VERSION}"

# 8. make deploy
```

**Why this works**: COS endpoints accept direct HTTPS from anywhere; only the SSH
control-plane to `local` (used for the Windows build) goes through the relay.
After upload all clients hit COS directly, no relay involved.

## Makefile Quick Reference

```bash
make release-bump V=X.Y.Z      # Bump version only
make release-build V=X.Y.Z     # macOS build (arm64 + x86_64, sign + notarize)
make release-upload V=X.Y.Z    # Upload COS + register DB + git tag
make release V=X.Y.Z           # All-in-one (bump + macOS build + upload, NO Windows)
```

## File Locations

| Item | Path |
|------|------|
| Release script | `deploy/release.sh` |
| Release secrets | `deploy/.env.release` |
| OriginAI source repo | current `JAcoworks-Next` checkout |
| Electron config | `apps/electron/electron-builder.yml` |
| Build artifacts | `dist-release/<version>/` |
| COS bucket | `jingao-1350796151` (ap-beijing) |
| Win-build VM | `192.168.122.177` via `local` (100.97.254.31) |
