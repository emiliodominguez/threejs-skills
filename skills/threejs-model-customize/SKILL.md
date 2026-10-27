---
name: threejs-model-customize
description: "Changing parts of a loaded glTF model at runtime in three.js or R3F: per-part colors and materials, texture swaps, hiding parts, material variants, click picking, attaching to named nodes. Use for product configurators and part edits. Hands off to `threejs-model-optimize`."
---

# Customize a loaded model

Part edits fail in three predictable ways: the code looks up a name that does not exist in three.js (names are
sanitized, duplicates get suffixes, multi-material meshes become groups), an edit to one part changes every part
that shares the material, and a swapped texture shows upside-down or washed out. Work from the inspect report and
own every material you change.

## Process

1. Run `threejs-model-inspect`. From the report, list the parts the feature touches: node names (already in three.js
   form), which material each uses and how many primitives share it (`used by N`), and `Group of N meshes` nodes.
   If the parts the user means are not separate nodes or materials, the file needs re-exporting with them split;
   say so instead of hacking around it.
2. Read the recipe file for the stack: `references/vanilla.md` or `references/r3f.md`. Sections cover recoloring,
   material swaps, texture swaps, visibility, variants, picking and attachments.
3. Before mutating any material, clone it and assign the clone to the part. Materials are shared between every
   mesh that uses them, and drei's `useGLTF` also shares them between every component that loads the same URL.
4. When swapping textures onto glTF UVs, set `texture.flipY = false`, and `colorSpace = SRGBColorSpace` for color
   and emissive maps only.
5. Keep the edit state outside the scene (a plain object such as `{ body: "red", wheels: "sport" }`) and apply it
   to the model with one function. That makes reset, undo and URL sharing trivial.
6. Dispose what you replace (`material.dispose()`, `texture.dispose()`) when swapping repeatedly, or GPU memory grows
   with every click.
7. If the model goes through `threejs-model-optimize`, use the `configurator` preset so the names survive.
8. When parts are edited in the file itself (re-exported, materials renamed), compare old and new files with
   `threejs-model-inspect`'s `render.mjs --compare` to confirm only the intended parts changed.

## Anti-patterns

- Editing `mesh.material.color` on a shared material and recoloring parts the user never touched.
- Writing names from the DCC outliner (`Wheel.001`, `Body Paint`) instead of the three.js names (`Wheel001`,
  `Body_Paint`).
- Loading a new texture per click without caching or disposing.
- Merging meshes for performance (default `gltf-transform optimize`) and then needing them separate.

## Done when

- Every configurable part changes alone, verified by changing one part and checking the others.
- Swapped textures are upright and correctly colored.
- Reset returns the original look, and repeated swaps do not grow `renderer.info.memory`.

Next: `threejs-model-optimize` with the `configurator` preset before shipping.
