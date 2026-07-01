# YouBox Agent Fork Notes

This repository is a YouBox integration fork of `craft-ai-agents/craft-agents-oss`.

## Branch model

- `main-upstream` tracks `craft-ai-agents/craft-agents-oss/main` with no YouBox patches.
- `youbox-integration` contains YouBox-specific changes.
- `release/*` branches are cut from `youbox-integration` for signed desktop releases.

## Integration constraints

- YouBox Core is the identity provider and model gateway.
- YouBox is the only product/provider surface; Pi-compatible runtime code is retained only as the hidden local adapter that drives the desktop agent through YouBox Gateway.
- The desktop app must not expose external provider setup in YouBox product builds.
- Agent workspace/session data belongs to the Agent data domain, not the YouBox Core DB.
- Keep YouBox patches isolated and additive where possible so upstream merges stay tractable.

## Current first-pass fork changes

- App name, app id, update URL, artifact names, and config directory default are YouBox-owned.
- `CRAFT_CONFIG_DIR` remains supported as an upstream-compatible override.
- `YOUBOX_AGENT_CONFIG_DIR`, `YOUBOX_APP_NAME`, and `YOUBOX_DEEPLINK_SCHEME` are the preferred YouBox overrides.
