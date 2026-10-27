# React Three Fiber with @react-three/xr 6

v6 replaced v5's `<VRButton>`, `<ARButton>`, `<Controllers>` and `<Hands>` with a store: controllers, hands and
pointer events are on by default.

## Contents

1. Store and sessions
2. AR placement with hit testing
3. Anchors
4. DOM overlay
5. Session-aware UI
6. Locomotion

## 1. Store and sessions

```jsx
import { Canvas } from "@react-three/fiber";
import { XR, createXRStore } from "@react-three/xr";

const store = createXRStore(); // options toggle default controllers, hands, features

export function App() {
	return (
		<>
			<button onClick={() => store.enterAR()}>Enter AR</button>
			<button onClick={() => store.enterVR()}>Enter VR</button>
			<Canvas>
				<XR store={store}>
					<Scene />
				</XR>
			</Canvas>
		</>
	);
}
```

Pointer events (`onClick`, `onPointerOver`) work with controller rays, hands and touch inside `<XR>`.

## 2. AR placement with hit testing

```jsx
import { useXRHitTest } from "@react-three/xr";
import { useRef, useState } from "react";
import * as THREE from "three";

const matrix = new THREE.Matrix4();

function Placement({ model }) {
	const reticle = useRef(null);
	const [placed, setPlaced] = useState([]);

	useXRHitTest((results, getWorldMatrix) => {
		if (results.length === 0 || !reticle.current) return;
		getWorldMatrix(matrix, results[0]);
		reticle.current.visible = true;
		matrix.decompose(reticle.current.position, reticle.current.quaternion, reticle.current.scale);
	}, "viewer");

	return (
		<>
			<mesh ref={reticle} visible={false} rotation-x={-Math.PI / 2} onClick={() => setPlaced((list) => [...list, reticle.current.position.clone()])}>
				<ringGeometry args={[0.08, 0.1, 32]} />
				<meshBasicMaterial />
			</mesh>
			{placed.map((position, i) => (
				<Model key={i} position={position} />
			))}
		</>
	);
}
```

## 3. Anchors

Anchors keep placed content fixed to the real world as tracking improves:

```jsx
import { useXRAnchor, XRSpace } from "@react-three/xr";

const [anchor, requestAnchor] = useXRAnchor();
// on select, with the latest hit-test result kept from useXRHitTest:
// requestAnchor({ relativeTo: "hit-test-result", hitTestResult })
// or at a world pose: requestAnchor({ relativeTo: "world", worldPosition, worldQuaternion })
{anchor && (
	<XRSpace space={anchor.anchorSpace}>
		<Model />
	</XRSpace>
)}
```

## 4. DOM overlay

```jsx
import { XRDomOverlay } from "@react-three/xr";

<XR store={store}>
	<XRDomOverlay>
		<button onClick={() => store.getState().session?.end()}>Exit</button>
	</XRDomOverlay>
</XR>;
```

## 5. Session-aware UI

```jsx
import { IfInSessionMode, IfSessionModeSupported } from "@react-three/xr";

<IfSessionModeSupported mode="immersive-ar">
	<button onClick={() => store.enterAR()}>View in your room</button>
</IfSessionModeSupported>

<IfInSessionMode deny={["immersive-ar", "immersive-vr"]}>
	<OrbitControls /> {/* desktop only */}
</IfInSessionMode>
```

`useXR((state) => state.mode)` reads the current session mode.

## 6. Locomotion

Thumbstick movement and teleporting move the XR origin, not the camera:

```jsx
import { XROrigin, useXRControllerLocomotion, TeleportTarget } from "@react-three/xr";

function Player() {
	const origin = useRef(null);
	useXRControllerLocomotion(origin);
	return <XROrigin ref={origin} />;
}

<TeleportTarget onTeleport={(point) => origin.current.position.copy(point)}>
	<mesh rotation-x={-Math.PI / 2}>
		<planeGeometry args={[20, 20]} />
		<meshStandardMaterial />
	</mesh>
</TeleportTarget>;
```
