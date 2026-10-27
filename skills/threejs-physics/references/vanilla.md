# Vanilla three.js with @dimforge/rapier3d-compat 0.21

The `-compat` build inlines the WASM, so it works with any bundler or an import map. Install with
`npm i @dimforge/rapier3d-compat`.

## Contents

1. World and fixed-step loop
2. Bodies and colliders
3. Colliders from glTF meshes
4. Collision events and sensors
5. Character controller
6. Debug view

## 1. World and fixed-step loop

```js
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

await RAPIER.init(); // loads the WASM once; nothing else works before it resolves
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const eventQueue = new RAPIER.EventQueue(true);
const STEP = 1 / 60;
world.timestep = STEP;

const synced = []; // [mesh, body] pairs
const timer = new THREE.Timer();
timer.connect(document);
let accumulator = 0;

renderer.setAnimationLoop((timestamp) => {
	timer.update(timestamp);
	accumulator += Math.min(timer.getDelta(), 0.1); // clamp after tab switches
	while (accumulator >= STEP) {
		world.step(eventQueue);
		accumulator -= STEP;
	}
	for (const [mesh, body] of synced) {
		mesh.position.copy(body.translation());
		mesh.quaternion.copy(body.rotation());
	}
	renderer.render(scene, camera);
});
```

## 2. Bodies and colliders

```js
// Fixed floor: a collider without a body is static.
world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10).setTranslation(0, -0.1, 0));

// Dynamic box matching a 1x1x1 mesh (cuboid takes half extents).
const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0).setCcdEnabled(true));
world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setRestitution(0.3).setFriction(0.8), body);
synced.push([boxMesh, body]);

// Move it through the body API, never through the mesh.
body.applyImpulse({ x: 0, y: 5, z: 0 }, true);
body.setLinvel({ x: 2, y: 0, z: 0 }, true);
```

## 3. Colliders from glTF meshes

Bake the mesh's world transform into the vertices, read them through the attribute API (handles quantized and
interleaved data), and pick trimesh for static geometry or a convex hull for moving props:

```js
/** Returns world-space positions and indices for a mesh, ready for Rapier. */
function meshData(mesh) {
	mesh.updateWorldMatrix(true, false);
	const position = mesh.geometry.attributes.position;
	const vertex = new THREE.Vector3();
	const vertices = new Float32Array(position.count * 3);
	for (let i = 0; i < position.count; i++) {
		vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
		vertices.set([vertex.x, vertex.y, vertex.z], i * 3);
	}
	const indices = mesh.geometry.index ? Uint32Array.from(mesh.geometry.index.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
	return { vertices, indices };
}

// Static level: one trimesh per mesh, no body.
level.traverse((child) => {
	if (!child.isMesh) return;
	const { vertices, indices } = meshData(child);
	world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));
});

// Moving prop: convex hull in the body's local space (bake only the mesh's offset inside the prop, not its world position).
const { vertices } = meshData(propMesh); // with propMesh at the origin before placing it
const hull = RAPIER.ColliderDesc.convexHull(vertices);
if (!hull) throw new Error("Convex hull failed: the points are degenerate (flat or too few)");
const propBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0));
world.createCollider(hull, propBody);
```

For Draco or meshopt files the geometry is decoded by GLTFLoader before you read it, so this works unchanged.

## 4. Collision events and sensors

```js
const pickup = world.createCollider(
	RAPIER.ColliderDesc.ball(0.5).setTranslation(2, 0.5, 0).setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
);
// after world.step(eventQueue):
eventQueue.drainCollisionEvents((handle1, handle2, started) => {
	if (started && (handle1 === pickup.handle || handle2 === pickup.handle)) collect();
});
```

Only colliders with `ActiveEvents.COLLISION_EVENTS` report events.

## 5. Character controller

```js
const controller = world.createCharacterController(0.01); // small skin offset
controller.enableAutostep(0.4, 0.2, true); // step up 40 cm ledges at least 20 cm wide
controller.enableSnapToGround(0.3);
controller.setApplyImpulsesToDynamicBodies(true);

const player = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0));
const playerCollider = world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.3), player);

// per fixed step, before world.step():
const desired = { x: input.x * speed * STEP, y: -9.81 * STEP, z: input.z * speed * STEP };
controller.computeColliderMovement(playerCollider, desired);
const move = controller.computedMovement();
const position = player.translation();
player.setNextKinematicTranslation({ x: position.x + move.x, y: position.y + move.y, z: position.z + move.z });
```

## 6. Debug view

```js
const debugLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
scene.add(debugLines);
// after stepping:
const { vertices, colors } = world.debugRender();
debugLines.geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
debugLines.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
```
