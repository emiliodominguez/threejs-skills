---
name: threejs-upgrade
description: "Linter and migration guide for outdated three.js and R3F code: removed or renamed APIs, old imports, color and lighting changes. Use when upgrading three or R3F, on not-exported errors, or reviewing generated 3D code. Hands off to `threejs-model-fix`."
---

# Upgrade outdated three.js code

Models trained on years of three.js write APIs that no longer exist: `outputEncoding`, `sRGBEncoding`, `Clock`,
`RGBELoader`, `three/examples/js`, `useLegacyLights`, `mergeBufferGeometries`. Some throw, some silently change
colors or lighting. Find them mechanically, fix the one-to-one renames automatically, and handle the rest by hand.

Paths: `<this-skill-dir>` is the directory containing this SKILL.md; replace it with that absolute path. The script
needs only Node 22+.

## Process

1. Run the linter over the project's source (it skips `node_modules`, build output and minified files):

   ```bash
   node "<this-skill-dir>/scripts/lint.mjs" src
   node "<this-skill-dir>/scripts/lint.mjs" src --json            # for scripting
   node "<this-skill-dir>/scripts/lint.mjs" docs --md             # fenced code blocks in Markdown
   ```

   Levels: `removed` breaks on r186 (exit code 1), `deprecated` still works but warns, `outdated` works but is not
   current practice, `upcoming` changes in the next release. Each finding names the release it changed in.
2. Read the version lines first. If `three` is more than about 10 releases behind, upgrade in steps of 10 (deprecation
   warnings live for 10 releases, so each step shows what the next removes); R3F 9 needs React 19.
3. Apply the safe renames with `--fix` on a clean working tree, then review the diff. It never touches Markdown or
   comments, and only rewrites rules marked `(--fix)`.
4. Fix the remaining findings by hand with `references/manual-migrations.md`, which covers the changes that need
   judgment: light intensities after physical units, color management, `Clock` to `Timer`, TransformControls
   helpers, R3F v8 to v9, and WebGPU imports.
5. Run the app and check the console: three.js prints `deprecated` and `has been removed` warnings the linter cannot
   see (dynamic property names, values computed at runtime). Compare screenshots before and after for lighting and
   color changes; the r155 and r181 releases change how PBR materials look even with correct code.
6. Re-run the linter until it reports no `removed` findings.

Suppress a deliberate use with `// three-lint-disable-line` on that line, or `three-lint-disable-file` in the file.

## Anti-patterns

- Bumping `three` 40 releases at once and debugging everything at the same time.
- Restoring old behavior with compatibility flags that no longer exist (`useLegacyLights`, `ColorManagement.legacyMode`).
- Multiplying every light intensity blindly after the lighting change instead of checking each scene on screen.
- Treating `upcoming` findings as errors on r186; they are a heads-up for r187.

## Done when

- The linter reports no `removed` findings, and remaining `deprecated` ones are fixed or recorded.
- The app runs with no three.js deprecation warnings in the console.
- Lighting and colors were compared on screen before and after.

Next: `threejs-model-fix` if models render differently after the upgrade.
