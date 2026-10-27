---
name: threejs-model-fix
description: "Diagnosis and fixes for a 3D model that loads or renders wrong in three.js or React Three Fiber: black, invisible, huge or tiny, off-center, inside-out, washed out, untextured, or a loader error. Use when a model does not look like it should. Hands off to `threejs-model-optimize`."
---

# Fix a model that renders wrong

Most "broken model" reports are not broken files. They are a scene missing an environment, a camera pointed at the
wrong place, or a loader missing a decoder. Split file problems from app problems before changing either.

## Process

1. **Inspect the file.** Run the inspect script from `threejs-model-inspect`
   (`node "<inspect-skill-dir>/scripts/inspect.mjs" model.glb`, where `<inspect-skill-dir>` is the absolute
   directory of that skill's SKILL.md). Findings with codes such as `metal-needs-env`,
   `scale-large`, `off-center`, `mirrored`, `no-normals` and `decoder` map directly to rows in
   `references/symptoms.md`.
2. **Read the exact error.** Check the browser console for the first error, not the last. Loader errors name the
   missing piece (`No DRACOLoader instance provided`, `setMeshoptDecoder must be called...`, `setKTX2Loader must be
   called...`), and a 404 means a path, not a model problem.
3. **Isolate with the reference viewer.** Render the file with `<inspect-skill-dir>/scripts/render.mjs` (a six-view
   contact sheet through a known-good viewer that wires every decoder, lights with an environment map and frames
   the bounds). Add `--no-env` to see it the way an app without an environment does. For hands-on checks, copy
   `<inspect-skill-dir>/assets/viewer.html` next to the model, serve that folder and open
   `viewer.html?model=model.glb`; it has toggles for environment, wireframe and double-sided.
   - Wrong in the viewer: the file is the problem. Fix it at the source (DCC re-export) or with a gltf-transform
     command from `references/symptoms.md`.
   - Right in the viewer, wrong in the app: diff the app's renderer, lighting, camera and loader setup against the
     viewer's code. To profile the running app itself, use `threejs-scene-doctor`.
4. **Apply the smallest fix from `references/symptoms.md`** for the stack in use. Detect React Three Fiber by
   `@react-three/fiber` in package.json and use the R3F column; otherwise vanilla.
5. **Verify on screen.** Reload, check the console is clean, and look at the model: a screenshot of the app when
   browser tools are available, and `render.mjs --compare original.glb fixed.glb` for file-level fixes. A fix that
   only silences the console is not done.

## Rules

- Fix the scene, not the asset, when the asset is right: scaling a model by 100 in code is fine; editing vertex data
  to compensate for a missing environment map is not.
- Never overwrite the source model. Write fixed files next to it with a suffix.
- One change at a time, re-checking after each, so the cause stays known.

## Anti-patterns

- Adding more and brighter lights to a fully metallic model. Metals reflect the environment; set `scene.environment`.
- Replacing the file's materials in code (new `MeshPhysicalMaterial`, anisotropy, tweaked factors) when the scene
  is what is missing. The artist's material is the spec: fix lighting first, look, and only then tune materials if
  the user asked for a different look. Overriding them is how a black model becomes a blown-out white one.
- Setting `side: DoubleSide` everywhere to hide inverted normals instead of fixing the mirrored export.
- Guessing the decoder setup instead of reading `extensionsRequired` from the inspect report.
- Calling the model fixed because the error disappeared, without looking at it.

## Done when

- The console has no loader or WebGL errors and no 404s.
- The model is visible, framed, correctly lit and colored, matching the reference viewer: neither black nor blown
  out to white, and its materials unchanged unless the user asked for a new look.
- The cause is stated in one line (for example "metallic material with no environment map").

Next: `threejs-model-optimize` once it renders right.
