import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildFixtures, FIXTURES } from "../evals/fixtures.mjs";
import { inspect } from "../skills/threejs-model-inspect/scripts/inspect.mjs";

const paths = await buildFixtures(mkdtempSync(join(tmpdir(), "threejs-fixtures-")));

for (const [name, fixture] of Object.entries(FIXTURES)) {
	test(`inspect diagnoses the ${name} fixture`, async () => {
		const report = await inspect(paths[name]);
		const codes = report.warnings.map((warning) => warning.code);
		for (const code of fixture.expect) assert.ok(codes.includes(code), `${name}: expected ${code}, got ${codes.join(", ")}`);
	});
}

test("clip-names fixture exposes converter-style clip names", async () => {
	const report = await inspect(paths["clip-names"]);
	assert.deepEqual(
		report.animations.map((animation) => animation.name),
		["Armature|mixamo.com|Layer0", "Armature|Idle", "Armature|Wave"],
	);
});

test("configurator fixture reports three.js names and shared materials", async () => {
	const report = await inspect(paths.configurator);
	const names = report.tree.map((entry) => entry.threeName);
	for (const name of ["Body_Paint", "Fender001", "Handlebar", "Wheel"]) assert.ok(names.includes(name), name);
	assert.equal(report.materials.find((material) => material.name === "Paint").usedBy, 2);
});

test("kit fixture reports per-asset stats and suppresses whole-file grounding", async () => {
	const report = await inspect(paths.kit);
	assert.deepEqual(report.kit.assets.map((asset) => asset.name).sort(), ["barrel", "bench", "crate", "lamp", "sign"]);
	assert.equal(report.kit.assets.find((asset) => asset.name === "sign").grounded, false);
	const codes = report.warnings.map((warning) => warning.code);
	assert.ok(!codes.includes("not-grounded"));
	assert.equal((await inspect(paths.configurator)).kit, null, "a single assembled product is not a kit");
});
