# VRM Base Models

These VRM models are from the [100Avatars](https://www.100avatars.com/) collection by [Polygonal Mind](https://polygonalmind.com/).

**License: CC0 1.0 Universal (Public Domain)**

No attribution required. Free for any use.

## Models

| File | Source | Size |
|------|--------|------|
| `base-female.vrm` | 100Avatars R1 #056 "Olivia" | ~1.0 MB |
| `base-male.vrm` | 100Avatars R1 #019 "Wizzir" | ~1.3 MB |
| `base-neutral.vrm` | 100Avatars R1 #012 "Chill" | ~1.1 MB |

## Usage

These models are loaded by `AvatarPool.ts` at runtime. The pool applies role-specific color tinting (shader) to differentiate agents by role (planner=blue, executor=orange, reviewer=green, patrol=purple).

If no VRM files are found, the system falls back to colored capsule-shaped placeholder meshes.

## Source

- Registry: https://github.com/ToxSam/open-source-avatars
- Collection: https://www.100avatars.com/
- Permanent hosting: Arweave (IPFS)
