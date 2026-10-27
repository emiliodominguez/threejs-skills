import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Document, NodeIO } from "@gltf-transform/core";

import { findBrowser } from "../skills/threejs-model-inspect/scripts/render.mjs";

const SCRIPT = new URL("../skills/threejs-model-inspect/scripts/render.mjs", import.meta.url).pathname;
const browser = findBrowser();
const dir = mkdtempSync(join(tmpdir(), "threejs-render-test-"));

/**
 * Writes a GLB with one box-ish quad of the given size and color.
 * @param {string} name
 * @param {number} size
 * @param {[number, number, number, number]} color
 * @returns {Promise<string>}
 */
async function quad(name, size, color) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const s = size / 2;
	const position = doc
		.createAccessor()
		.setType("VEC3")
		.setBuffer(buffer)
		.setArray(new Float32Array([-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0]));
	const normal = doc
		.createAccessor()
		.setType("VEC3")
		.setBuffer(buffer)
		.setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]));
	const indices = doc
		.createAccessor()
		.setType("SCALAR")
		.setBuffer(buffer)
		.setArray(new Uint16Array([0, 1, 2, 0, 2, 3]));
	const material = doc.createMaterial("Paint").setBaseColorFactor(color).setMetallicFactor(0).setDoubleSided(true);
	const primitive = doc
		.createPrimitive()
		.setAttribute("POSITION", position)
		.setAttribute("NORMAL", normal)
		.setIndices(indices)
		.setMaterial(material);
	doc.createScene().addChild(doc.createNode("Panel").setMesh(doc.createMesh("Panel").addPrimitive(primitive)));
	const path = join(dir, `${name}.glb`);
	writeFileSync(path, await new NodeIO().writeBinary(doc));
	return path;
}

test("renders a contact sheet PNG", { skip: !browser && "no Chrome-family browser found" }, async () => {
	const model = await quad("red", 1, [1, 0, 0, 1]);
	const out = join(dir, "red.png");
	const run = spawnSync(process.execPath, [SCRIPT, model, "--out", out, "--size", "128"], { encoding: "utf8", timeout: 90000 });
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /model: 2 triangles/);
	const png = readFileSync(out);
	assert.equal(png.readUInt32BE(0), 0x89504e47);
	assert.equal(png.readUInt32BE(16), 384); // 3 tiles of 128
	assert.equal(png.readUInt32BE(20), 256); // 2 rows
});

test(
	"compare reports zero diff for identical models and a large diff for a recolor",
	{ skip: !browser && "no Chrome-family browser found" },
	async () => {
		const red = await quad("red", 1, [1, 0, 0, 1]);
		const same = await quad("red-copy", 1, [1, 0, 0, 1]);
		const blue = await quad("blue", 1, [0, 0, 1, 1]);
		const identical = spawnSync(process.execPath, [SCRIPT, red, "--compare", same, "--size", "128", "--out", join(dir, "same.png")], {
			encoding: "utf8",
			timeout: 90000,
		});
		assert.equal(identical.status, 0, identical.stderr);
		assert.match(identical.stdout, /Pixel diff: 0% /);
		const recolored = spawnSync(
			process.execPath,
			[SCRIPT, red, "--compare", blue, "--size", "128", "--max-diff", "5", "--out", join(dir, "diff.png")],
			{
				encoding: "utf8",
				timeout: 90000,
			},
		);
		assert.equal(recolored.status, 3);
		assert.match(recolored.stdout, /Pixel diff: (\d{2,3}(\.\d+)?)%/);
	},
);

test("fails clearly on a missing clip", { skip: !browser && "no Chrome-family browser found" }, async () => {
	const model = await quad("static", 1, [0, 1, 0, 1]);
	const run = spawnSync(process.execPath, [SCRIPT, model, "--clip", "Run", "--out", join(dir, "fail.png")], { encoding: "utf8", timeout: 90000 });
	assert.equal(run.status, 1);
	assert.match(run.stderr, /Clip "Run" not found/);
});

test("renders a kit as one tile per asset and a single asset with --node", { skip: !browser && "no Chrome-family browser found" }, async () => {
	const { buildFixtures } = await import("../evals/fixtures.mjs");
	const fixtures = await buildFixtures(join(dir, "fixtures"));
	const grid = spawnSync(process.execPath, [SCRIPT, fixtures.kit, "--size", "100", "--out", join(dir, "kit.png")], {
		encoding: "utf8",
		timeout: 90000,
	});
	assert.equal(grid.status, 0, grid.stderr);
	assert.match(grid.stdout, /Kit: 5 assets/);
	const single = spawnSync(process.execPath, [SCRIPT, fixtures.kit, "--node", "lamp", "--size", "100", "--out", join(dir, "lamp.png")], {
		encoding: "utf8",
		timeout: 90000,
	});
	assert.equal(single.status, 0, single.stderr);
	assert.doesNotMatch(single.stdout, /Kit:/);
	assert.equal(readFileSync(join(dir, "lamp.png")).readUInt32BE(16), 300); // a normal 3x2 sheet of 100 px views
});
