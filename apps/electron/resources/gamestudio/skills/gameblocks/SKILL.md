---
name: gameblocks
description: Build browser-playable 3D games for Game Studio projects using local files and vendored runtime modules.
---

# GameBlocks

Use this skill when the user asks Game Studio to create or repair a browser game.

## Workflow

1. Read `gameblocks_usage.md` and the current `index.html` / `src/main.js`.
2. Keep the project playable from `index.html` through the local static server.
3. Use vendored dependencies from `vendor/` only:
   - `./vendor/three.module.js` for Three.js rendering
   - `./vendor/rapier.es.js` for physics if needed
4. Do not use external CDNs, package managers, or network assets unless the user explicitly asks and grants permission.
5. Add clear in-game instructions for controls and win/fail conditions.
6. After a playable change, tell the user to click the Game Studio screenshot/checkpoint button.

## Recommended structure

- Small games: keep code in `src/main.js`.
- Larger games: split into `src/game.js`, `src/input.js`, `src/ui.js`, then import from `src/main.js`.
- Assets should live under `assets/` and be referenced relatively.

## Repair loop

When the user sends runtime console details:

1. Reproduce from the stack/message mentally against the current files.
2. Patch the smallest file set.
3. Keep previous gameplay intent intact.
4. Avoid silencing errors without fixing the underlying broken object/import/control flow.
