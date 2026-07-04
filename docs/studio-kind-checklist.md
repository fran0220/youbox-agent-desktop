# Adding a Studio kind

Studio is the only top-level creative mode. New creative surfaces should be added as a `StudioKind`, not as a new app mode.

## Navigation contract

- Add the kind to `StudioKind` in `apps/electron/src/shared/types.ts`.
- Add canonical routes under `studio/{kind}` and `studio/{kind}/{artifactId}`.
- Keep old routes as parse-only aliases if the kind replaces an existing surface.
- `buildRouteFromNavigationState()` must emit only `studio/*`.
- `APP_MODES` must remain `work | studio`.
- Global app mode entry lives in the persistent Global Rail; compact mode keeps
  the TopBar dropdown fallback.
- Studio list routes (`studio` and `studio/{kind}`) show the Studio mode
  navigator. Studio artifact routes (`studio/{kind}/{artifactId}`) may hide the
  mode navigator, but the Global Rail remains visible unless focus mode is on.

## Runtime and storage contract

- Keep per-kind runtime channels stable. Do not rename existing wire strings such as `canvas:*`, `design:*`, `gamestudio:*`, or `gamePane:*`.
- Keep existing on-disk directories stable unless a dedicated migration is planned and tested.
- Add the kind to `studio:listRecents` only after its metadata exposes `id`, `name`, `createdAt`, `updatedAt`, `version`, and optional `sessionId`/`thumbnailPath`.

## UI contract

- Add a card on `StudioHomePage`.
- Add the kind to `StudioNavigator` so it appears in the Studio mode navigator.
- Route artifact pages from `MainContentPanel` by `navState.kind`.
- If artifacts bind to a Work session, surface the relationship in both directions:
  - Work session list badge opens `studio/{kind}/{artifactId}`.
  - Studio recents or project chrome can open the bound Work session.

## Tests

- Parser tests must prove old aliases parse and canonical serialization emits `studio/*`.
- App-mode tests must prove only `work` and `studio` are exposed.
- IPC tests must prove new additive channels do not mutate existing wire strings.
