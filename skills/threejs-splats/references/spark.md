# Spark 2.4 recipes

## Contents

1. Install and import
2. Minimal scene
3. Loading options and progress
4. Level of detail and paging
5. Picking and editing
6. React Three Fiber

## 1. Install and import

`npm i @sparkjsdev/spark` (peer: `three` >= 0.180), or with an import map:

```html
<script type="importmap">
	{
		"imports": {
			"three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
			"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/",
			"@sparkjsdev/spark": "https://sparkjs.dev/releases/spark/2.4.0/spark.module.js"
		}
	}
</script>
```

## 2. Minimal scene

```js
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const renderer = new THREE.WebGLRenderer({ antialias: false }); // splats are soft-edged; enable MSAA only for meshes that need it
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);

const spark = new SparkRenderer({ renderer });
scene.add(spark); // one per renderer; it sorts and draws every SplatMesh in the scene

const room = new SplatMesh({ url: "/splats/room.spz" });
room.quaternion.set(1, 0, 0, 0); // captures are usually y-down; this flips them upright
scene.add(room);

await room.initialized;
room.updateMatrixWorld(true);
const box = room.getBoundingBox(true).applyMatrix4(room.matrixWorld); // local space, so apply the flip and placement
controls.target.copy(box.getCenter(new THREE.Vector3()));
camera.position.copy(controls.target).add(new THREE.Vector3(0, 0.5, 2));

renderer.setAnimationLoop(() => {
	controls.update();
	renderer.render(scene, camera);
});
```

`SplatMesh` is an `Object3D`: position, rotate, scale and parent it like a mesh. Meshes added to the same scene
depth-sort with the splats.

## 3. Loading options and progress

```js
const splat = new SplatMesh({
	url: "/splats/statue.spz",
	onProgress: (event) => (loader.value = event.loaded / event.total),
	onLoad: (mesh) => console.log("loaded", mesh),
});
```

Other sources: `fileBytes` (an `ArrayBuffer` from a file input or IndexedDB) with `fileType`/`fileName` when the
format cannot be sniffed, or `stream` for streamed downloads. `maxSplats` caps memory.

## 4. Level of detail and paging

For captures with millions of splats:

```js
const spark = new SparkRenderer({ renderer, enableLod: true });
const city = new SplatMesh({ url: "/splats/city.spz", lod: true }); // or lod: "quality"
```

`lodSplatCount` and `lodSplatScale` on the renderer trade quality for speed. `paged: true` on the mesh streams
pages of splats on demand for captures too large to hold in memory.

## 5. Picking and editing

- Raycasting: `new SplatMesh({ url, raycastable: true })`, then a normal `Raycaster.intersectObject(splat)`;
  `minRaycastOpacity` skips faint splats.
- Editing: `SplatEdit` with `SplatEditSdf` shapes (box, sphere and others from `SplatEditSdfType`) recolors, hides
  or reveals splats inside a region, which is how you cut a floor out or fade a capture in. Set
  `editable: true` on meshes that edits should affect.
- Per-frame effects: `onFrame: ({ mesh, time, deltaTime }) => {}` on the mesh, and the `dyno` shader-graph modules
  for GPU-side animation.

## 6. React Three Fiber

Spark classes are plain three.js objects, so register them with `extend` and pass the R3F renderer:

```jsx
import { Canvas, extend, useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { useMemo } from "react";

extend({ SparkRenderer, SplatMesh });

function Spark() {
	const gl = useThree((state) => state.gl);
	const args = useMemo(() => [{ renderer: gl }], [gl]);
	return <sparkRenderer args={args} />;
}

export function App() {
	return (
		<Canvas gl={{ antialias: false }} dpr={[1, 2]}>
			<Spark />
			<splatMesh args={[{ url: "/splats/room.spz" }]} quaternion={[1, 0, 0, 0]} />
		</Canvas>
	);
}
```

TypeScript needs the elements declared (see `threejs-upgrade`'s R3F v9 notes on `ThreeElements` augmentation).
