# React Three Fiber recipes (R3F 9, drei 10)

## Contents

1. Declarative parts with gltfjsx
2. Recoloring without leaking into other instances
3. Swapping textures
4. Showing and hiding parts
5. Click to select a part
6. Attaching objects to named nodes
7. Variants

## 1. Declarative parts with gltfjsx

For a configurator, generate a component so every part is JSX you can bind to state:

```bash
npx gltfjsx public/models/product.glb --types --output src/Product.tsx
```

The output uses `const { nodes, materials } = useGLTF(url)` and renders each mesh as
`<mesh geometry={nodes.Body_Paint.geometry} material={materials.Paint} />`. Edit that JSX: replace `material=` with
your own material element or bind props. Skip `--transform` here; it joins and renames parts (see
`threejs-model-optimize`'s `configurator` preset instead).

## 2. Recoloring without leaking into other instances

`useGLTF` caches by URL, so `materials.Paint` is the same object in every component that loads the file, and
mutating it recolors all of them. Give the part its own material:

```jsx
import { useMemo } from "react";

function Product({ bodyColor }) {
	const { nodes, materials } = useGLTF("/models/product.glb");
	const paint = useMemo(() => materials.Paint.clone(), [materials.Paint]); // owned by this instance
	return (
		<group dispose={null}>
			<mesh geometry={nodes.Body_Paint.geometry} material={paint} material-color={bodyColor} />
			<mesh geometry={nodes.Trim.geometry} material={materials.Chrome} />
		</group>
	);
}
```

The clone keeps the original's maps and factors, and `material-color` sets its color declaratively. Colors passed as
props are sRGB, like a color picker. Dispose the clone on unmount when products mount and unmount often:
`useEffect(() => () => paint.dispose(), [paint])`.

## 3. Swapping textures

```jsx
import { useTexture } from "@react-three/drei";

function Fabric({ pattern }) {
	const { nodes, materials } = useGLTF("/models/chair.glb");
	const map = useTexture(`/textures/${pattern}.jpg`, (texture) => {
		texture.flipY = false; // glTF UVs
		texture.colorSpace = THREE.SRGBColorSpace;
	});
	const fabric = useMemo(() => materials.Fabric.clone(), [materials.Fabric]);
	return <mesh geometry={nodes.Seat.geometry} material={fabric} material-map={map} />;
}
```

`useTexture` caches by URL; preload likely options with `useTexture.preload(url)`. Wrap in `<Suspense>` so a slow
texture does not blank the whole scene.

## 4. Showing and hiding parts

```jsx
<mesh geometry={nodes.Spoiler.geometry} material={materials.Paint} visible={hasSpoiler} />
```

With a `<primitive object={scene} />` instead of gltfjsx JSX, set `nodes.Spoiler.visible` in an effect.

## 5. Click to select a part

R3F raycasts for you. Stop propagation so only the front-most part handles the click:

```jsx
<mesh
	geometry={nodes.Seat.geometry}
	onClick={(event) => {
		event.stopPropagation();
		onSelect("Seat");
	}}
	onPointerOver={() => (document.body.style.cursor = "pointer")}
	onPointerOut={() => (document.body.style.cursor = "auto")}
	material={fabric}
	material-emissive={selected === "Seat" ? "#333" : "#000"}
/>
```

drei's `<Outlines>` inside a mesh is a cheap highlight; `@react-three/postprocessing`'s `<Outline>` for many parts.

## 6. Attaching objects to named nodes

Render into a node with `createPortal`, so the child follows bones or moving parts:

```jsx
import { createPortal } from "@react-three/fiber";

function Armed() {
	const { scene, nodes } = useGLTF("/models/character.glb");
	return (
		<>
			<primitive object={scene} />
			{createPortal(<Sword position={[0, 0.1, 0]} />, nodes.mixamorigRightHand)}
		</>
	);
}
```

For cloned characters, use the clone's nodes from `useGraph(clone)` (see `threejs-model-animate`'s `r3f.md`).

## 7. Variants

drei has no `KHR_materials_variants` hook. Use the vanilla `selectVariant(gltf, name)` helper from `vanilla.md`
with the object `useGLTF` returns (it includes `parser`), called in an effect when the selected variant changes:

```jsx
const gltf = useGLTF("/models/shoe.glb");
useEffect(() => {
	selectVariant(gltf, variant);
}, [gltf, variant]);
```
