# Vanilla three.js recipes (r186)

## Contents

1. Finding parts
2. Recoloring one part
3. Swapping materials
4. Swapping textures
5. Showing and hiding parts
6. KHR_materials_variants
7. Click to select a part
8. Attaching objects to named nodes
9. Applying a configuration state

## 1. Finding parts

```js
const gltf = await loader.loadAsync("/models/product.glb");
const model = gltf.scene;

const body = model.getObjectByName("Body_Paint"); // three.js name from the inspect report
if (!body) throw new Error("Body_Paint not found; check the inspect report for the sanitized name");

// A node tagged "Group of N meshes" is a Group; its child meshes hold one material each.
const meshes = [];
body.traverse((child) => child.isMesh && meshes.push(child));

// By material name, across the whole model:
function meshesUsing(root, materialName) {
	const found = [];
	root.traverse((child) => child.isMesh && [].concat(child.material).some((m) => m.name === materialName) && found.push(child));
	return found;
}
```

## 2. Recoloring one part

Clone once per part, remember the original, then edit freely:

```js
/** Gives a mesh its own copy of its material, once, and returns it. */
function ownMaterial(mesh) {
	if (!mesh.userData.originalMaterial) {
		mesh.userData.originalMaterial = mesh.material;
		mesh.material = mesh.material.clone();
	}
	return mesh.material;
}

ownMaterial(bodyMesh).color.set("#c0392b");
```

Colors are interpreted in sRGB by `color.set("#hex")`, which is what users expect from a picker. If the part has a
`map`, the color multiplies it; for a pure color set `material.map = null; material.needsUpdate = true;`.

Reset: `mesh.material.dispose(); mesh.material = mesh.userData.originalMaterial; delete mesh.userData.originalMaterial;`

## 3. Swapping materials

```js
const finishes = {
	matte: new THREE.MeshStandardMaterial({ color: "#222", roughness: 0.9, metalness: 0 }),
	chrome: new THREE.MeshStandardMaterial({ color: "#fff", roughness: 0.05, metalness: 1 }), // needs scene.environment
	glass: new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0.05, thickness: 0.01 }),
};
for (const mesh of meshes) mesh.material = finishes.chrome; // shared on purpose: one finish, many parts
```

Create finish materials once and share them; only per-part edits need clones.

## 4. Swapping textures

```js
const textureLoader = new THREE.TextureLoader();
const cache = new Map();

/** Loads a texture configured for glTF UVs. Color maps are sRGB; data maps stay linear. */
async function gltfTexture(url, { color = true } = {}) {
	if (!cache.has(url)) {
		const texture = await textureLoader.loadAsync(url);
		texture.flipY = false; // glTF UV origin is top-left
		if (color) texture.colorSpace = THREE.SRGBColorSpace;
		texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
		cache.set(url, texture);
	}
	return cache.get(url);
}

const material = ownMaterial(fabricMesh);
material.map = await gltfTexture("/textures/denim.jpg");
material.normalMap = await gltfTexture("/textures/denim_normal.jpg", { color: false });
material.needsUpdate = true; // required when a map goes from null to a texture
```

Tiling: `texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(4, 4);` on a texture used only by
this part (clone the texture if it is shared, then set `needsUpdate = true`).

## 5. Showing and hiding parts

```js
model.getObjectByName("Spoiler").visible = false; // hides the node and its children; still raycastable unless filtered
```

For mutually exclusive options (wheel styles), keep all variants in the file under one parent and show one child.

## 6. KHR_materials_variants

GLTFLoader keeps the extension data but does not apply it. This helper switches variants using the parser's
associations:

```js
/** Lists variant names declared in the file. */
function variantNames(gltf) {
	return gltf.parser.json.extensions?.KHR_materials_variants?.variants.map((variant) => variant.name) ?? [];
}

/** Applies a variant by name, or restores the default materials when name is null. */
async function selectVariant(gltf, name) {
	const variantIndex = variantNames(gltf).indexOf(name);
	const tasks = [];
	gltf.scene.traverse((object) => {
		if (!object.isMesh) return;
		const association = gltf.parser.associations.get(object);
		if (association?.primitives === undefined) return;
		const primitive = gltf.parser.json.meshes[association.meshes].primitives[association.primitives];
		const mappings = primitive.extensions?.KHR_materials_variants?.mappings ?? [];
		object.userData.defaultMaterial ??= object.material;
		const mapping = mappings.find((entry) => entry.variants.includes(variantIndex));
		if (!mapping) {
			object.material = object.userData.defaultMaterial;
			return;
		}
		tasks.push(gltf.parser.getDependency("material", mapping.material).then((material) => (object.material = material)));
	});
	await Promise.all(tasks);
}
```

`getDependency` caches, so switching back and forth does not reload. Skinned and morphed meshes may need
`material.needsUpdate = true` after a swap.

## 7. Click to select a part

```js
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

renderer.domElement.addEventListener("pointerdown", (event) => {
	const rect = renderer.domElement.getBoundingClientRect();
	pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, camera);
	const hit = raycaster.intersectObject(model, true).find((entry) => entry.object.visible);
	if (!hit) return;
	// Walk up to the configurable part, not the leaf primitive mesh.
	let part = hit.object;
	while (part.parent && !configurableNames.has(part.name)) part = part.parent;
	select(part);
});
```

Highlight without touching the shared material: an `OutlinePass`, or `ownMaterial(mesh).emissive.set("#333")` and
restore on deselect.

## 8. Attaching objects to named nodes

```js
const hand = model.getObjectByName("mixamorigRightHand");
hand.add(sword); // sword now follows the bone; its position/rotation are relative to the hand
sword.position.set(0, 0.1, 0);

// Keep the current world placement instead (re-parent without jumping):
hand.attach(sword);
```

A model scaled at load (0.01 for a centimeter export) scales attached children too; set their scale relative to the
parent or attach to an unscaled wrapper. For many identical attachments, use `InstancedMesh` and update matrices
from the bones each frame.

## 9. Applying a configuration state

```js
const options = {
	body: { "Body_Paint": (mesh, value) => ownMaterial(mesh).color.set(value) },
	wheels: (value) => {
		for (const child of model.getObjectByName("Wheels").children) child.visible = child.name === value;
	},
};

/** Applies a full configuration such as { body: "#c0392b", wheels: "Wheel_Sport" }. */
function applyConfig(config) {
	options.wheels(config.wheels);
	model.getObjectByName("Body_Paint").traverse((child) => child.isMesh && options.body.Body_Paint(child, config.body));
}
```

Serialize the state to the URL (`new URLSearchParams(config)`) for shareable configurations.
