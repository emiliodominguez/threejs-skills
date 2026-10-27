# Migrations that need judgment

Read the section for each linter finding without `(--fix)`. Sources: the official three.js migration guide
(github.com/mrdoob/three.js/wiki/Migration-Guide), the r186 source, and the React Three Fiber v9 migration guide.

## Contents

1. Physical light units (r155)
2. Color management (r152)
3. Clock to Timer (r183)
4. Controls (r168, r169, r175)
5. Loaders that changed (r180, r184, r185)
6. Geometry and attributes
7. React Three Fiber v8 to v9
8. WebGPURenderer and TSL imports (r167, r171, r181, r183)
9. Visual changes with no code change

## 1. Physical light units (r155)

`physicallyCorrectLights` (r150) became `useLegacyLights` (default `false` in r155), which was later removed. Lights
now use physical units and always will.

- Delete any `physicallyCorrectLights` or `useLegacyLights` line.
- Scenes tuned under legacy lights look darker: legacy intensities for point, spot and directional lights were
  effectively multiplied by PI. Start by multiplying those intensities by `Math.PI`, then tune on screen.
- Point and spot lights now have physical falloff (`decay = 2`). A `decay = 1` from old code keeps the old falloff
  but is not physically based; prefer `decay = 2` with a larger intensity.
- `AmbientLight` and `HemisphereLight` intensities also scale by PI under the new model.

## 2. Color management (r152)

- `renderer.outputEncoding = sRGBEncoding` becomes `renderer.outputColorSpace = SRGBColorSpace`, which is the
  default: delete the line.
- `texture.encoding = sRGBEncoding` becomes `texture.colorSpace = SRGBColorSpace`, for color textures only (`map`,
  `emissiveMap`, sheen and specular color maps). Data textures (normal, roughness, metalness, AO) stay
  `NoColorSpace`, the default. `LinearEncoding` on a data texture should become nothing at all, not
  `LinearSRGBColorSpace`.
- `ColorManagement.enabled` is `true` by default: hex colors in code (`color.set("#ff0000")`) are sRGB and convert
  automatically. Code that converted manually (`convertSRGBToLinear()` on every color) now double-converts.
- The second UV set is `uv1`, not `uv2`; textures select their set with `texture.channel`.

## 3. Clock to Timer (r183)

```js
// before
const clock = new THREE.Clock();
function animate() {
	const delta = clock.getDelta();
	mixer.update(delta);
	renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// after
const timer = new THREE.Timer();
timer.connect(document); // pause delta while the tab is hidden (opt-in since r174)
function animate(timestamp) {
	timer.update(timestamp);
	mixer.update(timer.getDelta());
	renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
```

`clock.getElapsedTime()` becomes `timer.getElapsed()`. `Timer` is in core since r179; remove imports from
`three/addons/misc/Timer.js`.

## 4. Controls (r168, r169, r175)

- **TransformControls** (r169) is no longer an `Object3D`: `scene.add(controls)` becomes
  `scene.add(controls.getHelper())`.
- **DragControls** (r168): `activate()`/`deactivate()` are `connect()`/`disconnect()`; `getObjects()` is
  `controls.objects`; `getRaycaster()` is `controls.raycaster`.
- **PointerLockControls** (r168): `getObject()` is `controls.object`.
- **All controls** (r175): `controls.connect(element)` requires the DOM element.

## 5. Loaders that changed

- `RGBELoader` is `HDRLoader` (r180), same API: `three/addons/loaders/HDRLoader.js`.
- `RGBMLoader` (r180), `BasisTextureLoader` (r150) and `LottieLoader` are gone: use HDR/EXR/Ultra HDR, KTX2, and
  `lottie-web` with a `CanvasTexture`.
- `USDZLoader` is deprecated (r179): use `USDLoader`.
- `FileLoader.load()` and `ImageBitmapLoader.load()` return nothing since r184: use the `onLoad` callback or
  `loadAsync()`.
- `FBXLoader` converts +Z-up models to +Y-up since r184: remove manual `rotation.x = -Math.PI / 2` fixes.
- `DRACOLoader.setDecoderConfig()` is deprecated (r185): delete it; DRACOLoader always uses WASM.
- `KTX2Loader.detectSupportAsync()` is deprecated (r181): `await renderer.init()` then `detectSupport(renderer)`.

## 6. Geometry and attributes

- `BufferAttribute.updateRange = { offset, count }` becomes `attribute.addUpdateRange(offset, count)`, with
  `clearUpdateRanges()` (r159).
- `TextGeometry` option `height` is `depth` (r163); `CapsuleGeometry` parameter `length` is `height` (r176).
- `SimplifyModifier.modify()` is async since r186 and produces different results (meshoptimizer based).
- `toTrianglesDrawMode()` changes the geometry in place since r186; `clone()` first to keep the original.
- `Object3D.dispose()` exists since r186: custom subclasses with their own `dispose()` must call `super.dispose()`.
- With `matrixAutoUpdate = false`, set `object.matrixWorldNeedsUpdate = true` after editing `object.matrix` (r185).

## 7. React Three Fiber v8 to v9

v9 is the React 19 release; upgrade `react`, `react-dom`, `@react-three/fiber` (9) and `@react-three/drei` (10)
together.

- `<Canvas gl={(canvas) => new WebGLRenderer({ canvas })} />` becomes
  `<Canvas gl={(props) => new WebGLRenderer(props)} />`. The callback may be async (needed for WebGPU):

  ```jsx
  <Canvas
  	gl={async (props) => {
  		const renderer = new WebGPURenderer(props);
  		await renderer.init();
  		return renderer;
  	}}
  />
  ```

- Types: `Props` is `CanvasProps`; `MeshProps` and friends become `ThreeElements['mesh']`; `Node`,
  `Object3DNode`, `BufferGeometryNode`, `MaterialNode`, `LightNode` become `ThreeElement`.
- Custom elements: replace `declare global { namespace JSX { ... } }` with module augmentation:

  ```ts
  import { type ThreeElement, extend } from "@react-three/fiber";
  declare module "@react-three/fiber" {
  	interface ThreeElements {
  		customElement: ThreeElement<typeof CustomElement>;
  	}
  }
  extend({ CustomElement });
  ```

- Texture props on custom materials and shaders are no longer converted to sRGB automatically: set
  `texture.colorSpace = THREE.SRGBColorSpace` or `texture-colorSpace={THREE.SRGBColorSpace}`. Built-in materials
  are unaffected.
- StrictMode is inherited from the parent React root: remove `<StrictMode>` inside `<Canvas>`. Effects that were not
  idempotent show up now; fix their cleanup.
- Import `act` from `react` in tests.
- Re-test code that swaps `args` or a `<primitive object>` dynamically, and effects that ran during Suspense.

## 8. WebGPURenderer and TSL imports

- Import `WebGPURenderer`, node materials and `RenderPipeline` from `three/webgpu`, TSL functions from `three/tsl`
  (r171). Paths under `three/nodes` or `examples/jsm/renderers/webgpu` are gone.
- `PostProcessing` is `RenderPipeline` (r183).
- `renderAsync()`, `computeAsync()` and the other async methods are deprecated (r181): `await renderer.init()` once
  (or let `setAnimationLoop` do it), then call the sync methods.
- TSL renames the linter reports: `uniforms()` to `uniformArray()`, `burn/dodge/screen/overlay` to `blend*`,
  `rangeFog/densityFog` to `fog(color, rangeFogFactor(...))`, chained `.varying()` to `.toVarying()`, `label()` to
  `setName()`, `PI2` to `TWO_PI`.

## 9. Visual changes with no code change

These releases change how correct code looks; compare screenshots rather than hunting for a bug:

- r155: physical lights (section 1).
- r181: better indirect specular, energy conservation for rough materials (rough surfaces look brighter), improved
  PMREM reflections.
- r183: `RoomEnvironment` moved its scene position (environment lighting from it looks different); `Sky` lost a
  legacy gamma correction.
- r184: background and environment rotation now follows object rotation conventions.
- r187 (announced): PMREMs become cube render targets; materials using environment maps look slightly different.
