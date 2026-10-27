---
name: threejs
description: "Map of the threejs-* skills for three.js and React Three Fiber work: 3D models, scenes, materials, lighting, animation, shaders, performance and model generation. Use when a 3D web task spans several areas or the right skill is unclear. Routes to `threejs-model-inspect` and the rest of the suite."
---

# three.js skill map

Pick the narrowest skill that covers the task and load it; load a second only when the task crosses into its area.
All skills target three r186, React Three Fiber 9 and drei 10.

## First, read the project

- Stack: `@react-three/fiber` in package.json means R3F; use the R3F sections or files of each skill. Otherwise
  vanilla three.js.
- Version: check the installed `three` version. Below r183, `Timer`, `HDRLoader` and some imports in these skills
  differ; run `threejs-upgrade`'s linter before mixing APIs.
- Models: list `.glb`, `.gltf`, `.fbx`, `.obj` files under `public/`, `assets/` or `static/`.

## Working with a 3D model

The usual order when someone hands over a model:

| Step | Skill | For |
| --- | --- | --- |
| 1 | `threejs-model-inspect` | what is inside: names, clips, bones, scale, textures, decoders; converting FBX/OBJ/USDZ |
| 2 | `threejs-model-fix` | black, invisible, huge, off-center, inside-out, washed out, loader errors |
| 3 | `threejs-model-animate` | playing clips, crossfades, Mixamo clips, root motion, rigged copies |
| 3 | `threejs-model-customize` | per-part colors and materials, texture swaps, variants, picking, attachments |
| 4 | `threejs-model-optimize` | smaller files and GPU memory with presets, without losing names |

Inspect first even when the request starts at step 3: animation and customization code depends on names only the
file knows. `threejs-model-inspect` also renders contact sheets and before/after diffs, so look at the model too.

## When the app, not the file, is the problem

| Situation | Skill |
| --- | --- |
| Running app is slow, leaks memory, renders black, animation frozen | `threejs-scene-doctor` |
| Code uses old APIs, errors like "is not exported", upgrading three or R3F | `threejs-upgrade` |

## Getting a model that does not exist yet

| Need | Use |
| --- | --- |
| A free or licensed model, HDRI or texture | `threejs-assets` |
| A mesh from a text prompt or concept image (paid API) | `threejs-model-generate` |
| An object rebuilt from a photo as procedural three.js code | the external `img2threejs` skill (`npx skills add img2threejs/img2threejs`) |
| Simple shapes, terrain, procedural props | `threejs-geometry` |
| Export from Blender | re-export as glTF Binary with +Y up, then `threejs-model-inspect` |

## Experiences

| Need | Skill |
| --- | --- |
| A product on a page, with AR, and nothing custom | `web3d-model-viewer` (no three.js code at all) |
| Scroll moves the camera, reveals parts, scrubs clips | `threejs-scroll` |
| Objects fall, collide, get thrown; a walkable character | `threejs-physics` |
| Photoscanned places and objects as Gaussian splats | `threejs-splats` |
| AR placement in a room, VR headsets | `threejs-webxr` |

## Foundations

| Area | Skill |
| --- | --- |
| Scene, camera, renderer, loop, transforms | `threejs-fundamentals` |
| Geometry, instancing, batching, points, lines | `threejs-geometry` |
| Materials and PBR | `threejs-materials` |
| Lights, shadows, environment maps | `threejs-lighting` |
| Textures, color spaces, render targets | `threejs-textures` |
| Loading any asset type, caching, disposal | `threejs-loaders` |
| Keyframes and procedural animation | `threejs-animation` |
| Raycasting, controls, gizmos | `threejs-interaction` |
| Custom GLSL and TSL shaders | `threejs-shaders` |
| Bloom, depth of field, post-processing | `threejs-postprocessing` |
| Frame rate, draw calls, memory | `threejs-performance` |
| React Three Fiber and drei | `threejs-react-three-fiber` |
| gltf-transform commands in depth, gltfjsx | `threejs-asset-pipeline` |

## Anti-patterns

- Loading several skills up front "just in case"; each costs context.
- Writing model code from memory of an older three.js release instead of the skill for the installed version.
- Skipping inspection because the model "looks standard".

## Done when

- The task is handed to the skill or skills whose area it is, and the stack and version are stated.
