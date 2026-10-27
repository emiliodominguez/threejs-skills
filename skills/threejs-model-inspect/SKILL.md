---
name: threejs-model-inspect
description: "Report of what a glTF/GLB model contains and what three.js needs to load it: node and material names, clips, bones, bounds, texture sizes, decoders. Use when handed a 3D model or before writing code that loads it. Hands off to `threejs-model-fix` or `threejs-model-optimize`."
---

# Inspect a 3D model

Code that loads a model depends on facts only the file knows: node names, clip names, bone names, scale, required
decoders. Guessed names fail silently (`getObjectByName` returns `undefined`, a missing clip plays nothing), so read
the file before writing code against it.

Paths: `<this-skill-dir>` is the directory containing this SKILL.md. Replace it with that absolute path, quote
paths in commands, and keep the working directory in the user's project. Bundled scripts need only Node 22+;
`render.mjs` also needs a Chrome-family browser.

## Process

1. If the model is not `.glb` or `.gltf` (FBX, OBJ, USDZ, STL, DAE, PLY), read `references/converting.md` and convert
   it first. Everything downstream assumes glTF.
2. Run the bundled script. It has no dependencies and never decodes geometry, so it is fast on any file, compressed
   or not:

   ```bash
   node <this-skill-dir>/scripts/inspect.mjs path/to/model.glb
   node <this-skill-dir>/scripts/inspect.mjs path/to/model.glb --json      # for scripting
   node <this-skill-dir>/scripts/inspect.mjs path/to/model.glb --max-nodes 300
   ```

   Exit code 2 means an `error` finding: the model will not load as-is.
3. Read the findings first. `error` blocks loading, `warn` usually shows on screen, `info` is context. Visual
   symptoms (black, invisible, giant, inside-out) go to `threejs-model-fix`; size, texture and draw-call findings go
   to `threejs-model-optimize`.
4. Use the report's values in code instead of placeholders:
   - Node names in the tree are already converted to three.js names (spaces become `_`, `[ ] . : /` are dropped,
     so Mixamo `mixamorig:Hips` becomes `mixamorigHips`). Nodes tagged `duplicate name` get `_1`, `_2` suffixes in
     load order; reach them by traversal or path, not by name.
   - A node tagged `Group of N meshes` loads as a `Group` with one child `Mesh` per material, not as a `Mesh`.
   - Clip names and durations come from `## Animations`; `skeletal` means bones are animated.
   - `## Decoders` lists the exact loader calls the file needs.
   - Bounds give the size and center to frame the camera and set near/far.
5. Look at the model. The report says what is in the file; a render shows whether it is right:

   ```bash
   node <this-skill-dir>/scripts/render.mjs path/to/model.glb                    # six-view contact sheet PNG
   node <this-skill-dir>/scripts/render.mjs model.glb --clip Run --time 0.4      # posed on a clip
   node <this-skill-dir>/scripts/render.mjs before.glb --compare after.glb       # A, B and a pixel-diff row
   ```

   It drives a headless Chrome or Chromium (set `CHROME_PATH` if it is not found) over the bundled reference viewer,
   writes the PNG next to the model, and prints triangles, draw calls, bounds, clips and console errors. Open the
   PNG and describe what you see; do not report a model as fine without looking at it.
6. Answer what was asked from the report (size budget, parts list, clip list) and quote numbers, not impressions.

## Reading the numbers

- Size breakdown tells where the bytes are: geometry-heavy files want mesh compression or simplification;
  texture-heavy files want resizing or KTX2.
- Texture GPU memory is an estimate with mipmaps: PNG, JPEG and WebP decode to 4 bytes per pixel on the GPU
  regardless of download size. KTX2 stays compressed.
- Triangles and draw calls include GPU instancing. One draw call per primitive is the floor before joining.

## Anti-patterns

- Writing `getObjectByName("Wheel")` or `actions["Run"]` before checking the names exist.
- Treating a small download as a small model: a 2 MB JPEG-textured file can need 100 MB of GPU memory.
- Converting or optimizing over the original file; keep the source as the master copy.

## Done when

- The script ran on the actual file the project loads, and its findings are acknowledged or routed.
- A contact sheet was rendered and looked at, unless no browser is available (say so).
- Code uses names, clips and decoders taken from the report.

Next: `threejs-model-fix` for anything that renders wrong, `threejs-model-optimize` before shipping.
