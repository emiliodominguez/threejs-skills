# React Three Fiber recipes (R3F 9, drei 10)

## Contents

1. Playing clips with useAnimations
2. Switching states with fades
3. One-shot clips
4. Several copies of a rigged model
5. Morph targets
6. Clips from a separate file

## 1. Playing clips with useAnimations

`useAnimations` creates the mixer on the ref'd group and advances it every frame.

```jsx
import { useGLTF, useAnimations } from "@react-three/drei";
import { useEffect, useRef } from "react";

export function Character(props) {
	const group = useRef(null);
	const { scene, animations } = useGLTF("/models/character.glb");
	const { actions, names } = useAnimations(animations, group);

	useEffect(() => {
		console.log("clips:", names); // use these names, never guesses
		actions.Idle?.play();
	}, [actions, names]);

	return (
		<group ref={group} {...props} dispose={null}>
			<primitive object={scene} />
		</group>
	);
}

useGLTF.preload("/models/character.glb");
```

## 2. Switching states with fades

Drive the clip from a prop and fade in the effect, fading out in its cleanup:

```jsx
export function Character({ animation = "Idle", ...props }) {
	const group = useRef(null);
	const { scene, animations } = useGLTF("/models/character.glb");
	const { actions } = useAnimations(animations, group);

	useEffect(() => {
		const action = actions[animation];
		action?.reset().fadeIn(0.3).play();
		return () => {
			action?.fadeOut(0.3);
		};
	}, [animation, actions]);

	return (
		<group ref={group} {...props} dispose={null}>
			<primitive object={scene} />
		</group>
	);
}
```

## 3. One-shot clips

```jsx
const { actions, mixer } = useAnimations(animations, group);

useEffect(() => {
	const jump = actions.Jump;
	if (!jump) return;
	jump.setLoop(THREE.LoopOnce, 1);
	jump.clampWhenFinished = true;
	function onFinished(event) {
		if (event.action === jump) onDone(); // e.g. set state back to "Idle"
	}
	mixer.addEventListener("finished", onFinished);
	return () => mixer.removeEventListener("finished", onFinished);
}, [actions, mixer, onDone]);
```

## 4. Several copies of a rigged model

`useGLTF` caches by URL, so every component gets the same `scene` object, and an object can have only one parent:
rendering it twice moves it. Clone per instance with `SkeletonUtils.clone` and get named nodes for the clone with
`useGraph`:

```jsx
import { useGraph } from "@react-three/fiber";
import { useMemo } from "react";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

export function Fox({ animation = "Walk", ...props }) {
	const group = useRef(null);
	const { scene, animations } = useGLTF("/models/fox.glb");
	const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
	const { nodes, materials } = useGraph(clone); // per-instance nodes, if parts need editing
	const { actions } = useAnimations(animations, group);

	useEffect(() => {
		actions[animation]?.reset().fadeIn(0.3).play();
		return () => {
			actions[animation]?.fadeOut(0.3);
		};
	}, [animation, actions]);

	return (
		<group ref={group} {...props} dispose={null}>
			<primitive object={clone} />
		</group>
	);
}
```

drei's `<Clone object={scene} />` also handles skinned meshes, but `useGraph` on a memoized clone keeps nodes
addressable. Materials are still shared between clones: clone a material before changing it per instance (see
`threejs-model-customize`).

## 5. Morph targets

```jsx
const { nodes } = useGLTF("/models/face.glb");
const face = nodes.Face; // name from the inspect report
useFrame(({ clock }) => {
	face.morphTargetInfluences[face.morphTargetDictionary.Smile] = (Math.sin(clock.elapsedTime) + 1) / 2;
});
```

## 6. Clips from a separate file

Load the animation file with `useGLTF` too and pass its clips to the character's mixer:

```jsx
const { scene } = useGLTF("/models/character.glb");
const { animations: dance } = useGLTF("/models/anims/dance.glb");
const { actions } = useAnimations(dance, group);
```

This works only when track names match the character's bones; check them as described in `mixamo.md`.
