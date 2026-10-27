---
name: threejs-model-animate
description: "Playing a loaded model's animations in three.js or R3F: clips, crossfades, one-shots, root motion, Mixamo clips, morph targets and rigged copies. Use when wiring model animations; not for procedural motion (`threejs-animation`). Hands off to `threejs-model-fix`."
---

# Animate a loaded model

Most broken model animation comes from four mistakes: clip names guessed instead of read, no `mixer.update(delta)`
in the loop, rigged copies made with `object.clone()` (which keeps pointing at the original skeleton), and clips
from another file whose bone names or units do not match. Read the file, then wire the pattern below that fits.

## Process

1. Run `threejs-model-inspect` on the character and on every animation file. Note clip names and durations,
   whether clips are `skeletal`, the bone names (Mixamo bones are `mixamorigHips` in three.js) and the scale.
2. Pick the stack's recipe file and read only the sections you need:
   - Vanilla three.js: `references/vanilla.md`
   - React Three Fiber with drei: `references/r3f.md`
   - Clips from Mixamo or another file, root motion, rig mismatches: `references/mixamo.md`
3. Create exactly one `AnimationMixer` per animated model instance, and advance it every frame with the frame
   delta from `THREE.Timer` (`Clock` is deprecated since r183). drei's `useAnimations` does this for you.
4. Build a name-to-action map from the clips once, then drive state changes through one `fadeTo(name)` helper so
   two clips never fight at full weight.
5. For several copies of a rigged model, clone with `SkeletonUtils.clone` and give each copy its own mixer. Clips can
   be shared across mixers.
6. Watch the result unpaused: transitions, foot sliding, drifting off its spot (root motion), and stretched limbs
   (a scale mismatch between clip and rig). Without a running app, pose the file on a clip with
   `threejs-model-inspect`'s `render.mjs model.glb --clip Run --time 0.3` at a few times and look at the sheets;
   a clip that leaves the model in its bind pose, or stretches limbs, shows there.

## Rules

- Names come from the inspect report or `gltf.animations.map((clip) => clip.name)`; never hard-code a guess.
- A clip applies to the hierarchy it was made for. Before playing a clip from another file, compare its track names
  (`clip.tracks[0].name` is `boneName.property`) with the rig's bone names.
- Stop and uncache on teardown (`mixer.stopAllAction(); mixer.uncacheRoot(root)`) in apps that load and unload models.

## Anti-patterns

- `const copy = gltf.scene.clone()` for a skinned model: the copy deforms with the original or not at all.
- Calling `action.play()` on the next clip without fading the previous one out: both run at full weight.
- `new THREE.Clock()` in new code, or a delta computed from `performance.now()` that jumps after a tab switch.
- Fixing a character that slides across the floor by moving it back every frame instead of handling root motion.

## Done when

- Every clip the feature needs plays by its real name, with fades between states.
- Copies animate independently, and one-shot clips return to a loop state when finished.
- Nothing drifts, slides or stretches unintentionally when watched for a few cycles.

Next: `threejs-model-fix` if the model is in a T-pose, invisible or distorted.
