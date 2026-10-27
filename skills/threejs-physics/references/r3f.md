# React Three Fiber with @react-three/rapier 2.2

`@react-three/rapier` wraps `@dimforge/rapier3d-compat`, steps at a fixed `timeStep` (default 1/60) with
interpolation, and generates colliders from the meshes inside each `RigidBody`.

## Contents

1. Physics world
2. Bodies with automatic colliders
3. Explicit colliders
4. Driving bodies from code
5. Events and sensors
6. Character controller
7. Many bodies

## 1. Physics world

```jsx
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Suspense } from "react";

export function App() {
	return (
		<Canvas shadows camera={{ position: [0, 4, 8] }}>
			<Suspense fallback={null}>
				<Physics gravity={[0, -9.81, 0]} debug={import.meta.env.DEV}>
					<Level />
					<Crates />
				</Physics>
			</Suspense>
		</Canvas>
	);
}
```

`Physics` suspends while the WASM loads, so it needs a `Suspense` parent. Props: `timeStep` (number or `"vary"`),
`interpolate` (default true), `paused`, `colliders` (default auto-collider for all bodies), `updateLoop`.

## 2. Bodies with automatic colliders

`colliders` on a `RigidBody` builds colliders from the meshes inside it: `"cuboid"` (default), `"ball"`, `"hull"`,
`"trimesh"`, or `false` for none.

```jsx
import { RigidBody } from "@react-three/rapier";
import { useGLTF } from "@react-three/drei";

function Level() {
	const { scene } = useGLTF("/models/level.glb");
	return (
		<RigidBody type="fixed" colliders="trimesh">
			<primitive object={scene} />
		</RigidBody>
	);
}

function Crate(props) {
	const { nodes, materials } = useGLTF("/models/crate.glb");
	return (
		<RigidBody colliders="hull" restitution={0.2} friction={0.8} ccd {...props}>
			<mesh geometry={nodes.Crate.geometry} material={materials.Wood} castShadow />
		</RigidBody>
	);
}
```

Body `type`: `"dynamic"` (default), `"fixed"`, `"kinematicPosition"`, `"kinematicVelocity"`.

## 3. Explicit colliders

Turn off auto colliders and compose primitives when a hull is too coarse or a trimesh too costly:

```jsx
import { CuboidCollider, BallCollider, CapsuleCollider } from "@react-three/rapier";

<RigidBody colliders={false} position={[0, 2, 0]}>
	<Chair />
	<CuboidCollider args={[0.25, 0.03, 0.25]} position={[0, 0.45, 0]} /> {/* seat, half extents */}
	<CuboidCollider args={[0.25, 0.3, 0.03]} position={[0, 0.8, -0.22]} /> {/* back */}
</RigidBody>;
```

## 4. Driving bodies from code

```jsx
import { useRef } from "react";
import { RigidBody } from "@react-three/rapier";

function Ball() {
	const body = useRef(null); // RapierRigidBody
	return (
		<RigidBody ref={body} colliders="ball">
			<mesh onClick={() => body.current?.applyImpulse({ x: 0, y: 4, z: 0 }, true)}>
				<sphereGeometry args={[0.3]} />
				<meshStandardMaterial color="orange" />
			</mesh>
		</RigidBody>
	);
}
```

Use `setLinvel`, `applyImpulse`, `setTranslation` on the ref; never set the mesh's position on a dynamic body.

## 5. Events and sensors

```jsx
<RigidBody type="fixed" colliders={false}>
	<CuboidCollider args={[1, 1, 1]} sensor onIntersectionEnter={({ other }) => collect(other.rigidBodyObject)} />
</RigidBody>

<RigidBody onCollisionEnter={({ other }) => console.log("hit", other.rigidBodyObject?.name)} onContactForce={({ totalForceMagnitude }) => playThud(totalForceMagnitude)}>
	...
</RigidBody>
```

## 6. Character controller

Use a kinematic body and the core controller through `useRapier`, stepping input in `useBeforePhysicsStep`:

```jsx
import { CapsuleCollider, RigidBody, useBeforePhysicsStep, useRapier } from "@react-three/rapier";

function Player({ input }) {
	const body = useRef(null);
	const collider = useRef(null);
	const { world } = useRapier();
	const controller = useMemo(() => {
		const c = world.createCharacterController(0.01);
		c.enableAutostep(0.4, 0.2, true);
		c.enableSnapToGround(0.3);
		return c;
	}, [world]);

	useBeforePhysicsStep(() => {
		if (!body.current || !collider.current) return;
		const step = 1 / 60;
		controller.computeColliderMovement(collider.current, { x: input.current.x * 4 * step, y: -9.81 * step, z: input.current.z * 4 * step });
		const move = controller.computedMovement();
		const p = body.current.translation();
		body.current.setNextKinematicTranslation({ x: p.x + move.x, y: p.y + move.y, z: p.z + move.z });
	});

	return (
		<RigidBody ref={body} type="kinematicPosition" colliders={false} position={[0, 1, 0]}>
			<CapsuleCollider ref={collider} args={[0.5, 0.3]} />
			<Avatar />
		</RigidBody>
	);
}
```

## 7. Many bodies

Hundreds of identical bodies: `InstancedRigidBodies` with one `InstancedMesh`, so draw calls stay at one.

```jsx
import { InstancedRigidBodies } from "@react-three/rapier";

const instances = Array.from({ length: 300 }, (_, i) => ({ key: i, position: [Math.random() * 4, 5 + i * 0.2, Math.random() * 4] }));

<InstancedRigidBodies instances={instances} colliders="ball">
	<instancedMesh args={[undefined, undefined, instances.length]} castShadow>
		<sphereGeometry args={[0.1]} />
		<meshStandardMaterial />
	</instancedMesh>
</InstancedRigidBodies>;
```
