---
name: web3d-model-viewer
description: "Embedding 3D products with the <model-viewer> web component instead of three.js: AR on iOS and Android, posters, hotspots, variants, material edits. Use for product pages and to decide model-viewer versus three.js. Routes to `threejs-model-inspect`."
---

# `<model-viewer>` or three.js?

`<model-viewer>` (`@google/model-viewer` 4.4, Apache-2.0) is one HTML element that shows a glTF with orbit controls,
good default lighting, lazy loading, accessibility, and one-tap AR on Android (Scene Viewer, WebXR) and iOS (Quick
Look). For a product page it is usually the right answer, and hand-written three.js is more code for a worse
result. Decide first:

| Need | Use |
| --- | --- |
| Show a product, rotate it, view it in AR, swap colors | `<model-viewer>` |
| Hotspot labels on parts, a few camera presets, play a clip | `<model-viewer>` |
| Custom shaders, post-processing, physics, many models in one scene, games | three.js or R3F |
| Scroll-driven camera flights | three.js (`threejs-scroll`) |

## Process

1. Inspect and optimize the model first (`threejs-model-inspect`, then `threejs-model-optimize` with `web` or
   `configurator`). model-viewer decodes Draco, meshopt and KTX2 by itself.
2. Add the element, from the CDN or `npm i @google/model-viewer` (`import "@google/model-viewer";`):

   ```html
   <script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js"></script>
   <model-viewer src="/models/chair.glb" alt="Oak lounge chair, three-quarter view" poster="/models/chair.webp"
   	camera-controls touch-action="pan-y" shadow-intensity="1" tone-mapping="commerce" ar ar-modes="webxr scene-viewer quick-look"
   	style="width: 100%; height: 480px"></model-viewer>
   ```

   `alt` is required for accessibility; `poster` shows instantly while the model loads; `loading="lazy"` (default
   `auto`) defers offscreen models. `tone-mapping="commerce"` keeps product colors faithful. Size it with CSS; it
   has no intrinsic size.
3. Add features from `references/recipes.md` as needed: AR setup, hotspots, variants and material colors, camera
   presets, animation, events.
4. Test AR on a real phone of each platform; desktop shows only the button logic.

## Anti-patterns

- Rebuilding orbit, lighting and AR in three.js for a single product view.
- Shipping without `poster`: the area stays blank until a multi-megabyte model arrives.
- Expecting AR on iOS from a `.glb` alone in old Safari versions; provide `ios-src` with a USDZ when Quick Look
  rejects the generated file.
- `touch-action` left at its default on mobile pages that must scroll past the model; set `pan-y`.

## Done when

- The model shows its poster immediately and loads lazily below the fold.
- AR opens on an Android and an iOS device, at real-world scale.
- Interactive features (variants, hotspots, color changes) work by keyboard and touch.

Next: `threejs-model-inspect` before any model goes into the element.
