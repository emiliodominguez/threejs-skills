# Vanilla three.js WebXR (r186)

## Contents

1. Session buttons
2. AR placement with hit testing
3. Light estimation
4. Controllers and hands
5. Moving the player

## 1. Session buttons

```js
import { ARButton } from "three/addons/webxr/ARButton.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { XRButton } from "three/addons/webxr/XRButton.js"; // picks AR or VR, whichever is supported

renderer.xr.enabled = true;
document.body.appendChild(VRButton.createButton(renderer));
renderer.setAnimationLoop(render); // never requestAnimationFrame: it stops inside a session
```

The buttons check `isSessionSupported` and show "not supported" text themselves.

## 2. AR placement with hit testing

```js
document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ["hit-test"], optionalFeatures: ["dom-overlay"], domOverlay: { root: overlay } }));

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

let hitTestSource = null;
renderer.xr.addEventListener("sessionstart", async () => {
	const session = renderer.xr.getSession();
	const viewerSpace = await session.requestReferenceSpace("viewer");
	hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
	session.addEventListener("end", () => (hitTestSource = null));
});

const controller = renderer.xr.getController(0);
controller.addEventListener("select", () => {
	if (!reticle.visible) return;
	const placed = model.clone();
	reticle.matrix.decompose(placed.position, placed.quaternion, placed.scale);
	placed.scale.setScalar(1); // keep real-world scale
	scene.add(placed);
});
scene.add(controller);

function render(timestamp, frame) {
	if (frame && hitTestSource) {
		const results = frame.getHitTestResults(hitTestSource);
		const pose = results[0]?.getPose(renderer.xr.getReferenceSpace());
		reticle.visible = Boolean(pose);
		if (pose) reticle.matrix.fromArray(pose.transform.matrix);
	}
	renderer.render(scene, camera);
}
```

Rigged models need `SkeletonUtils.clone` instead of `clone()` (see `threejs-model-animate`).

## 3. Light estimation

```js
import { XREstimatedLight } from "three/addons/webxr/XREstimatedLight.js";
// request it: ARButton.createButton(renderer, { optionalFeatures: ["light-estimation"] })
const xrLight = new XREstimatedLight(renderer);
xrLight.addEventListener("estimationstart", () => {
	scene.add(xrLight);
	if (xrLight.environment) scene.environment = xrLight.environment;
});
xrLight.addEventListener("estimationend", () => {
	scene.remove(xrLight);
	scene.environment = defaultEnvironment;
});
```

## 4. Controllers and hands

```js
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";

const controllerModels = new XRControllerModelFactory();
const handModels = new XRHandModelFactory();
for (const index of [0, 1]) {
	const grip = renderer.xr.getControllerGrip(index);
	grip.add(controllerModels.createControllerModel(grip));
	scene.add(grip);
	const hand = renderer.xr.getHand(index);
	hand.add(handModels.createHandModel(hand, "mesh"));
	scene.add(hand);
	const ray = renderer.xr.getController(index); // target ray space: selectstart, selectend, squeezestart...
	ray.addEventListener("selectstart", onSelect);
	scene.add(ray);
}
```

Hand tracking must be requested: `VRButton.createButton(renderer, { optionalFeatures: ["hand-tracking"] })`.

## 5. Moving the player

The headset owns the camera. Put the camera in a rig group and move the rig:

```js
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
// teleport or thumbstick locomotion: rig.position.add(offset)
```
