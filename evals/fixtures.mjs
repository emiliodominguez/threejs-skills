#!/usr/bin/env node
// Builds the broken-model collection: small glTF files, each reproducing one real-world failure.
// They back three things: inspect tests (each fixture must produce its expected finding), the
// agent evals in evals/tasks.json, and documentation examples.
//
//   node evals/fixtures.mjs [outDir]     # default: evals/fixtures/

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

import { Document, NodeIO } from "@gltf-transform/core";

/**
 * Encodes a solid-color RGB PNG. Large sizes compress to a few KB.
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number]} rgb
 * @returns {Uint8Array}
 */
export function solidPng(width, height, rgb) {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	/**
	 * Computes a PNG chunk CRC.
	 * @param {Buffer} bytes
	 * @returns {number}
	 */
	function crc(bytes) {
		let c = 0xffffffff;
		for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	}
	/**
	 * Builds one PNG chunk.
	 * @param {string} type
	 * @param {Buffer} data
	 * @returns {Buffer}
	 */
	function chunk(type, data) {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([length, body, sum]);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 2; // RGB
	const row = Buffer.alloc(1 + width * 3);
	for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
	const raw = Buffer.concat(Array.from({ length: height }, () => row));
	return new Uint8Array(
		Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			chunk("IHDR", header),
			chunk("IDAT", deflateSync(raw)),
			chunk("IEND", Buffer.alloc(0)),
		]),
	);
}

/**
 * Adds a box primitive (24 vertices with normals and UVs) to a document.
 * @param {Document} doc
 * @param {[number, number, number]} size
 * @param {{ normals?: boolean, offset?: [number, number, number] }} [options]
 * @returns {import("@gltf-transform/core").Primitive}
 */
export function box(doc, size, options = {}) {
	const buffer = doc.getRoot().listBuffers()[0];
	const [sx, sy, sz] = size.map((value) => value / 2);
	const [ox, oy, oz] = options.offset ?? [0, 0, 0];
	const faces = [
		[
			[1, 0, 0],
			[0, 0, -1],
			[0, 1, 0],
		],
		[
			[-1, 0, 0],
			[0, 0, 1],
			[0, 1, 0],
		],
		[
			[0, 1, 0],
			[1, 0, 0],
			[0, 0, -1],
		],
		[
			[0, -1, 0],
			[1, 0, 0],
			[0, 0, 1],
		],
		[
			[0, 0, 1],
			[1, 0, 0],
			[0, 1, 0],
		],
		[
			[0, 0, -1],
			[-1, 0, 0],
			[0, 1, 0],
		],
	];
	const positions = [];
	const normals = [];
	const uvs = [];
	const indices = [];
	for (const [normal, u, v] of faces) {
		const base = positions.length / 3;
		for (const [a, b] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		]) {
			for (let axis = 0; axis < 3; axis++) {
				const extent = [sx, sy, sz][axis];
				positions.push((normal[axis] + a * u[axis] + b * v[axis]) * extent + [ox, oy, oz][axis]);
			}
			normals.push(...normal);
			uvs.push((a + 1) / 2, (1 - b) / 2);
		}
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	const primitive = doc
		.createPrimitive()
		.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array(positions)))
		.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setBuffer(buffer).setArray(new Float32Array(uvs)))
		.setIndices(doc.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(new Uint16Array(indices)));
	if (options.normals !== false)
		primitive.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array(normals)));
	return primitive;
}

/**
 * Creates an empty document with one buffer and a scene.
 * @returns {{ doc: Document, scene: import("@gltf-transform/core").Scene }}
 */
function start() {
	const doc = new Document();
	doc.createBuffer();
	doc.getRoot().getAsset().generator = "threejs-skills broken-model fixtures";
	return { doc, scene: doc.createScene("Scene") };
}

/**
 * Each fixture: what is broken, which inspect findings it must produce, and how it is built.
 * @type {Record<string, { broken: string, expect: string[], build: () => Document | object }>}
 */
export const FIXTURES = {
	"metal-black": {
		broken: "Product model with the glTF default metallicFactor 1 and no texture: renders black without an environment map.",
		expect: ["metal-needs-env", "needs-lighting"],
		build() {
			const { doc, scene } = start();
			const material = doc.createMaterial("Brushed Steel").setBaseColorFactor([0.8, 0.8, 0.82, 1]).setRoughnessFactor(0.35);
			scene.addChild(
				doc.createNode("Speaker").setMesh(doc.createMesh("Speaker").addPrimitive(box(doc, [0.2, 0.3, 0.2]).setMaterial(material))),
			);
			return doc;
		},
	},
	centimeters: {
		broken: "Exported in centimeters: 180 units tall, invisible or clipped at a default camera.",
		expect: ["scale-large"],
		build() {
			const { doc, scene } = start();
			const material = doc.createMaterial("Wood").setBaseColorFactor([0.55, 0.35, 0.2, 1]).setMetallicFactor(0);
			scene.addChild(
				doc
					.createNode("Wardrobe")
					.setMesh(doc.createMesh("Wardrobe").addPrimitive(box(doc, [100, 180, 60], { offset: [0, 90, 0] }).setMaterial(material))),
			);
			return doc;
		},
	},
	"off-center": {
		broken: "Pivot far from the geometry: the model sits 40 units off origin, outside the default view.",
		expect: ["off-center"],
		build() {
			const { doc, scene } = start();
			const material = doc.createMaterial("Ceramic").setBaseColorFactor([0.9, 0.9, 0.85, 1]).setMetallicFactor(0);
			scene.addChild(
				doc
					.createNode("Vase")
					.setMesh(doc.createMesh("Vase").addPrimitive(box(doc, [0.3, 0.5, 0.3], { offset: [40, 0.25, -25] }).setMaterial(material))),
			);
			return doc;
		},
	},
	mirrored: {
		broken: "Negative scale from a mirrored export: single-sided faces render inside-out.",
		expect: ["mirrored"],
		build() {
			const { doc, scene } = start();
			const material = doc.createMaterial("Plastic").setBaseColorFactor([0.2, 0.5, 0.9, 1]).setMetallicFactor(0);
			scene.addChild(
				doc
					.createNode("Chair_L")
					.setScale([-1, 1, 1])
					.setMesh(doc.createMesh("Chair").addPrimitive(box(doc, [0.5, 0.9, 0.5]).setMaterial(material))),
			);
			return doc;
		},
	},
	"no-normals": {
		broken: "Normals stripped on export: GLTFLoader falls back to flat shading.",
		expect: ["no-normals"],
		build() {
			const { doc, scene } = start();
			const material = doc.createMaterial("Clay").setBaseColorFactor([0.8, 0.5, 0.4, 1]).setMetallicFactor(0);
			scene.addChild(
				doc
					.createNode("Pot")
					.setMesh(doc.createMesh("Pot").addPrimitive(box(doc, [0.4, 0.4, 0.4], { normals: false }).setMaterial(material))),
			);
			return doc;
		},
	},
	"huge-textures": {
		broken: "8192 px textures on a small prop: about 340 MB of GPU memory.",
		expect: ["large-textures", "gpu-memory"],
		build() {
			const { doc, scene } = start();
			const textures = ["base", "normal", "orm"].map((name) =>
				doc
					.createTexture(name)
					.setImage(solidPng(8192, 8192, [180, 120, 90]))
					.setMimeType("image/png"),
			);
			const material = doc
				.createMaterial("Leather")
				.setMetallicFactor(0)
				.setBaseColorTexture(textures[0])
				.setNormalTexture(textures[1])
				.setMetallicRoughnessTexture(textures[2]);
			scene.addChild(
				doc.createNode("Wallet").setMesh(doc.createMesh("Wallet").addPrimitive(box(doc, [0.1, 0.02, 0.08]).setMaterial(material))),
			);
			return doc;
		},
	},
	configurator: {
		broken: "Not broken: a product whose parts share one material and have names with spaces and dots, which trip naive per-part code.",
		expect: ["duplicate-names"],
		build() {
			const { doc, scene } = start();
			const paint = doc.createMaterial("Paint").setBaseColorFactor([0.7, 0.1, 0.1, 1]).setMetallicFactor(0.3).setRoughnessFactor(0.4);
			const chrome = doc.createMaterial("Chrome").setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(1).setRoughnessFactor(0.1);
			const root = doc.createNode("Scooter");
			scene.addChild(root);
			root.addChild(
				doc
					.createNode("Body Paint")
					.setMesh(doc.createMesh("Body").addPrimitive(box(doc, [1, 0.3, 0.4], { offset: [0, 0.5, 0] }).setMaterial(paint))),
			);
			root.addChild(
				doc
					.createNode("Fender.001")
					.setMesh(doc.createMesh("Fender").addPrimitive(box(doc, [0.3, 0.1, 0.35], { offset: [0.45, 0.35, 0] }).setMaterial(paint))),
			);
			root.addChild(
				doc
					.createNode("Handlebar")
					.setMesh(doc.createMesh("Handlebar").addPrimitive(box(doc, [0.05, 0.05, 0.6], { offset: [0.4, 0.9, 0] }).setMaterial(chrome))),
			);
			for (const x of [-0.4, 0.4]) {
				root.addChild(
					doc
						.createNode("Wheel")
						.setMesh(doc.createMesh("Wheel").addPrimitive(box(doc, [0.3, 0.3, 0.1], { offset: [x, 0.15, 0] }).setMaterial(chrome))),
				);
			}
			return doc;
		},
	},
	"clip-names": {
		broken: "Animated model whose clips arrived from an FBX conversion as 'Armature|mixamo.com|Layer0' style names.",
		expect: [],
		build() {
			const { doc, scene } = start();
			const buffer = doc.getRoot().listBuffers()[0];
			const material = doc.createMaterial("Skin").setBaseColorFactor([0.9, 0.7, 0.6, 1]).setMetallicFactor(0);
			const node = doc
				.createNode("Robot")
				.setMesh(doc.createMesh("Robot").addPrimitive(box(doc, [0.5, 1, 0.3], { offset: [0, 0.5, 0] }).setMaterial(material)));
			scene.addChild(node);
			const clips = { "Armature|mixamo.com|Layer0": [0, 0.2], "Armature|Idle": [0, 0.05], "Armature|Wave": [0, 0.5] };
			for (const [name, [from, to]] of Object.entries(clips)) {
				const input = doc
					.createAccessor()
					.setType("SCALAR")
					.setBuffer(buffer)
					.setArray(new Float32Array([0, 1]));
				const output = doc
					.createAccessor()
					.setType("VEC3")
					.setBuffer(buffer)
					.setArray(new Float32Array([0, from, 0, 0, to, 0]));
				const sampler = doc.createAnimationSampler().setInput(input).setOutput(output);
				doc.createAnimation(name)
					.addSampler(sampler)
					.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath("translation").setSampler(sampler));
			}
			return doc;
		},
	},
	"spec-gloss": {
		broken: "Old specular-glossiness material extension that three.js dropped: colors render wrong.",
		expect: ["spec-gloss"],
		build() {
			return {
				asset: { version: "2.0", generator: "threejs-skills broken-model fixtures" },
				extensionsUsed: ["KHR_materials_pbrSpecularGlossiness"],
				scene: 0,
				scenes: [{ nodes: [0] }],
				nodes: [{ name: "Lamp", mesh: 0 }],
				meshes: [{ name: "Lamp", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
				materials: [
					{
						name: "Brass",
						extensions: {
							KHR_materials_pbrSpecularGlossiness: {
								diffuseFactor: [0.6, 0.45, 0.2, 1],
								specularFactor: [0.9, 0.8, 0.5],
								glossinessFactor: 0.7,
							},
						},
					},
				],
				accessors: [
					{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [0.3, 0.3, 0] },
					{ bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
				],
				bufferViews: [
					{ buffer: 0, byteOffset: 0, byteLength: 36 },
					{ buffer: 0, byteOffset: 36, byteLength: 36 },
				],
				buffers: [
					{
						byteLength: 72,
						uri: `data:application/octet-stream;base64,${Buffer.from(new Float32Array([0, 0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer).toString("base64")}`,
					},
				],
			};
		},
	},
	kit: {
		broken: "Not broken: an asset kit (five props each modeled at the origin, picked by name), where whole-file bounds and grounding mislead.",
		expect: ["kit", "kit-not-grounded"],
		build() {
			const { doc, scene } = start();
			const material = doc.createMaterial("Wood").setBaseColorFactor([0.6, 0.45, 0.3, 1]).setMetallicFactor(0);
			const props = { crate: [0.5, 0.5, 0.5], barrel: [0.4, 0.6, 0.4], lamp: [0.15, 1.6, 0.15], bench: [1.2, 0.45, 0.4] };
			for (const [name, size] of Object.entries(props)) {
				scene.addChild(
					doc
						.createNode(name)
						.setMesh(doc.createMesh(name).addPrimitive(box(doc, size, { offset: [0, size[1] / 2, 0] }).setMaterial(material))),
				);
			}
			// A hanging sign sits above the ground on purpose; the kit report should list it.
			scene.addChild(
				doc
					.createNode("sign")
					.setMesh(doc.createMesh("sign").addPrimitive(box(doc, [0.6, 0.3, 0.05], { offset: [0, 2, 0] }).setMaterial(material))),
			);
			return doc;
		},
	},
	variants: {
		broken: "Not broken: a shoe with KHR_materials_variants (Classic, Red, Midnight), which GLTFLoader keeps but does not apply.",
		expect: ["ignored-extensions"],
		build() {
			const positions = [0, 0, 0, 0.3, 0, 0, 0.3, 0.12, 0, 0, 0.12, 0];
			const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
			const bytes = Buffer.concat([
				Buffer.from(new Float32Array(positions).buffer),
				Buffer.from(new Float32Array(normals).buffer),
				Buffer.from(new Uint16Array([0, 1, 2, 0, 2, 3]).buffer),
			]);
			return {
				asset: { version: "2.0", generator: "threejs-skills broken-model fixtures" },
				extensionsUsed: ["KHR_materials_variants"],
				extensions: { KHR_materials_variants: { variants: [{ name: "Classic" }, { name: "Red" }, { name: "Midnight" }] } },
				scene: 0,
				scenes: [{ nodes: [0] }],
				nodes: [{ name: "Shoe", mesh: 0 }],
				meshes: [
					{
						name: "Shoe",
						primitives: [
							{
								attributes: { POSITION: 0, NORMAL: 1 },
								indices: 2,
								material: 0,
								extensions: {
									KHR_materials_variants: {
										mappings: [
											{ material: 0, variants: [0] },
											{ material: 1, variants: [1] },
											{ material: 2, variants: [2] },
										],
									},
								},
							},
						],
					},
				],
				materials: [
					{
						name: "Leather_Classic",
						pbrMetallicRoughness: { baseColorFactor: [0.45, 0.3, 0.18, 1], metallicFactor: 0, roughnessFactor: 0.6 },
						doubleSided: true,
					},
					{
						name: "Leather_Red",
						pbrMetallicRoughness: { baseColorFactor: [0.7, 0.05, 0.05, 1], metallicFactor: 0, roughnessFactor: 0.6 },
						doubleSided: true,
					},
					{
						name: "Leather_Midnight",
						pbrMetallicRoughness: { baseColorFactor: [0.03, 0.04, 0.12, 1], metallicFactor: 0, roughnessFactor: 0.6 },
						doubleSided: true,
					},
				],
				accessors: [
					{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [0, 0, 0], max: [0.3, 0.12, 0] },
					{ bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
					{ bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
				],
				bufferViews: [
					{ buffer: 0, byteOffset: 0, byteLength: 48 },
					{ buffer: 0, byteOffset: 48, byteLength: 48 },
					{ buffer: 0, byteOffset: 96, byteLength: 12 },
				],
				buffers: [{ byteLength: 108, uri: `data:application/octet-stream;base64,${bytes.toString("base64")}` }],
			};
		},
	},
	"missing-texture": {
		broken: "A .gltf deployed without its texture file: the texture 404s and the model renders white.",
		expect: ["missing-files"],
		build() {
			return {
				asset: { version: "2.0", generator: "threejs-skills broken-model fixtures" },
				scene: 0,
				scenes: [{ nodes: [0] }],
				nodes: [{ name: "Poster", mesh: 0 }],
				meshes: [{ name: "Poster", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0 }] }],
				materials: [{ name: "Print", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
				textures: [{ source: 0 }],
				images: [{ uri: "textures/poster.jpg" }],
				accessors: [
					{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
					{ bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
					{ bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
				],
				bufferViews: [
					{ buffer: 0, byteOffset: 0, byteLength: 36 },
					{ buffer: 0, byteOffset: 36, byteLength: 36 },
					{ buffer: 0, byteOffset: 72, byteLength: 24 },
				],
				buffers: [
					{
						byteLength: 96,
						uri: `data:application/octet-stream;base64,${Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0]).buffer).toString("base64")}`,
					},
				],
			};
		},
	},
};

/**
 * Writes every fixture to a directory and returns their paths.
 * @param {string} outDir
 * @returns {Promise<Record<string, string>>}
 */
export async function buildFixtures(outDir) {
	mkdirSync(outDir, { recursive: true });
	const io = new NodeIO();
	const paths = {};
	for (const [name, fixture] of Object.entries(FIXTURES)) {
		const result = fixture.build();
		if (result instanceof Document) {
			paths[name] = join(outDir, `${name}.glb`);
			writeFileSync(paths[name], await io.writeBinary(result));
		} else {
			paths[name] = join(outDir, `${name}.gltf`);
			writeFileSync(paths[name], JSON.stringify(result, null, "\t"));
		}
	}
	return paths;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const outDir = resolve(process.argv[2] ?? new URL("./fixtures", import.meta.url).pathname);
	const paths = await buildFixtures(outDir);
	for (const [name, path] of Object.entries(paths)) console.log(`${name.padEnd(16)} ${path}`);
}
