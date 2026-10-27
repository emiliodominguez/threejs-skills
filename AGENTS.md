# AGENTS.md - threejs-skills

Project guidance for agent sessions working in this repository. Global user instructions still apply.

## What this is

Source of truth for the `threejs*` skill collection, distributed from GitHub through the open skills CLI
(`npx skills add emiliodominguez/threejs-skills`). `.claude-plugin/` manifests are an optional marketplace channel.

## Layout

- `skills/<name>/SKILL.md`, with `references/*.md` loaded on demand, `scripts/` run through their interpreter and
  `assets/` copied into projects.
- Own skills: `threejs` (router), `threejs-model-*` except `threejs-model-generate`, `threejs-scene-doctor`,
  `threejs-upgrade`, `threejs-scroll`, `threejs-physics`, `threejs-splats`, `threejs-webxr`, `threejs-assets` and
  `web3d-model-viewer`.
- Forks carry `metadata.source` in frontmatter (cloudai-x foundations, `threejs-model-generate`). Keep fork edits
  minimal so upstream changes can be re-applied; record every change in `THIRD_PARTY_NOTICES.md`.
- `profiles.json` groups skills for `install.sh`; every skill must be in a profile.

## Required gate

Run `pnpm check` (format check, `pnpm validate`, `pnpm check:api`, `node --test`) before committing. Run
`pnpm examples` when a recipe or the render harness changes, and `pnpm upstream` before a release.

## Correctness tooling

- `scripts/check-api.mjs` resolves every import and `THREE.X` in skills and examples against the pinned packages in
  devDependencies. When a skill documents a new library, add it there at the exact documented version and to
  `DOCUMENTED` in `scripts/check-upstream.mjs`.
- `examples/<name>/` mirrors a recipe as a runnable page; it publishes `window.__exampleResult` with behavioral checks.
- `evals/fixtures.mjs` builds the broken-model collection; each fixture lists the inspect findings it must produce.
  `scripts/eval.mjs` runs agents with and without skills; agent runs cost tokens, so ask before running many.
- Graders and checks: a passing result is not proof. Look at the rendered PNG before trusting a new check.

## Skill authoring

- Descriptions lead with what the skill is, then `Use when` triggers, stay under 300 characters (forks 420), and
  end with `Hands off to`, `Routes to` or `Feeds` naming skills in backticks. Never summarize the procedure.
- Bodies: process, `## Anti-patterns`, `## Done when`, final line naming the next skill. Keep them short; move
  stack-specific code (vanilla vs R3F) into separate reference files.
- Bodies name no host, tool or model. Refer to other skills by backticked name.
- Scripts are zero-dependency ESM (`.mjs`) runnable with plain `node`, or stdlib Python. Anything they need at
  runtime goes through `npx` with a pinned major. Add a test in `test/` for every script behavior.
- Check API claims against the pinned versions (three r186, R3F 9, drei 10, gltf-transform 4) in package source,
  not from memory.

## Conventions

- Conventional commits; no `Co-Authored-By` trailers.
- Function declarations over arrow functions (callbacks excepted), tabs (width 4), print width 150, JSDoc on every
  script function.
