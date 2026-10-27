---
name: threejs-model-optimize
description: "Shrinking a glTF/GLB model for the web with use-case presets over gltf-transform, plus a before/after report and the loader wiring the output needs. Use when a model is too big, slow to load, heavy on GPU memory, or about to ship. Hands off to `threejs-model-fix`."
---

# Optimize a model

`gltf-transform optimize` with default flags joins named meshes, merges materials into palettes and flattens the
hierarchy. That is right for scenery and silently breaks any code that finds parts by name, swaps materials or
attaches objects to nodes. Pick a preset from what the app does with the model, then check that the names it uses
survived.

Paths: `<this-skill-dir>` is the directory containing this SKILL.md and `<inspect-skill-dir>` the one containing
`threejs-model-inspect`'s; replace them with absolute paths and quote them. The script needs Node 22+ and `npx`
with network access; its before/after report needs `threejs-model-inspect` installed next to this skill.

## Process

1. Run `threejs-model-inspect` on the source and note where the bytes are (geometry, textures, animation) and which
   names, materials and clips the app references (search the code for `getObjectByName`, `nodes.`, `materials.`,
   clip names). Check for an existing pipeline first (package.json scripts running `gltfpack` or `gltf-transform`,
   a generator of `gltfpack` in the report): files it already compressed rarely shrink further. Improve that
   pipeline's flags instead of replacing it, and keep the original whenever the script reports no meaningful gain.
2. Choose a preset:

   | Preset | Use for | Trades |
   | --- | --- | --- |
   | `web` (default) | most models | nothing visible; textures capped at 2048 px |
   | `hero` | the model the camera lingers on | larger file; textures up to 4096 px |
   | `configurator` | parts recolored, swapped, hidden or attached at runtime | keeps hierarchy and separate meshes, so more draw calls |
   | `animated` | rigged or animated characters | no simplification |
   | `background` | props and scenery | simplified geometry, 1024 px textures, names and materials merged |
   | `mobile` | phones, low GPU memory | KTX2 textures (needs the `ktx` CLI), light simplification |
   | `lossless` | cleanup with no decoders at runtime | little size saved |

3. Run the script. It never writes over the input; the default output is `<name>.<preset>.glb` next to it:

   ```bash
   node <this-skill-dir>/scripts/optimize.mjs model.glb --preset web
   node <this-skill-dir>/scripts/optimize.mjs model.glb public/model.glb --preset configurator
   node <this-skill-dir>/scripts/optimize.mjs model.glb --preset web --draco          # Draco instead of meshopt
   node <this-skill-dir>/scripts/optimize.mjs model.glb --preset web -- --texture-size 1024   # extra gltf-transform flags
   node <this-skill-dir>/scripts/optimize.mjs --list
   ```

4. Read the report: the before/after table, `Names removed by this pass` and the loader wiring. If a removed name is
   used in code, rerun with `configurator` or pass `-- --join false --flatten false`.
5. Wire the decoders the report lists into the loader (`threejs-model-fix` has the error table). drei `useGLTF`
   already wires Draco and meshopt.
6. Compare the output with the original visually. The script prints the exact command; it renders both through
   `threejs-model-inspect`'s `render.mjs` with identical framing and a pixel-diff row:

   ```bash
   node <inspect-skill-dir>/scripts/render.mjs model.glb --compare model.web.glb --max-diff 2
   ```

   Look at the image, not just the percentage: under 1% is usually texture recompression; red outlines around the
   silhouette mean simplification moved geometry; a whole part in red means it was dropped or re-materialed. For
   animated models add `--clip <name> --time <s>` to compare a pose.

## Choosing codecs

- **meshopt** (default): compresses geometry, morph targets and animation, decodes fastest, and gains more with gzip
  or brotli on the server. **Draco** compresses static geometry a little smaller but not animation; use it when the
  app already ships a Draco decoder and nothing is animated.
- **WebP** shrinks the download only; GPU memory stays width x height x 4 bytes. **KTX2** stays compressed on the
  GPU: choose it when the inspect report's texture GPU memory is the problem (mobile, many textures).
- Deeper control (individual commands, scripting, KTX2 slots, gltfjsx `--transform` for R3F) is in
  `threejs-asset-pipeline`.

## Anti-patterns

- Optimizing in place, or committing only the optimized file and losing the source.
- Running the default `gltf-transform optimize` on a configurator model, then debugging `undefined` parts.
- Chaining another command after Draco or meshopt: it decodes and rewrites the geometry uncompressed. Compression
  runs last, which the script already does.
- Shipping without loading the output once.

## Done when

- The output is smaller (or lighter on GPU memory) by a measured amount, quoted from the report.
- Every name, material and clip the code uses still exists.
- The loader has the decoders the output needs, and a compare render shows no unintended visual change.

Next: `threejs-model-fix` if the optimized model renders differently.
