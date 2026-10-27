# Mixamo, external clips and root motion

## Contents

1. Downloading from Mixamo
2. Converting to GLB
3. Checking that a clip fits a rig
4. Fixing name mismatches
5. Fixing scale mismatches
6. Root motion: keeping a clip in place
7. Different skeletons: retargeting

## 1. Downloading from Mixamo

- Character: download once **With Skin**, FBX Binary, in T-pose (or the first animation with skin).
- Each animation: **Without Skin**, same character selected, so bone names and proportions match.
- Locomotion (walk, run, strafe): tick **In Place** unless the game moves the character from the clip's root motion.
- Downloading several characters in one Mixamo session can prefix bones `mixamorig1:`, `mixamorig2:`; normalize the
  names (section 4).

## 2. Converting to GLB

Convert every FBX with the Blender script from `threejs-model-inspect` (`references/converting.md`). For clip-only
files use the default (animations on). Then run the inspect script on each output and note:

- clip names (often `Armature|mixamo.com|Layer0`; rename them, see below);
- bone names (`mixamorigHips` and so on);
- scale (Mixamo FBX is in centimeters; the report flags `scale-large`).

Optionally merge clips into the character file so one request loads everything: import every GLB into one Blender
scene and export once, or load them separately at runtime and pass all clips to the same mixer.

Rename clips at load:

```js
for (const clip of animationGltf.animations) clip.name = "Run"; // one clip per Mixamo file
```

## 3. Checking that a clip fits a rig

```js
const boneNames = new Set();
character.traverse((object) => object.isBone && boneNames.add(object.name));
const missing = clip.tracks.map((track) => track.name.split(".")[0]).filter((name) => !boneNames.has(name));
console.log("tracks with no matching bone:", [...new Set(missing)]);
```

Empty means the clip fits. Tracks whose bones are missing are skipped with a `PropertyBinding` warning, which looks
like a frozen limb or a T-pose.

## 4. Fixing name mismatches

Rename tracks to the rig's bone names (prefix differences, `mixamorig1` vs `mixamorig`, sanitized `:`):

```js
for (const track of clip.tracks) track.name = track.name.replace(/^mixamorig\d*:?/, "mixamorig");
```

## 5. Fixing scale mismatches

If the character was scaled at export (for example converted with meters) but the clip was not, the hips position
track moves 100 times too far and limbs stretch. Scale position tracks to match:

```js
for (const track of clip.tracks) {
	if (track.name.endsWith(".position")) for (let i = 0; i < track.values.length; i++) track.values[i] *= 0.01;
}
```

Prefer fixing it at conversion by exporting the character and the clips with the same unit settings.

## 6. Root motion: keeping a clip in place

A clip with root motion moves the hips forward; when the app also moves the character, it runs away from its own
collider. Either download **In Place**, or flatten the hips' horizontal movement:

```js
const hips = clip.tracks.find((track) => track.name === "mixamorigHips.position");
if (hips) {
	for (let i = 0; i < hips.values.length; i += 3) {
		hips.values[i] = hips.values[0]; // x
		hips.values[i + 2] = hips.values[2]; // z, keep y for the bounce
	}
}
```

To use root motion instead (the clip decides the speed), read the hips' horizontal delta each frame, apply it to
the character's position, and reset the bone, so the collider follows the body.

## 7. Different skeletons: retargeting

Clips made for one skeleton play on another only when bone names and rest poses match. For a different rig:

- **Best:** retarget in Blender (or re-upload the character to Mixamo so it gets the Mixamo skeleton) and export
  clips for the target rig.
- **Runtime:** `SkeletonUtils.retargetClip(targetSkinnedMesh, sourceSkinnedMesh, clip, { names: { targetBone:
  "sourceBone" }, hip: "sourceHipBoneName" })` returns a new clip baked for the target. It needs a complete bone
  name map and matching rest poses (both T-pose or both A-pose); expect to tune it, and check the result on screen.
