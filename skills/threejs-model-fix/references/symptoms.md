# Symptoms, causes and fixes

Find the symptom, confirm the cause with the check, then apply the fix for the stack in use. Code targets three
r186, React Three Fiber 9 and drei 10. Inspect codes refer to findings from `threejs-model-inspect`.

## Contents

1. Black or very dark model
2. Nothing visible
3. Far too large or too small
4. Off-center, wrong pivot, floating
5. Inside-out, see-through or missing faces
6. Faceted or blotchy shading
7. Washed-out, too dark or too saturated colors
8. White or missing textures
9. Transparency artifacts
10. Flickering surfaces (z-fighting)
11. No shadows
12. Loader errors
13. Animation does nothing or model stays in T-pose

## Helpers used below

Vanilla framing and normalizing (reuse in any fix that needs bounds):

```js
import * as THREE from "three";

/** Centers the model on the origin, rests it on y = 0 and optionally scales its largest side to `targetSize`. */
function normalizeModel(model, targetSize) {
	const box = new THREE.Box3().setFromObject(model);
	const size = box.getSize(new THREE.Vector3());
	if (targetSize) {
		model.scale.multiplyScalar(targetSize / Math.max(size.x, size.y, size.z));
		box.setFromObject(model);
	}
	const center = box.getCenter(new THREE.Vector3());
	model.position.x -= center.x;
	model.position.z -= center.z;
	model.position.y -= box.min.y;
}

/** Points the camera at the object from a distance that fits its bounding sphere, with sane near/far. */
function frameObject(object, camera, controls) {
	const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
	const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
	camera.position.copy(sphere.center).add(new THREE.Vector3(0.6, 0.4, 1).normalize().multiplyScalar(distance));
	camera.near = distance / 100;
	camera.far = distance * 100;
	camera.updateProjectionMatrix();
	controls?.target.copy(sphere.center);
	controls?.update();
}
```

R3F equivalents come from drei: `<Bounds fit clip observe margin={1.2}>` frames children, `<Center top>` centers and
grounds them, `<Resize>` scales the largest side to 1.

## 1. Black or very dark model

Inspect codes: `metal-needs-env`, `needs-lighting`.

- **Cause:** PBR materials with no light or environment. Fully metallic materials (glTF's default `metallicFactor` is
  1) reflect only the environment, so lights alone leave them black.
- **Check:** toggle `environment` in the reference viewer; if the model appears, this is it.
- **Vanilla:**

  ```js
  import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  renderer.toneMapping = THREE.NeutralToneMapping; // without it, light diffuse materials clip to flat white
  ```

  The default `NoToneMapping` clips everything above 1.0, and an environment plus lights easily exceeds that on
  pale materials. Keep a tone mapper on whenever an environment lights the scene; lower
  `scene.environmentIntensity` if the result is still too bright.

  For an HDR: `new HDRLoader().load(url, (t) => { t.mapping = THREE.EquirectangularReflectionMapping; scene.environment = t; })`
  (`HDRLoader` replaced `RGBELoader`).
- **R3F:** `<Environment preset="city" />`. Presets download from a CDN (githack), so they fail offline and under a
  strict CSP; for those, self-host the HDR (`<Environment files="/hdr/studio.hdr" />`) or build one from shapes:
  `<Environment resolution={256}><Lightformer intensity={2} position={[0, 5, -5]} scale={10} /></Environment>`.
- **Also:** a black model with an environment set is often a normal map in the wrong color space (see 7) or missing
  normals (see 6).

## 2. Nothing visible

Inspect codes: `scale-large`, `scale-small`, `off-center`.

- **Causes:** the camera is inside the model, the model is outside the frustum, it is clipped by `near`/`far`, or it
  was never added to the scene (async load finished after a re-render).
- **Check:** `console.log(new THREE.Box3().setFromObject(model))` and compare with the camera position; add
  `scene.add(new THREE.Box3Helper(box, 0xff0000))`.
- **Vanilla:** `frameObject(model, camera, controls)` after `scene.add(model)`.
- **R3F:** wrap the model in `<Bounds fit clip observe>`; make sure `<Suspense>` surrounds the component that calls
  `useGLTF`, or the component suspends forever without a visible error.

## 3. Far too large or too small

Inspect codes: `scale-large` (often a centimeter export), `scale-small`.

- **Vanilla:** `normalizeModel(model, 2)` to make the largest side 2 units, or `model.scale.setScalar(0.01)` for a
  known centimeter export so real-world scale is kept across assets.
- **R3F:** `<primitive object={scene} scale={0.01} />`, or `<Resize><Model /></Resize>` to normalize to 1 unit.
- **Source fix:** export from the DCC with "apply unit scale" or meters as the unit, so every asset agrees.

## 4. Off-center, wrong pivot, floating

Inspect codes: `off-center`, `not-grounded`.

- **Vanilla:** `normalizeModel(model)`. To rotate around the visual center, put the model in a `Group`, normalize the
  model inside it, and rotate the group.
- **R3F:** `<Center top><Model /></Center>` (`top` rests it on y = 0).

## 5. Inside-out, see-through or missing faces

Inspect code: `mirrored`.

- **Causes:** a negative scale in the export flips winding; normals point inward; single-sided planes (leaves, cloth)
  viewed from behind.
- **Check:** set `material.side = THREE.DoubleSide` temporarily (the viewer's `double-sided` toggle). If the model
  becomes solid, faces are reversed or single-sided.
- **Fix:** in Blender, apply scale (Ctrl+A) and recalculate normals outward (Shift+N), then re-export. Keep
  `DoubleSide` only on materials that are really thin surfaces; it doubles fragment cost and breaks shadow bias.

## 6. Faceted or blotchy shading

Inspect code: `no-normals`.

- **Cause:** primitives without normals; GLTFLoader turns on `flatShading`. Blotches can also come from a normal map
  using the wrong UV set or color space.
- **Vanilla (runtime repair):**

  ```js
  import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
  model.traverse((child) => {
  	if (!child.isMesh || child.geometry.attributes.normal) return;
  	child.geometry = mergeVertices(child.geometry);
  	child.geometry.computeVertexNormals();
  	child.material.flatShading = false;
  	child.material.needsUpdate = true;
  });
  ```

  Re-export with normals for a permanent fix; runtime repair costs load time and smooths hard edges.

## 7. Washed-out, too dark or too saturated colors

- **Causes:** a texture loaded by hand without a color space; tone mapping applied twice; tone mapping applied to UI
  or unlit materials.
- **Rules:** textures that came inside the glTF are already right. For textures you load yourself:
  `map` and `emissiveMap` need `texture.colorSpace = THREE.SRGBColorSpace`; normal, roughness, metalness and AO maps
  stay linear (the default). Keep `renderer.outputColorSpace` at its default (`SRGBColorSpace`).
- **Tone mapping:** with an `EffectComposer`, end the chain with `OutputPass` and do not also tone map in a pass.
  Set `material.toneMapped = false` on unlit materials and UI planes that must match exact colors. For
  product-accurate colors prefer `THREE.NeutralToneMapping`; R3F defaults to ACES filmic, change it with
  `<Canvas gl={{ toneMapping: THREE.NeutralToneMapping }}>` or `<Canvas flat>` for none.

## 8. White or missing textures

Inspect codes: `missing-files`, `no-uv`, `decoder` (KTX2).

- **Causes:** a `.gltf` whose `.bin` or images were not deployed or moved (404 in the network tab); KTX2 textures with
  no KTX2Loader; textures applied by hand with the wrong `flipY`.
- **Fix:** pack into one file: `npx @gltf-transform/cli copy model.gltf model.glb`. For hand-applied textures on glTF
  models set `texture.flipY = false` (glTF UVs are top-left origin).

## 9. Transparency artifacts

Inspect code: `many-blend`.

- **Causes:** `alphaMode: BLEND` materials sort per object, so overlapping transparent parts flicker or hide each
  other; cutout materials (foliage, hair, decals) exported as BLEND.
- **Fix:** for cutouts, `material.transparent = false; material.alphaTest = 0.5; material.needsUpdate = true;` (or
  set alpha mode to MASK/clip in Blender). For real glass use `transmission` on `MeshPhysicalMaterial`. As a last
  resort for a few overlapping parts, set `mesh.renderOrder` explicitly.

## 10. Flickering surfaces (z-fighting)

- **Causes:** `near` too small relative to `far` (for example 0.001 to 100000), or coplanar duplicate faces.
- **Fix:** set near/far from the model size (`frameObject` does it); for huge scenes,
  `new THREE.WebGLRenderer({ logarithmicDepthBuffer: true })`. Coplanar faces need a re-export, or
  `material.polygonOffset = true; material.polygonOffsetFactor = -1` on the decal layer.

## 11. No shadows

- **Fix:** shadows are opt-in per object.

  ```js
  renderer.shadowMap.enabled = true;
  light.castShadow = true;
  model.traverse((child) => {
  	if (child.isMesh) child.castShadow = child.receiveShadow = true;
  });
  ```

  Fit `light.shadow.camera` (left/right/top/bottom/near/far) to the model bounds; the default box is often far
  smaller or larger than the model. R3F: `<Canvas shadows>`, `castShadow` on the light, and set the flags in a
  `useLayoutEffect` traverse or with gltfjsx-generated JSX.

## 12. Loader errors

| Message | Fix |
| --- | --- |
| `No DRACOLoader instance provided` | `loader.setDRACOLoader(new DRACOLoader())` |
| `setMeshoptDecoder must be called before loading compressed files` | `loader.setMeshoptDecoder(MeshoptDecoder)` from `three/addons/libs/meshopt_decoder.module.js` |
| `setKTX2Loader must be called before loading KTX2 textures` | `loader.setKTX2Loader(new KTX2Loader().detectSupport(renderer))`, one shared instance |
| `Missing initialization with .detectSupport( renderer )` | Call `detectSupport(renderer)` (after `await renderer.init()` on WebGPU) |
| `Unexpected token '<'` / `JSON.parse` error | The URL returned an HTML page (404 or SPA fallback). Fix the path: in Vite and Next.js, files in `public/` load from `/model.glb` |
| `Unsupported asset. glTF versions >=2.0 are supported` | glTF 1.0 file; re-export from Blender |
| CORS error | Serve the model from the same origin or enable CORS on the CDN |
| `Unknown extension "KHR_materials_pbrSpecularGlossiness"` (warning) | `npx @gltf-transform/cli metalrough in.glb out.glb` |

R3F: drei `useGLTF(url)` wires Draco and meshopt by default, but its Draco decoder comes from the gstatic CDN; set
`useGLTF.setDecoderPath("/draco/")` and copy `node_modules/three/examples/jsm/libs/draco/gltf/` to `public/draco/` to
self-host. KTX2 needs the fourth argument:
`useGLTF(url, true, true, (loader) => loader.setKTX2Loader(ktx2Loader))` with one shared `KTX2Loader` that ran
`detectSupport(gl)`.

## 13. Animation does nothing or model stays in T-pose

- **Causes:** no `mixer.update(delta)` in the loop; the clip was applied to a clone that shares the original's
  skeleton; the clip targets bone names that differ from the rig.
- **Fix:** see `threejs-model-animate`. Quick checks: log `mixer.time` each frame (it must grow) and
  `clip.tracks[0].name` against the bone names in the inspect report.
