# Reference Images for Image-to-3D

Read this before running the `image` command. A clean 2D input decides most of the output quality.

## What makes a good input

- One object, centered, on a plain background. No crowded scenes.
- Full silhouette visible: no cropped limbs, hidden backs, extreme perspective, motion blur or heavy depth of field.
- Characters: full-body T-pose or A-pose, arms away from the body, legs separated, neutral expression, visible hands and feet.
- Creatures: side or front silhouette with a clear limb count and the stance the animation expects.
- Vehicles: front, side or three-quarter view with wheels, thrusters or wings clearly readable.
- Buildings: front elevation with roof silhouette, doors and windows, and some scale cue.
- Weapons and tools: side view with readable proportions; props and pickups centered with a strong silhouette.
- No baked-in text on textures unless text fidelity does not matter.

## Producing the image

Use whatever image tool the project already has (an image-generation skill or API, a photo, a sketch). If a model
must be rebuilt from a photo as procedural three.js code instead of a mesh, that is the external `img2threejs` skill,
not this one.

## Handoff to generation

1. Save the image in the project, for example `assets/concepts/<name>.png`.
2. Run the `image` command with `--image <path>`.
3. Add `--enable-image-autofix` for rough inputs.
4. Use `--texture-alignment original_image` when visual match matters, `--texture-alignment geometry` when structure matters.
5. Download outputs as soon as the task succeeds: signed URLs expire.

## 2D-only assets

Textures, trim sheets, decals, logos, icons and backdrop cards do not need 3D generation. Use 3D generation only for
objects that need real geometry.
