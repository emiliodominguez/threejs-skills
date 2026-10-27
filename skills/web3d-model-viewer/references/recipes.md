# `<model-viewer>` 4.4 recipes

## Contents

1. AR
2. Hotspots
3. Variants and material colors
4. Camera presets
5. Animation
6. Events and loading control
7. Frameworks

## 1. AR

```html
<model-viewer src="/models/chair.glb" ios-src="/models/chair.usdz" alt="Oak lounge chair"
	ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed" ar-placement="floor">
	<button slot="ar-button" class="ar-button">View in your room</button>
</model-viewer>
```

- `ar-modes` is a priority list; the first one the device supports is used.
- `ar-scale="fixed"` keeps real-world size (the model must be in meters); `auto` lets users resize.
- `ar-placement="wall"` for paintings and shelves.
- Without `ios-src`, model-viewer generates a USDZ on the fly for Quick Look; `ar-usdz-max-texture-size` caps its
  textures. Provide a USDZ when the generated one looks wrong.
- Check `modelViewer.canActivateAR` to hide your own AR prompts on unsupported devices.

## 2. Hotspots

Children with a `slot` starting with `hotspot` are pinned to a point and normal on the model (model units):

```html
<model-viewer src="/models/speaker.glb" alt="Speaker" camera-controls>
	<button class="hotspot" slot="hotspot-grille" data-position="0 0.12 0.08" data-normal="0 0 1" data-visibility-attribute="visible">
		<span class="label">Woven grille</span>
	</button>
</model-viewer>
```

Find a position by clicking: `const hit = modelViewer.positionAndNormalFromPoint(event.clientX, event.clientY)`
returns `{ position, normal }` to paste into the attributes. Style `[data-visible]` to fade labels on the far side.
After changing `data-position` at runtime, call `modelViewer.updateHotspot({ name: "hotspot-grille", position: "..." })`.

## 3. Variants and material colors

`KHR_materials_variants` is built in:

```js
const viewer = document.querySelector("model-viewer");
viewer.addEventListener("load", () => {
	const variants = viewer.availableVariants; // names from the file
	select.replaceChildren(...variants.map((name) => new Option(name, name)));
});
select.addEventListener("change", () => (viewer.variantName = select.value)); // or the variant-name attribute
```

Recolor one material (names from the inspect report; colors are sRGB hex or linear RGBA):

```js
viewer.addEventListener("load", () => {
	const paint = viewer.model.getMaterialByName("Paint");
	paint.pbrMetallicRoughness.setBaseColorFactor("#c0392b");
	paint.pbrMetallicRoughness.setRoughnessFactor(0.4);
});
```

Swap a texture:

```js
const texture = await viewer.createTexture("/textures/denim.jpg");
viewer.model.getMaterialByName("Fabric").pbrMetallicRoughness.baseColorTexture.setTexture(texture);
```

Materials shared between parts change together, as in the file; split them in the DCC tool if parts must differ.

`viewer.model.materials` lists every material in the file, including variant materials that are not in use; filter
with `material.isActive` to find what is on screen (`materials[0]` is not "the current material").

## 4. Camera presets

```html
<model-viewer camera-orbit="30deg 75deg 2.5m" camera-target="0m 0.4m 0m" field-of-view="30deg"
	min-camera-orbit="auto 20deg auto" max-camera-orbit="auto 100deg 4m" interpolation-decay="200"></model-viewer>
```

Animate to a preset by setting the properties; `interpolation-decay` controls the glide:

```js
viewer.cameraOrbit = "120deg 60deg 1.5m";
viewer.cameraTarget = "0m 0.6m 0m";
```

`auto-rotate` with `auto-rotate-delay` for idle spin; `disable-zoom` on pages where scroll should pass through.

## 5. Animation

```html
<model-viewer src="/models/robot.glb" alt="Robot" animation-name="Wave" autoplay animation-crossfade-duration="300"></model-viewer>
```

`viewer.availableAnimations` lists clip names; `viewer.play({ repetitions: 1 })` and `viewer.pause()` control
playback. Set `animationName` to switch clips with a crossfade.

## 6. Events and loading control

- `load`: the model is ready (materials and variants are available).
- `progress`: `event.detail.totalProgress` from 0 to 1, for a custom progress bar (`slot="progress-bar"` to replace
  the default).
- `error`: loading failed; show the poster and a message.
- `ar-status`: `session-started`, `object-placed`, `failed`, `not-presenting`.
- `reveal="manual"` keeps the poster until you call `viewer.dismissPoster()`; `loading="eager"` starts the
  download immediately for the hero model.

## 7. Frameworks

It is a standard custom element. In React 19, use it directly (`<model-viewer src=... camera-controls />`; React 19
passes custom element properties and events). In TypeScript, declare it in `JSX.IntrinsicElements` or import the
package's types. Import the package only on the client (it touches `window`): a dynamic `import("@google/model-viewer")`
in an effect, or a client-only component in Next.js.
