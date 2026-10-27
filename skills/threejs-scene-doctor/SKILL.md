---
name: threejs-scene-doctor
description: "Runtime diagnosis of a running three.js or R3F app: draw calls, triangles, GPU memory leaks, missing lights, color spaces, stuck mixers. Use when an app is slow, leaks or renders wrong and the model file is fine. Hands off to `threejs-performance`."
---

# Diagnose a running scene

`threejs-model-inspect` checks the file; this checks the app. The doctor captures the app's renderer, scenes and
animation mixers through three.js's official `__THREE_DEVTOOLS__` hook, so it needs no changes to the app and works
with React Three Fiber.

Paths: `<this-skill-dir>` is the directory containing this SKILL.md; replace it with that absolute path. The script
needs Node 22+, a Chrome-family browser, and `threejs-model-inspect` installed next to this skill.

## Process

1. Start the app (dev server or a built `index.html`) and run the doctor against it:

   ```bash
   node "<this-skill-dir>/scripts/doctor.mjs" http://localhost:5173
   node "<this-skill-dir>/scripts/doctor.mjs" dist/index.html --wait 8000          # served from its folder
   node "<this-skill-dir>/scripts/doctor.mjs" http://localhost:5173 --click "#start" --screenshot shot.png
   node "<this-skill-dir>/scripts/doctor.mjs" http://localhost:5173 --json
   node "<this-skill-dir>/scripts/doctor.mjs" http://localhost:5173 --watch 10                 # leak check
   ```

   It finds the app's main scene even behind post-processing (the largest scene rendered recently, not the
   composer's full-screen quad). A single snapshot cannot prove a leak, because render targets, shadow maps and
   thumbnail scenes hold GPU resources too, so surplus counts are only `info`. `--watch N` measures GPU memory
   over N idle seconds; growth there is the real leak signal.

   `--wait` covers loading (raise it for heavy scenes); `--click` gets past a start button or loading gate.
2. Read the findings. `error` means broken (no light at all, a mixer that never advances); `warn` means a visible or
   measurable problem; `info` is a lead. The stats line gives draw calls, triangles, shader programs, GPU memory,
   and the scene's materials, textures and lights.
3. Act on the finding, not on fps. Headless browsers render on the CPU, so frame times there are only indicative.
   Counts are exact: fix draw calls with instancing or merging, leaks with `dispose()`, black scenes with lights or
   an environment, washed-out textures with `colorSpace`. `threejs-performance` covers the techniques in depth.
4. To watch memory over time or check an interaction in a real browser, load the snippet before the app and use
   the console:

   ```html
   <script src="scene-doctor.js"></script> <!-- copied from <this-skill-dir>/assets/, before the app's scripts -->
   ```

   then `await threejsDoctor.report()` and `const stop = threejsDoctor.watch(5000)`; GPU memory that keeps growing
   while the scene stays the same is a leak. When the snippet loads after three.js, pass the objects instead:
   `threejsDoctor.report({ renderer, scene, camera })`.
5. Re-run the doctor after each fix and compare the stats.

## Anti-patterns

- Optimizing from headless fps numbers. Confirm timing in a real browser with the same counts.
- Calling a leak fixed because the page reloads clean; leaks show after repeated navigation or model swaps, which is
  what `watch()` is for.
- Adding the snippet to production builds. It is a development tool.

## Done when

- The doctor reports no `error` findings, and each `warn` is fixed or explained.
- Stats before and after the change are quoted (draw calls, memory, triangles).

Next: `threejs-performance` for deeper optimization of what the doctor found.
