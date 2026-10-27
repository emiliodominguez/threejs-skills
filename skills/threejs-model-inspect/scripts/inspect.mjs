#!/usr/bin/env node
// Reports what is inside a .glb or .gltf file and what three.js needs to load and show it.
// Zero dependencies: it reads the glTF JSON and binary headers directly, so it never decodes
// geometry and runs on Draco, meshopt and KTX2 files without their decoders.
//
//   node inspect.mjs model.glb                 # human-readable report
//   node inspect.mjs model.glb --json          # machine-readable report
//   node inspect.mjs model.glb --max-nodes 200 # print more of the node tree

import { realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Extensions GLTFLoader in three r186 handles without extra plugins. */
const LOADER_EXTENSIONS = new Set([
	"EXT_materials_bump",
	"EXT_mesh_gpu_instancing",
	"EXT_meshopt_compression",
	"EXT_texture_avif",
	"EXT_texture_webp",
	"KHR_draco_mesh_compression",
	"KHR_lights_punctual",
	"KHR_materials_anisotropy",
	"KHR_materials_clearcoat",
	"KHR_materials_dispersion",
	"KHR_materials_emissive_strength",
	"KHR_materials_ior",
	"KHR_materials_iridescence",
	"KHR_materials_sheen",
	"KHR_materials_specular",
	"KHR_materials_transmission",
	"KHR_materials_unlit",
	"KHR_materials_volume",
	"KHR_mesh_quantization",
	"KHR_meshopt_compression",
	"KHR_texture_basisu",
	"KHR_texture_transform",
]);

/** Extensions that need a decoder wired into GLTFLoader, with the call that wires it. */
const DECODERS = {
	KHR_draco_mesh_compression: { name: "DRACOLoader", wiring: "loader.setDRACOLoader(new DRACOLoader())" },
	EXT_meshopt_compression: { name: "MeshoptDecoder", wiring: "loader.setMeshoptDecoder(MeshoptDecoder)" },
	KHR_meshopt_compression: { name: "MeshoptDecoder", wiring: "loader.setMeshoptDecoder(MeshoptDecoder)" },
	KHR_texture_basisu: { name: "KTX2Loader", wiring: "loader.setKTX2Loader(new KTX2Loader().detectSupport(renderer))" },
};

const COMPONENT_MAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const COLOR_SLOTS = new Set(["baseColor", "emissive", "sheenColor", "specularColor", "diffuse"]);

/**
 * Formats a byte count for people.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Formats a number with thousands separators.
 * @param {number} value
 * @returns {string}
 */
function formatCount(value) {
	return Math.round(value).toLocaleString("en-US");
}

/**
 * Rounds a number for display.
 * @param {number} value
 * @param {number} [digits]
 * @returns {number}
 */
function round(value, digits = 3) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

/**
 * Reads a URI that is either a data URI or a path relative to the asset.
 * @param {string} uri
 * @param {string} baseDir
 * @returns {Promise<Buffer | null>}
 */
async function readUri(uri, baseDir) {
	if (uri.startsWith("data:")) {
		const comma = uri.indexOf(",");
		const meta = uri.slice(5, comma);
		const payload = uri.slice(comma + 1);
		return meta.endsWith(";base64") ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
	}
	try {
		return await readFile(resolve(baseDir, decodeURIComponent(uri)));
	} catch {
		return null;
	}
}

/**
 * Loads the glTF JSON and its buffers from a .glb or .gltf file.
 * @param {string} path
 * @returns {Promise<{ json: any, buffers: (Buffer | null)[], fileBytes: number, container: string, externalBytes: number, missing: string[] }>}
 */
async function loadAsset(path) {
	const data = await readFile(path);
	const baseDir = dirname(path);
	let json;
	let glbBin = null;
	let container = "gltf";

	if (data.length >= 12 && data.readUInt32LE(0) === GLB_MAGIC) {
		container = "glb";
		let offset = 12;
		while (offset + 8 <= data.length) {
			const length = data.readUInt32LE(offset);
			const type = data.readUInt32LE(offset + 4);
			const chunk = data.subarray(offset + 8, offset + 8 + length);
			if (type === CHUNK_JSON) json = JSON.parse(chunk.toString("utf8"));
			else if (type === CHUNK_BIN) glbBin = chunk;
			offset += 8 + length;
		}
		if (!json) throw new Error("GLB has no JSON chunk");
	} else {
		json = JSON.parse(data.toString("utf8"));
	}

	const missing = [];
	let externalBytes = 0;
	const buffers = [];
	for (const [index, buffer] of (json.buffers ?? []).entries()) {
		if (buffer.uri === undefined) {
			buffers.push(index === 0 ? glbBin : null);
			continue;
		}
		const bytes = await readUri(buffer.uri, baseDir);
		if (!bytes) missing.push(buffer.uri);
		else if (!buffer.uri.startsWith("data:")) externalBytes += bytes.length;
		buffers.push(bytes);
	}

	return { json, buffers, fileBytes: data.length, container, externalBytes, missing, baseDir };
}

/**
 * Returns the first bytes of an image so its header can be parsed.
 * @param {any} asset
 * @param {any} image
 * @returns {Promise<{ bytes: Buffer | null, size: number, external: boolean }>}
 */
async function readImage(asset, image) {
	if (image.bufferView !== undefined) {
		const view = asset.json.bufferViews[image.bufferView];
		const buffer = asset.buffers[view.buffer];
		if (!buffer) return { bytes: null, size: view.byteLength, external: false };
		const start = view.byteOffset ?? 0;
		return { bytes: buffer.subarray(start, start + view.byteLength), size: view.byteLength, external: false };
	}
	if (image.uri === undefined) return { bytes: null, size: 0, external: false };
	const bytes = await readUri(image.uri, asset.baseDir);
	if (!bytes) asset.missing.push(image.uri);
	else if (!image.uri.startsWith("data:")) asset.externalBytes += bytes.length;
	return { bytes, size: bytes?.length ?? 0, external: !image.uri.startsWith("data:") };
}

/**
 * Reads width, height and format from PNG, JPEG, WebP, AVIF or KTX2 header bytes.
 * @param {Buffer | null} bytes
 * @returns {{ format: string, width: number, height: number } | null}
 */
function imageInfo(bytes) {
	if (!bytes || bytes.length < 24) return null;
	if (bytes.readUInt32BE(0) === 0x89504e47) {
		return { format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) {
				offset++;
				continue;
			}
			const marker = bytes[offset + 1];
			const length = bytes.readUInt16BE(offset + 2);
			const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
			if (isFrame) return { format: "jpeg", width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
			offset += 2 + length;
		}
		return { format: "jpeg", width: 0, height: 0 };
	}
	if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
		const kind = bytes.toString("ascii", 12, 16);
		if (kind === "VP8 ") return { format: "webp", width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
		if (kind === "VP8L") {
			const bits = bytes.readUInt32LE(21);
			return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
		}
		if (kind === "VP8X") return { format: "webp", width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
	}
	if (bytes.toString("ascii", 1, 7) === "KTX 20") {
		return { format: "ktx2", width: bytes.readUInt32LE(20), height: bytes.readUInt32LE(24) };
	}
	if (bytes.toString("ascii", 4, 8) === "ftyp") {
		const ispe = bytes.indexOf("ispe");
		if (ispe > 0 && ispe + 16 <= bytes.length) return { format: "avif", width: bytes.readUInt32BE(ispe + 8), height: bytes.readUInt32BE(ispe + 12) };
		return { format: "avif", width: 0, height: 0 };
	}
	return null;
}

/**
 * Builds a column-major 4x4 matrix from a glTF node's matrix or TRS.
 * @param {any} node
 * @returns {number[]}
 */
function localMatrix(node) {
	if (node.matrix) return node.matrix.slice();
	const [tx, ty, tz] = node.translation ?? [0, 0, 0];
	const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale ?? [1, 1, 1];
	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;
	return [
		(1 - (yy + zz)) * sx,
		(xy + wz) * sx,
		(xz - wy) * sx,
		0,
		(xy - wz) * sy,
		(1 - (xx + zz)) * sy,
		(yz + wx) * sy,
		0,
		(xz + wy) * sz,
		(yz - wx) * sz,
		(1 - (xx + yy)) * sz,
		0,
		tx,
		ty,
		tz,
		1,
	];
}

/**
 * Multiplies two column-major 4x4 matrices.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number[]}
 */
function multiply(a, b) {
	const out = new Array(16).fill(0);
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
			out[col * 4 + row] = sum;
		}
	}
	return out;
}

/**
 * Returns the determinant of the upper 3x3 of a column-major matrix.
 * @param {number[]} m
 * @returns {number}
 */
function determinant3(m) {
	return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

/**
 * Returns an accessor's min and max, undoing normalization when the values are stored integers.
 * @param {any} accessor
 * @returns {{ min: number[], max: number[] } | null}
 */
function accessorBounds(accessor) {
	if (!accessor?.min || !accessor?.max) return null;
	const scale = accessor.normalized ? COMPONENT_MAX[accessor.componentType] : undefined;
	const integral = scale && accessor.max.some((value) => Math.abs(value) > 1);
	const convert = (value) => (integral ? Math.max(value / scale, -1) : value);
	return { min: accessor.min.map(convert), max: accessor.max.map(convert) };
}

/**
 * Converts the PropertyBinding rules three.js applies to glTF names.
 * @param {string} name
 * @returns {string}
 */
function threeName(name) {
	return name.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
}

/**
 * Counts the triangles a primitive draws.
 * @param {any} json
 * @param {any} primitive
 * @returns {{ triangles: number, vertices: number }}
 */
function primitiveCounts(json, primitive) {
	const vertices = json.accessors?.[primitive.attributes?.POSITION]?.count ?? 0;
	const count = primitive.indices !== undefined ? (json.accessors?.[primitive.indices]?.count ?? 0) : vertices;
	const mode = primitive.mode ?? 4;
	let triangles = 0;
	if (mode === 4) triangles = count / 3;
	else if (mode === 5 || mode === 6) triangles = Math.max(count - 2, 0);
	return { triangles, vertices };
}

/**
 * Collects every texture reference inside a material, keyed by slot.
 * @param {any} material
 * @returns {{ slot: string, index: number, texCoord: number, transform: boolean }[]}
 */
function materialTextures(material) {
	const found = [];
	/**
	 * Records one texture info object.
	 * @param {string} slot
	 * @param {any} info
	 */
	function add(slot, info) {
		if (info?.index === undefined) return;
		found.push({ slot, index: info.index, texCoord: info.texCoord ?? 0, transform: Boolean(info.extensions?.KHR_texture_transform) });
	}
	const pbr = material.pbrMetallicRoughness ?? {};
	add("baseColor", pbr.baseColorTexture);
	add("metallicRoughness", pbr.metallicRoughnessTexture);
	add("normal", material.normalTexture);
	add("occlusion", material.occlusionTexture);
	add("emissive", material.emissiveTexture);
	for (const [extension, body] of Object.entries(material.extensions ?? {})) {
		for (const [key, value] of Object.entries(body ?? {})) {
			if (key.endsWith("Texture")) {
				const short = extension.replace(/^KHR_materials_|^EXT_materials_/, "");
				add(key === "diffuseTexture" ? "diffuse" : `${short}.${key.replace(/Texture$/, "")}`, value);
			}
		}
	}
	return found;
}

/**
 * Picks the image index a texture samples, preferring compressed variants.
 * @param {any} texture
 * @returns {number | undefined}
 */
function textureImage(texture) {
	const ext = texture.extensions ?? {};
	return ext.KHR_texture_basisu?.source ?? ext.EXT_texture_webp?.source ?? ext.EXT_texture_avif?.source ?? texture.source;
}

/**
 * Inspects a glTF asset and returns a structured report.
 * @param {string} path
 * @returns {Promise<any>}
 */
export async function inspect(path) {
	const asset = await loadAsset(path);
	const { json } = asset;
	const accessors = json.accessors ?? [];
	const nodes = json.nodes ?? [];
	const meshes = json.meshes ?? [];
	const materials = json.materials ?? [];
	const textures = json.textures ?? [];
	const images = json.images ?? [];
	const animations = json.animations ?? [];
	const skins = json.skins ?? [];

	const extensionsUsed = json.extensionsUsed ?? [];
	const extensionsRequired = json.extensionsRequired ?? [];
	const decoders = [...new Set(extensionsUsed.filter((name) => DECODERS[name]).map((name) => DECODERS[name].name))].map((name) => ({
		name,
		wiring: Object.values(DECODERS).find((decoder) => decoder.name === name).wiring,
		required: extensionsRequired.some((ext) => DECODERS[ext]?.name === name),
	}));
	const unsupported = extensionsUsed.filter((name) => !LOADER_EXTENSIONS.has(name));

	// Byte breakdown by what each buffer view feeds.
	const viewCategory = new Map();
	/**
	 * Tags an accessor's buffer view with a category.
	 * @param {number | undefined} accessorIndex
	 * @param {string} category
	 */
	function tagAccessor(accessorIndex, category) {
		const view = accessors[accessorIndex]?.bufferView;
		if (view !== undefined && !viewCategory.has(view)) viewCategory.set(view, category);
	}
	for (const mesh of meshes) {
		for (const primitive of mesh.primitives ?? []) {
			for (const accessor of Object.values(primitive.attributes ?? {})) tagAccessor(accessor, "geometry");
			tagAccessor(primitive.indices, "geometry");
			for (const target of primitive.targets ?? []) for (const accessor of Object.values(target)) tagAccessor(accessor, "morph targets");
			const draco = primitive.extensions?.KHR_draco_mesh_compression;
			if (draco) viewCategory.set(draco.bufferView, "geometry");
		}
	}
	for (const animation of animations) {
		for (const sampler of animation.samplers ?? []) {
			tagAccessor(sampler.input, "animation");
			tagAccessor(sampler.output, "animation");
		}
	}
	for (const skin of skins) tagAccessor(skin.inverseBindMatrices, "animation");
	for (const node of nodes) {
		for (const accessor of Object.values(node.extensions?.EXT_mesh_gpu_instancing?.attributes ?? {})) tagAccessor(accessor, "geometry");
	}
	for (const image of images) if (image.bufferView !== undefined) viewCategory.set(image.bufferView, "textures");
	const bytesByCategory = { geometry: 0, "morph targets": 0, animation: 0, textures: 0, other: 0 };
	for (const [index, view] of (json.bufferViews ?? []).entries()) {
		// Meshopt views point at an uncompressed fallback buffer; the bytes on disk are the compressed ones.
		const meshopt = view.extensions?.EXT_meshopt_compression ?? view.extensions?.KHR_meshopt_compression;
		bytesByCategory[viewCategory.get(index) ?? "other"] += meshopt ? meshopt.byteLength : view.byteLength;
	}

	// Images and textures.
	const imageReports = [];
	for (const [index, image] of images.entries()) {
		const { bytes, size, external } = await readImage(asset, image);
		const info = imageInfo(bytes);
		const width = info?.width ?? 0;
		const height = info?.height ?? 0;
		const format = info?.format ?? image.mimeType?.replace("image/", "") ?? "unknown";
		const bytesPerPixel = format === "ktx2" ? 1 : 4;
		imageReports.push({
			index,
			name: image.name ?? image.uri ?? `image_${index}`,
			format,
			width,
			height,
			bytes: size,
			external,
			gpuBytes: Math.round(width * height * bytesPerPixel * (4 / 3)),
			powerOfTwo: width > 0 && (width & (width - 1)) === 0 && (height & (height - 1)) === 0,
			slots: new Set(),
		});
	}

	// Materials.
	const materialUsers = new Map();
	for (const mesh of meshes) {
		for (const primitive of mesh.primitives ?? []) {
			const key = primitive.material ?? -1;
			materialUsers.set(key, (materialUsers.get(key) ?? 0) + 1);
		}
	}
	const materialReports = materials.map((material, index) => {
		const pbr = material.pbrMetallicRoughness ?? {};
		const extensionNames = Object.keys(material.extensions ?? {});
		const textureRefs = materialTextures(material);
		for (const ref of textureRefs) {
			const imageIndex = textureImage(textures[ref.index] ?? {});
			imageReports[imageIndex]?.slots.add(ref.slot);
		}
		let workflow = "pbr";
		if (extensionNames.includes("KHR_materials_unlit")) workflow = "unlit";
		else if (extensionNames.includes("KHR_materials_pbrSpecularGlossiness")) workflow = "specular-glossiness";
		return {
			index,
			name: material.name ?? `material_${index}`,
			threeName: threeName(material.name ?? ""),
			workflow,
			threeClass: workflow === "unlit" ? "MeshBasicMaterial" : extensionNames.some((ext) => ext !== "KHR_texture_transform" && ext.startsWith("KHR_materials_")) ? "MeshPhysicalMaterial" : "MeshStandardMaterial",
			baseColor: pbr.baseColorFactor ?? [1, 1, 1, 1],
			metallic: pbr.metallicFactor ?? 1,
			roughness: pbr.roughnessFactor ?? 1,
			emissive: material.emissiveFactor ?? [0, 0, 0],
			alphaMode: material.alphaMode ?? "OPAQUE",
			alphaCutoff: material.alphaMode === "MASK" ? (material.alphaCutoff ?? 0.5) : undefined,
			doubleSided: Boolean(material.doubleSided),
			extensions: extensionNames,
			textures: textureRefs.map((ref) => ({ ...ref, image: textureImage(textures[ref.index] ?? {}) })),
			usedBy: materialUsers.get(index) ?? 0,
		};
	});
	for (const image of imageReports) {
		image.slots = [...image.slots];
		image.colorSpace = image.slots.length === 0 ? "unknown" : image.slots.every((slot) => COLOR_SLOTS.has(slot) || slot.endsWith("Color")) ? "srgb" : "linear";
	}

	// Scene graph, world bounds and per-node facts.
	const sceneIndex = json.scene ?? 0;
	const scene = json.scenes?.[sceneIndex];
	const roots = scene?.nodes ?? [];
	const jointNodes = new Set(skins.flatMap((skin) => skin.joints ?? []));
	const animatedNodes = new Set(animations.flatMap((animation) => (animation.channels ?? []).map((channel) => channel.target?.node)));
	const nameCounts = new Map();
	for (const node of nodes) if (node.name) nameCounts.set(threeName(node.name), (nameCounts.get(threeName(node.name)) ?? 0) + 1);

	const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
	let triangles = 0;
	let vertices = 0;
	let drawCalls = 0;
	let mirroredNodes = 0;
	const tree = [];
	const visited = new Set();
	const primitivesWithoutNormals = [];
	const texturedWithoutUv = [];

	/**
	 * Walks the node hierarchy, accumulating world bounds and stats.
	 * @param {number} nodeIndex
	 * @param {number[]} parentMatrix
	 * @param {number} depth
	 */
	function walk(nodeIndex, parentMatrix, depth) {
		if (visited.has(nodeIndex)) return;
		visited.add(nodeIndex);
		const node = nodes[nodeIndex];
		if (!node) return;
		const world = multiply(parentMatrix, localMatrix(node));
		if (node.mesh !== undefined && determinant3(world) < 0) mirroredNodes++;
		const entry = { index: nodeIndex, depth, name: node.name ?? "", threeName: node.name ? threeName(node.name) : "", tags: [] };

		const mesh = meshes[node.mesh];
		if (mesh) {
			const instances = accessors[node.extensions?.EXT_mesh_gpu_instancing?.attributes?.TRANSLATION]?.count ?? 1;
			let meshTriangles = 0;
			for (const primitive of mesh.primitives ?? []) {
				const counts = primitiveCounts(json, primitive);
				meshTriangles += counts.triangles;
				vertices += counts.vertices * instances;
				drawCalls++;
				if ((primitive.mode ?? 4) === 4 && !primitive.attributes?.NORMAL) primitivesWithoutNormals.push(mesh.name ?? `mesh_${node.mesh}`);
				const material = materials[primitive.material];
				if (material && materialTextures(material).length > 0 && !primitive.attributes?.TEXCOORD_0) texturedWithoutUv.push(mesh.name ?? `mesh_${node.mesh}`);
				const box = accessorBounds(accessors[primitive.attributes?.POSITION]);
				if (!box) continue;
				for (let corner = 0; corner < 8; corner++) {
					const local = [corner & 1 ? box.max[0] : box.min[0], corner & 2 ? box.max[1] : box.min[1], corner & 4 ? box.max[2] : box.min[2]];
					for (let axis = 0; axis < 3; axis++) {
						const value = world[axis] * local[0] + world[4 + axis] * local[1] + world[8 + axis] * local[2] + world[12 + axis];
						bounds.min[axis] = Math.min(bounds.min[axis], value);
						bounds.max[axis] = Math.max(bounds.max[axis], value);
					}
				}
			}
			triangles += meshTriangles * instances;
			const primitiveCount = mesh.primitives?.length ?? 0;
			const shape = primitiveCount > 1 ? `Group of ${primitiveCount} meshes` : "Mesh";
			entry.tags.push(`${node.skin !== undefined ? "Skinned" : ""}${shape} "${mesh.name ?? ""}" ${formatCount(meshTriangles)} tris`);
			if (instances > 1) entry.tags.push(`x${instances} instances`);
			const morphs = mesh.primitives?.[0]?.targets?.length ?? 0;
			if (morphs > 0) entry.tags.push(`${morphs} morph targets`);
			const materialNames = [...new Set((mesh.primitives ?? []).map((primitive) => materials[primitive.material]?.name ?? (primitive.material === undefined ? "(default)" : `material_${primitive.material}`)))];
			entry.tags.push(`mat: ${materialNames.join(", ")}`);
		}
		if (node.skin !== undefined) entry.tags.push(`skin ${node.skin}`);
		if (jointNodes.has(nodeIndex)) entry.tags.push("bone");
		if (node.camera !== undefined) entry.tags.push("camera");
		if (node.extensions?.KHR_lights_punctual) entry.tags.push(`light: ${json.extensions?.KHR_lights_punctual?.lights?.[node.extensions.KHR_lights_punctual.light]?.type ?? "?"}`);
		if (animatedNodes.has(nodeIndex)) entry.tags.push("animated");
		if (node.name && (nameCounts.get(threeName(node.name)) ?? 0) > 1) entry.tags.push("duplicate name");
		tree.push(entry);

		for (const child of node.children ?? []) walk(child, world, depth + 1);
	}
	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	for (const root of roots) walk(root, identity, 0);

	const hasBounds = Number.isFinite(bounds.min[0]);
	const size = hasBounds ? bounds.max.map((value, axis) => value - bounds.min[axis]) : [0, 0, 0];
	const center = hasBounds ? bounds.max.map((value, axis) => (value + bounds.min[axis]) / 2) : [0, 0, 0];

	// Animations.
	const animationReports = animations.map((animation, index) => {
		const channels = animation.channels ?? [];
		let duration = 0;
		for (const sampler of animation.samplers ?? []) duration = Math.max(duration, accessors[sampler.input]?.max?.[0] ?? 0);
		const targets = new Set(channels.map((channel) => channel.target?.node));
		return {
			index,
			name: animation.name ?? `animation_${index}`,
			duration: round(duration),
			channels: channels.length,
			paths: [...new Set(channels.map((channel) => channel.target?.path))],
			targetNodes: targets.size,
			targetsBones: [...targets].some((node) => jointNodes.has(node)),
		};
	});

	const skinReports = skins.map((skin, index) => ({
		index,
		name: skin.name ?? `skin_${index}`,
		joints: skin.joints?.length ?? 0,
		skeletonRoot: skin.skeleton !== undefined ? (nodes[skin.skeleton]?.name ?? `node_${skin.skeleton}`) : undefined,
	}));

	const morphReports = meshes
		.map((mesh, index) => ({
			mesh: mesh.name ?? `mesh_${index}`,
			targets: mesh.primitives?.[0]?.targets?.length ?? 0,
			names: mesh.extras?.targetNames ?? [],
		}))
		.filter((entry) => entry.targets > 0);

	const lights = json.extensions?.KHR_lights_punctual?.lights ?? [];
	const textureBytes = imageReports.reduce((sum, image) => sum + image.bytes, 0);
	const gpuTextureBytes = imageReports.reduce((sum, image) => sum + image.gpuBytes, 0);
	const totalBytes = asset.fileBytes + asset.externalBytes;

	const report = {
		file: path,
		container: asset.container,
		bytes: { file: asset.fileBytes, external: asset.externalBytes, total: totalBytes, ...bytesByCategory },
		generator: json.asset?.generator,
		version: json.asset?.version,
		extensionsUsed,
		extensionsRequired,
		decoders,
		unsupportedExtensions: unsupported,
		missingFiles: asset.missing,
		scene: {
			nodes: nodes.length,
			meshes: meshes.length,
			drawCalls,
			triangles: Math.round(triangles),
			vertices,
			materials: materials.length,
			textures: textures.length,
			lights: lights.length,
			cameras: json.cameras?.length ?? 0,
		},
		bounds: hasBounds ? { min: bounds.min.map((value) => round(value)), max: bounds.max.map((value) => round(value)), size: size.map((value) => round(value)), center: center.map((value) => round(value)) } : null,
		tree,
		materials: materialReports,
		images: imageReports,
		gpuTextureBytes,
		animations: animationReports,
		skins: skinReports,
		morphTargets: morphReports,
		warnings: [],
	};
	report.warnings = diagnose(report, { mirroredNodes, primitivesWithoutNormals, texturedWithoutUv, textureBytes });
	return report;
}

/**
 * Turns report facts into ranked, actionable warnings.
 * @param {any} report
 * @param {{ mirroredNodes: number, primitivesWithoutNormals: string[], texturedWithoutUv: string[], textureBytes: number }} facts
 * @returns {{ level: "error" | "warn" | "info", code: string, message: string }[]}
 */
function diagnose(report, facts) {
	const warnings = [];
	/**
	 * Adds one warning.
	 * @param {"error" | "warn" | "info"} level
	 * @param {string} code
	 * @param {string} message
	 */
	function add(level, code, message) {
		warnings.push({ level, code, message });
	}

	if (report.missingFiles.length > 0) add("error", "missing-files", `Referenced files not found next to the asset: ${report.missingFiles.join(", ")}. Loading will 404.`);
	const requiredUnsupported = report.unsupportedExtensions.filter((ext) => report.extensionsRequired.includes(ext));
	if (requiredUnsupported.length > 0) add("error", "unsupported-required", `GLTFLoader cannot load required extension(s) ${requiredUnsupported.join(", ")}. Convert the file (see threejs-model-fix).`);
	const optionalUnsupported = report.unsupportedExtensions.filter((ext) => !report.extensionsRequired.includes(ext));
	if (optionalUnsupported.includes("KHR_materials_pbrSpecularGlossiness")) {
		add("error", "spec-gloss", "Materials use KHR_materials_pbrSpecularGlossiness, which three.js dropped: colors render wrong. Run `npx @gltf-transform/cli metalrough in.glb out.glb`.");
	}
	const otherUnsupported = optionalUnsupported.filter((ext) => ext !== "KHR_materials_pbrSpecularGlossiness");
	if (otherUnsupported.length > 0) add("info", "ignored-extensions", `GLTFLoader ignores ${otherUnsupported.join(", ")}; the model still loads without those features.`);
	for (const decoder of report.decoders) add("info", "decoder", `Needs ${decoder.name}: ${decoder.wiring}. Without it, loading throws.`);

	if (report.bounds) {
		const largest = Math.max(...report.bounds.size);
		if (largest > 100) add("warn", "scale-large", `Largest dimension is ${round(largest, 1)} units. If the scene is in meters this was likely exported in centimeters: scale by 0.01, or frame the camera to the bounds.`);
		else if (largest > 0 && largest < 0.1) add("warn", "scale-small", `Largest dimension is ${round(largest, 4)} units: the model may be invisible at a default camera distance. Scale it up or frame the camera to the bounds.`);
		const [cx, , cz] = report.bounds.center;
		const horizontalOffset = Math.hypot(cx, cz);
		if (largest > 0 && horizontalOffset > largest) add("warn", "off-center", `Bounds center is ${round(horizontalOffset, 2)} units from the origin (more than its own size): the model sits outside the default view. Recenter it or target the camera at the center.`);
		if (largest > 0 && Math.abs(report.bounds.min[1]) > largest * 0.25) add("info", "not-grounded", `Lowest point is y=${report.bounds.min[1]}, not near 0: the model floats above or sinks below a ground plane.`);
	} else if (report.scene.meshes > 0) {
		add("info", "no-bounds", "POSITION accessors lack min/max, so bounds could not be computed; run `npx @gltf-transform/cli validate` on the file.");
	}

	const blackRisk = report.materials.filter((material) => material.workflow === "pbr" && material.metallic >= 0.9 && !material.textures.some((texture) => texture.slot === "metallicRoughness"));
	if (blackRisk.length > 0) add("warn", "metal-needs-env", `${blackRisk.length} material(s) are fully metallic (${blackRisk.slice(0, 4).map((material) => material.name).join(", ")}${blackRisk.length > 4 ? ", ..." : ""}); metals reflect their environment and render near-black without scene.environment.`);
	if (report.materials.length > 0 && report.materials.every((material) => material.workflow !== "unlit") && report.scene.lights === 0) {
		add("info", "needs-lighting", "No lights in the file and the materials are lit: add lights or an environment map (RoomEnvironment or an HDR) or the model renders black.");
	}
	if (facts.mirroredNodes > 0) add("warn", "mirrored", `${facts.mirroredNodes} mesh node(s) have a negative scale: faces may look inside-out. Apply transforms in the DCC tool or set material.side = THREE.DoubleSide to confirm.`);
	if (facts.primitivesWithoutNormals.length > 0) add("warn", "no-normals", `${facts.primitivesWithoutNormals.length} primitive(s) have no normals (${[...new Set(facts.primitivesWithoutNormals)].slice(0, 3).join(", ")}): GLTFLoader falls back to flat shading.`);
	if (facts.texturedWithoutUv.length > 0) add("warn", "no-uv", `Textured primitive(s) without TEXCOORD_0 (${[...new Set(facts.texturedWithoutUv)].slice(0, 3).join(", ")}): textures will not map.`);
	const blended = report.materials.filter((material) => material.alphaMode === "BLEND");
	if (blended.length > 3) add("info", "many-blend", `${blended.length} materials use alphaMode BLEND: expect sorting artifacts. Prefer MASK for cutouts.`);

	const largeImages = report.images.filter((image) => Math.max(image.width, image.height) > 2048);
	if (largeImages.length > 0) add("warn", "large-textures", `${largeImages.length} texture(s) exceed 2048 px (largest ${Math.max(...largeImages.map((image) => Math.max(image.width, image.height)))} px). Resize with threejs-model-optimize.`);
	if (report.gpuTextureBytes > 256 * 1024 * 1024) add("warn", "gpu-memory", `Textures need about ${formatBytes(report.gpuTextureBytes)} of GPU memory uncompressed: risky on mobile. Use KTX2 or smaller textures.`);
	const nonPot = report.images.filter((image) => image.width > 0 && !image.powerOfTwo);
	if (nonPot.length > 0) add("info", "non-power-of-two", `${nonPot.length} texture(s) are not power-of-two sizes; KTX2 compression will resize them.`);
	if (report.bytes.total > 20 * 1024 * 1024) add("warn", "file-size", `Total download is ${formatBytes(report.bytes.total)}. Optimize before shipping to the web.`);
	if (report.scene.triangles > 1_000_000) add("warn", "triangles", `${formatCount(report.scene.triangles)} triangles: heavy for mobile. Simplify or use LODs.`);
	if (report.scene.drawCalls > 300) add("warn", "draw-calls", `${report.scene.drawCalls} draw calls: CPU-bound on mobile. Join or instance meshes (threejs-model-optimize).`);
	const duplicates = report.tree.filter((entry) => entry.tags.includes("duplicate name"));
	if (duplicates.length > 0) add("info", "duplicate-names", `${new Set(duplicates.map((entry) => entry.threeName)).size} node name(s) repeat; three.js appends _1, _2 in load order, so getObjectByName may return the wrong one.`);
	if (report.skins.length > 0 && report.animations.length === 0) add("info", "rig-no-clips", "Rigged but no animation clips: load clips from another file (Mixamo) and retarget (threejs-model-animate).");
	if (!report.generator) add("info", "no-generator", "No asset.generator: the exporter is unknown.");

	const order = { error: 0, warn: 1, info: 2 };
	return warnings.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * Formats a vector for display.
 * @param {number[]} vector
 * @returns {string}
 */
function vec(vector) {
	return `[${vector.map((value) => round(value)).join(", ")}]`;
}

/**
 * Renders the report as plain text.
 * @param {any} report
 * @param {{ maxNodes: number }} options
 * @returns {string}
 */
export function formatReport(report, options) {
	const lines = [];
	const push = (line = "") => lines.push(line);
	const { bytes, scene } = report;

	push(`# ${report.file}`);
	push(`${report.container.toUpperCase()} glTF ${report.version ?? "?"} - generator: ${report.generator ?? "unknown"}`);
	push(
		`Size: ${formatBytes(bytes.total)}${bytes.external ? ` (${formatBytes(bytes.file)} + ${formatBytes(bytes.external)} external)` : ""} - geometry ${formatBytes(bytes.geometry)}, textures ${formatBytes(bytes.textures)}, animation ${formatBytes(bytes.animation)}${bytes["morph targets"] ? `, morph targets ${formatBytes(bytes["morph targets"])}` : ""}`,
	);
	push(
		`Scene: ${scene.nodes} nodes, ${scene.meshes} meshes, ${scene.drawCalls} draw calls, ${formatCount(scene.triangles)} triangles, ${formatCount(scene.vertices)} vertices, ${scene.materials} materials, ${scene.textures} textures, ${scene.lights} lights, ${scene.cameras} cameras`,
	);
	if (report.bounds) push(`Bounds: size ${vec(report.bounds.size)}, center ${vec(report.bounds.center)}, min ${vec(report.bounds.min)}, max ${vec(report.bounds.max)}`);
	push(`Extensions used: ${report.extensionsUsed.join(", ") || "none"}${report.extensionsRequired.length ? ` (required: ${report.extensionsRequired.join(", ")})` : ""}`);
	push(`Decoders: ${report.decoders.map((decoder) => decoder.name).join(", ") || "none needed"}`);

	if (report.warnings.length > 0) {
		push();
		push("## Findings");
		for (const warning of report.warnings) push(`- [${warning.level}] ${warning.code}: ${warning.message}`);
	}

	push();
	push("## Node tree (three.js names)");
	for (const entry of report.tree.slice(0, options.maxNodes)) {
		const label = entry.threeName || `(unnamed #${entry.index})`;
		push(`${"  ".repeat(entry.depth)}- ${label}${entry.tags.length ? `  [${entry.tags.join("; ")}]` : ""}`);
	}
	if (report.tree.length > options.maxNodes) push(`  ... ${report.tree.length - options.maxNodes} more nodes (--max-nodes to show)`);

	if (report.materials.length > 0) {
		push();
		push("## Materials");
		for (const material of report.materials) {
			const color = material.baseColor.map((value) => round(value, 2)).join(", ");
			const extras = [
				material.workflow !== "pbr" ? material.workflow : null,
				material.alphaMode !== "OPAQUE" ? `${material.alphaMode}${material.alphaCutoff !== undefined ? ` ${material.alphaCutoff}` : ""}` : null,
				material.doubleSided ? "doubleSided" : null,
				material.emissive.some((value) => value > 0) ? `emissive [${material.emissive.map((value) => round(value, 2)).join(", ")}]` : null,
				...material.extensions.filter((ext) => ext !== "KHR_materials_unlit").map((ext) => ext.replace(/^KHR_materials_/, "")),
			].filter(Boolean);
			push(`- ${material.name} -> ${material.threeClass}, used by ${material.usedBy} primitive(s); color [${color}], metalness ${material.metallic}, roughness ${material.roughness}${extras.length ? `; ${extras.join(", ")}` : ""}`);
			if (material.textures.length > 0) push(`  maps: ${material.textures.map((texture) => `${texture.slot}${texture.texCoord ? `(uv${texture.texCoord})` : ""}${texture.transform ? "(transform)" : ""}`).join(", ")}`);
		}
	}

	if (report.images.length > 0) {
		push();
		push(`## Textures (about ${formatBytes(report.gpuTextureBytes)} GPU memory with mipmaps)`);
		for (const image of report.images) {
			push(`- ${image.name}: ${image.format} ${image.width}x${image.height}, ${formatBytes(image.bytes)}${image.external ? " (external)" : ""}, ${image.colorSpace}, used as ${image.slots.join(", ") || "nothing"}`);
		}
	}

	if (report.animations.length > 0) {
		push();
		push("## Animations");
		for (const animation of report.animations) {
			push(`- "${animation.name}" ${animation.duration}s, ${animation.channels} channels on ${animation.targetNodes} nodes (${animation.paths.join(", ")})${animation.targetsBones ? ", skeletal" : ""}`);
		}
	}
	if (report.skins.length > 0) {
		push();
		push("## Skins");
		for (const skin of report.skins) push(`- ${skin.name}: ${skin.joints} joints${skin.skeletonRoot ? `, root ${skin.skeletonRoot}` : ""}`);
	}
	if (report.morphTargets.length > 0) {
		push();
		push("## Morph targets");
		for (const morph of report.morphTargets) push(`- ${morph.mesh}: ${morph.targets} targets${morph.names.length ? ` (${morph.names.join(", ")})` : ""}`);
	}
	return lines.join("\n");
}

/**
 * Parses arguments and prints the report.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
	const args = argv.slice(2);
	if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
		console.log("Usage: node inspect.mjs <model.glb|model.gltf> [--json] [--max-nodes N]");
		return args.length === 0 ? 1 : 0;
	}
	const json = args.includes("--json");
	const maxIndex = args.indexOf("--max-nodes");
	const maxNodes = maxIndex >= 0 ? Number(args[maxIndex + 1]) : 60;
	const file = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--max-nodes");
	if (!file) {
		console.error("No model path given.");
		return 1;
	}
	try {
		await stat(file);
	} catch {
		console.error(`File not found: ${file}`);
		return 1;
	}
	const report = await inspect(file);
	console.log(json ? JSON.stringify(report, null, "\t") : formatReport(report, { maxNodes }));
	return report.warnings.some((warning) => warning.level === "error") ? 2 : 0;
}

// Compare real paths so the script also runs when invoked through a symlinked skill directory.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	process.exitCode = await main(process.argv);
}
