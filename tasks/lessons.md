# Lessons

- 2026-06-30: When reviewing Game Studio plans, judge from the product workflow first. Avoid turning project detection/build/publish conventions into hard platform features; prefer minimal platform primitives and delegate flexible workflow logic to skills/agent behavior.
- 2026-06-30: For Game Studio, don't confuse "avoid hardcoded workflow logic" with "no Studio UI." The target is workflow plus visualization panels: platform should provide durable panels/state surfaces, while skills/agents own project-specific build/preview/publish decisions.
- 2026-06-30: If the product scope is narrowed to React-based games, embrace that constraint instead of designing broad engine/framework detection. A deliberate stack choice can simplify Studio UX, skills, panels, and publish semantics.
- 2026-06-30: When discussing a React-based Game Studio, distinguish React as Studio/project UI shell from React as the game runtime. React-only can be a poor fit for tight game loops; consider React shell + Canvas/Pixi/Phaser/Three core as a stronger default.
- 2026-07-01: For OriginAI/JAcoworks-Next, do not treat the old `~/JAcoworks` checkout as production source of truth. It is historical only; gateway, website/admin, deploy/release scripts, and system skills should be maintained and deployed from the current `JAcoworks-Next` repo.
