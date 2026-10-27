# React Three Fiber with drei ScrollControls (R3F 9, drei 10)

`ScrollControls` creates its own scroll container over the canvas; the canvas owns the page. For a normal document
with a 3D section, use GSAP ScrollTrigger as in `vanilla.md` and read its progress in `useFrame`.

## Contents

1. Setup
2. Camera and model from scroll progress
3. Section helpers: range, curve, visible
4. Scrubbing clips
5. HTML content
6. Reduced motion

## 1. Setup

```jsx
import { Canvas } from "@react-three/fiber";
import { ScrollControls, Scroll, Environment, Preload } from "@react-three/drei";
import { Suspense } from "react";

export function App() {
	return (
		<Canvas dpr={[1, 2]} camera={{ position: [0, 0.2, 3], fov: 40 }}>
			<Suspense fallback={null}>
				<Environment preset="studio" />
				<ScrollControls pages={3} damping={0.2}>
					<Story />
					<Scroll html>
						<Sections />
					</Scroll>
				</ScrollControls>
				<Preload all />
			</Suspense>
		</Canvas>
	);
}
```

`pages` is the scroll length in viewport heights; `damping` smooths progress (seconds to settle, lower is snappier).

## 2. Camera and model from scroll progress

```jsx
import { useScroll, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useRef } from "react";

const target = new THREE.Vector3();

function Story() {
	const scroll = useScroll();
	const model = useRef(null);
	const { scene } = useGLTF("/models/speaker.glb");

	useFrame((state, delta) => {
		const p = scroll.offset; // 0..1, already damped
		state.camera.position.lerpVectors(new THREE.Vector3(0, 0.2, 3), new THREE.Vector3(1.2, 0.4, 1.6), scroll.range(0, 1 / 3));
		target.set(0, 0, 0).lerp(new THREE.Vector3(0.2, 0.1, 0), scroll.range(0, 1 / 3));
		state.camera.lookAt(target);
		model.current.rotation.y = THREE.MathUtils.damp(model.current.rotation.y, p * Math.PI * 1.5, 4, delta);
	});

	return <primitive ref={model} object={scene} />;
}
```

## 3. Section helpers

All take `(from, distance, margin?)` in progress units:

- `scroll.range(from, distance)`: 0 before the section, rising to 1 across it, 1 after. Use it for one-way moves.
- `scroll.curve(from, distance)`: 0 to 1 and back to 0 across the section. Use it for things that appear and leave.
- `scroll.visible(from, distance)`: boolean, for toggling visibility.
- `scroll.delta`: change since the last frame, for velocity effects.

## 4. Scrubbing clips

```jsx
const { animations } = useGLTF("/models/speaker.glb");
const { actions, mixer } = useAnimations(animations, model);

useEffect(() => {
	const open = actions.Open; // real name from the inspect report
	open.play();
	open.paused = true;
}, [actions]);

useFrame(() => {
	mixer.setTime(scroll.range(1 / 3, 1 / 3) * actions.Open.getClip().duration);
});
```

## 5. HTML content

Children of `<Scroll html>` scroll with the page in DOM space; size each section at `100vh` so sections line up
with `pages`. Children of a plain `<Scroll>` scroll as 3D objects (one page moves them one viewport height).

```jsx
function Sections() {
	return (
		<>
			<section style={{ height: "100vh" }}><h1>Meet the speaker</h1></section>
			<section style={{ height: "100vh" }}><h2>Machined aluminium</h2></section>
			<section style={{ height: "100vh" }}><h2>Available now</h2></section>
		</>
	);
}
```

## 6. Reduced motion

```jsx
const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// reduced: snap camera to the current section's state instead of interpolating
const section = Math.min(2, Math.floor(scroll.offset * 3));
```

Pass `damping={0}` to `ScrollControls` when reduced motion is on, and skip camera flights.
