# Vanilla three.js recipes (r186)

## Contents

1. Mixer, actions and the frame loop
2. Crossfading between states
3. One-shot clips that return to a loop
4. Speed, pausing and syncing locomotion
5. Upper-body layers and additive clips
6. Independent copies of a rigged model
7. Morph targets
8. Trimming clips
9. Teardown

## 1. Mixer, actions and the frame loop

```js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const gltf = await new GLTFLoader().loadAsync("/models/character.glb");
const model = gltf.scene;
scene.add(model);

const mixer = new THREE.AnimationMixer(model);
const actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
console.log("clips:", Object.keys(actions)); // use these names, never guesses

const timer = new THREE.Timer();
timer.connect(document); // pauses delta while the tab is hidden

renderer.setAnimationLoop((timestamp) => {
	timer.update(timestamp);
	mixer.update(timer.getDelta());
	renderer.render(scene, camera);
});
```

## 2. Crossfading between states

```js
let current = actions.Idle;
current.play();

/** Fades from the current action to the named one. */
function fadeTo(name, duration = 0.3) {
	const next = actions[name];
	if (!next || next === current) return;
	next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(duration).play();
	current.fadeOut(duration);
	current = next;
}
```

`current.crossFadeTo(next, duration, true)` does the same; the third argument warps time scales so a walk and a run
blend their stride instead of stuttering. Both clips must be playing for a crossfade.

## 3. One-shot clips that return to a loop

```js
const jump = actions.Jump;
jump.setLoop(THREE.LoopOnce, 1);
jump.clampWhenFinished = true; // hold the last frame instead of snapping to the bind pose

mixer.addEventListener("finished", (event) => {
	if (event.action === jump) fadeTo("Idle", 0.2);
});
```

## 4. Speed, pausing and syncing locomotion

- Per clip: `action.timeScale = 1.5`. Whole model: `mixer.timeScale = 0` pauses everything on it.
- Match a walk's speed to movement: `action.timeScale = speed / clipNativeSpeed`.
- Keep a walk and a run in phase: `run.syncWith(walk)` before fading.

## 5. Upper-body layers and additive clips

Play a clip on part of the skeleton by filtering its tracks by bone:

```js
const upperBones = new Set();
model.getObjectByName("mixamorigSpine").traverse((bone) => upperBones.add(bone.name));
const wave = gltf.animations.find((clip) => clip.name === "Wave");
const upperWave = new THREE.AnimationClip("WaveUpper", wave.duration, wave.tracks.filter((track) => upperBones.has(track.name.split(".")[0])));
mixer.clipAction(upperWave).play(); // runs on top of the locomotion clip for the lower body
```

Additive (a nod layered on any pose):

```js
THREE.AnimationUtils.makeClipAdditive(nodClip); // sets nodClip.blendMode to AdditiveAnimationBlendMode
const nod = mixer.clipAction(nodClip);
nod.setEffectiveWeight(0.6).play();
```

## 6. Independent copies of a rigged model

```js
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const crowd = Array.from({ length: 5 }, (_, i) => {
	const copy = SkeletonUtils.clone(gltf.scene); // rebinds the copy to its own skeleton
	copy.position.x = i * 2;
	scene.add(copy);
	const mixer = new THREE.AnimationMixer(copy);
	const action = mixer.clipAction(gltf.animations[0]);
	action.time = Math.random() * action.getClip().duration; // desync the crowd
	action.play();
	return mixer;
});
// in the loop: for (const mixer of crowd) mixer.update(delta);
```

Hundreds of copies are a performance problem, not an animation one: see `threejs-performance` (instancing,
baked vertex animation, LOD).

## 7. Morph targets

```js
const face = model.getObjectByName("Face"); // name from the inspect report's morph targets section
const index = face.morphTargetDictionary.Smile;
face.morphTargetInfluences[index] = 0.8;
```

Clips that animate morph targets (`weights` path in the report) play through the mixer like any other clip.

## 8. Trimming clips

One long clip with several moves (common in asset-store files):

```js
const walk = THREE.AnimationUtils.subclip(allMoves, "Walk", 0, 30, 30); // frames 0-30 at 30 fps
```

## 9. Teardown

```js
mixer.stopAllAction();
mixer.uncacheRoot(model);
scene.remove(model);
```
