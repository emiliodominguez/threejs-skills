import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Document, NodeIO } from "@gltf-transform/core";

import { inspect } from "../skills/threejs-model-inspect/scripts/inspect.mjs";

const SCRIPT = new URL("../skills/threejs-model-inspect/scripts/inspect.mjs", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "threejs-skills-"));

/**
 * Writes a glTF document as a GLB fixture and returns its path.
 * @param {string} name
 * @param {(doc: Document) => void} build
 * @returns {Promise<string>}
 */
async function fixture(name, build) {
	const doc = new Document();
	doc.createBuffer();
	build(doc);
	const path = join(dir, `${name}.glb`);
	writeFileSync(path, await new NodeIO().writeBinary(doc));
	return path;
}

/**
 * Creates a triangle primitive with the given extent.
 * @param {Document} doc
 * @param {number} size
 * @param {{ normals?: boolean, uv?: boolean }} [options]
 * @returns {import("@gltf-transform/core").Primitive}
 */
function triangle(doc, size, options = {}) {
	const buffer = doc.getRoot().listBuffers()[0];
	const position = doc
		.createAccessor()
		.setType("VEC3")
		.setBuffer(buffer)
		.setArray(new Float32Array([0, 0, 0, size, 0, 0, 0, size, 0]));
	const primitive = doc.createPrimitive().setAttribute("POSITION", position);
	if (options.normals)
		primitive.setAttribute(
			"NORMAL",
			doc
				.createAccessor()
				.setType("VEC3")
				.setBuffer(buffer)
				.setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])),
		);
	if (options.uv)
		primitive.setAttribute(
			"TEXCOORD_0",
			doc
				.createAccessor()
				.setType("VEC2")
				.setBuffer(buffer)
				.setArray(new Float32Array([0, 0, 1, 0, 0, 1])),
		);
	return primitive;
}

/**
 * Returns the warning codes in a report.
 * @param {any} report
 * @returns {string[]}
 */
function codes(report) {
	return report.warnings.map((warning) => warning.code);
}

test("flags centimeter scale, mirroring, missing normals and unlit-looking metals", async () => {
	const path = await fixture("cm-mirrored", (doc) => {
		const material = doc.createMaterial("Paint"); // metallicFactor defaults to 1
		const mesh = doc.createMesh("Body").addPrimitive(triangle(doc, 200).setMaterial(material));
		doc.createScene().addChild(doc.createNode("Body Paint").setMesh(mesh).setScale([-1, 1, 1]));
	});
	const report = await inspect(path);
	assert.deepEqual(report.bounds.size, [200, 200, 0]);
	assert.equal(report.tree[0].threeName, "Body_Paint");
	assert.equal(report.scene.triangles, 1);
	for (const code of ["scale-large", "mirrored", "no-normals", "metal-needs-env", "needs-lighting"]) assert.ok(codes(report).includes(code), code);
});

test("describes multi-material meshes as groups and flags duplicate names", async () => {
	const path = await fixture("groups", (doc) => {
		const mesh = doc
			.createMesh("Wheel")
			.addPrimitive(triangle(doc, 1, { normals: true }).setMaterial(doc.createMaterial("Rubber").setMetallicFactor(0)))
			.addPrimitive(triangle(doc, 1, { normals: true }).setMaterial(doc.createMaterial("Rim").setMetallicFactor(0)));
		const scene = doc.createScene();
		scene.addChild(doc.createNode("Wheel.001").setMesh(mesh));
		scene.addChild(doc.createNode("Wheel.001").setMesh(mesh).setTranslation([2, 0, 0]));
	});
	const report = await inspect(path);
	assert.equal(report.scene.drawCalls, 4);
	assert.equal(report.scene.triangles, 4);
	assert.equal(report.tree[0].threeName, "Wheel001");
	assert.ok(report.tree[0].tags.some((tag) => tag.startsWith('Group of 2 meshes "Wheel"')));
	assert.ok(report.tree[0].tags.includes("duplicate name"));
	assert.ok(codes(report).includes("duplicate-names"));
	assert.ok(!codes(report).includes("metal-needs-env"));
});

test("reports clip names, durations and animated paths", async () => {
	const path = await fixture("animated", (doc) => {
		const buffer = doc.getRoot().listBuffers()[0];
		const node = doc.createNode("Door").setMesh(doc.createMesh("Door").addPrimitive(triangle(doc, 1, { normals: true })));
		doc.createScene().addChild(node);
		const input = doc
			.createAccessor()
			.setType("SCALAR")
			.setBuffer(buffer)
			.setArray(new Float32Array([0, 2.5]));
		const output = doc
			.createAccessor()
			.setType("VEC3")
			.setBuffer(buffer)
			.setArray(new Float32Array([0, 0, 0, 1, 0, 0]));
		const sampler = doc.createAnimationSampler().setInput(input).setOutput(output);
		const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath("translation").setSampler(sampler);
		doc.createAnimation("Open").addSampler(sampler).addChannel(channel);
	});
	const report = await inspect(path);
	assert.deepEqual(
		report.animations.map(({ name, duration, paths, targetsBones }) => ({ name, duration, paths, targetsBones })),
		[{ name: "Open", duration: 2.5, paths: ["translation"], targetsBones: false }],
	);
	assert.ok(report.tree[0].tags.includes("animated"));
});

test("reads embedded PNG dimensions and color space from the slot", async () => {
	const png = Buffer.alloc(33);
	png.writeUInt32BE(0x89504e47, 0);
	png.writeUInt32BE(0x0d0a1a0a, 4);
	png.writeUInt32BE(13, 8);
	png.write("IHDR", 12, "ascii");
	png.writeUInt32BE(4096, 16);
	png.writeUInt32BE(1000, 20);
	const path = await fixture("textured", (doc) => {
		const texture = doc.createTexture("albedo").setImage(new Uint8Array(png)).setMimeType("image/png");
		const material = doc.createMaterial("Fabric").setMetallicFactor(0).setBaseColorTexture(texture);
		doc.createScene().addChild(
			doc.createNode("Seat").setMesh(doc.createMesh("Seat").addPrimitive(triangle(doc, 1, { normals: true }).setMaterial(material))),
		);
	});
	const report = await inspect(path);
	assert.deepEqual(
		report.images.map(({ format, width, height, colorSpace, slots, powerOfTwo }) => ({ format, width, height, colorSpace, slots, powerOfTwo })),
		[{ format: "png", width: 4096, height: 1000, colorSpace: "srgb", slots: ["baseColor"], powerOfTwo: false }],
	);
	for (const code of ["no-uv", "large-textures", "non-power-of-two"]) assert.ok(codes(report).includes(code), code);
});

test("lists required decoders and dropped extensions from a .gltf", async () => {
	const path = join(dir, "draco.gltf");
	writeFileSync(
		path,
		JSON.stringify({
			asset: { version: "2.0", generator: "test" },
			extensionsUsed: ["KHR_draco_mesh_compression", "KHR_materials_pbrSpecularGlossiness"],
			extensionsRequired: ["KHR_draco_mesh_compression"],
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [{ name: "Avocado", mesh: 0 }],
			meshes: [
				{
					name: "Avocado",
					primitives: [
						{
							attributes: { POSITION: 0 },
							material: 0,
							extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } },
						},
					],
				},
			],
			materials: [{ name: "Skin", extensions: { KHR_materials_pbrSpecularGlossiness: {} } }],
			accessors: [{ componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 1] }],
			bufferViews: [{ buffer: 0, byteLength: 12 }],
			buffers: [{ byteLength: 12, uri: "data:application/octet-stream;base64,AAAAAAAAAAAAAAAA" }],
		}),
	);
	const report = await inspect(path);
	assert.deepEqual(
		report.decoders.map((decoder) => decoder.name),
		["DRACOLoader"],
	);
	assert.equal(report.materials[0].workflow, "specular-glossiness");
	assert.ok(codes(report).includes("spec-gloss"));
});

test("exits 2 when referenced files are missing", () => {
	const path = join(dir, "missing.gltf");
	writeFileSync(path, JSON.stringify({ asset: { version: "2.0" }, buffers: [{ byteLength: 4, uri: "gone.bin" }], scenes: [{ nodes: [] }] }));
	const run = spawnSync(process.execPath, [SCRIPT, path], { encoding: "utf8" });
	assert.equal(run.status, 2);
	assert.match(run.stdout, /missing-files: .*gone\.bin/);
});

test("prints usage and fails without arguments", () => {
	const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
	assert.equal(run.status, 1);
	assert.match(run.stdout, /Usage/);
});
