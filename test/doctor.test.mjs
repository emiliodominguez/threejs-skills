import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildFixtures } from "../evals/fixtures.mjs";
import { findBrowser } from "../skills/threejs-model-inspect/scripts/render.mjs";

const SCRIPT = new URL("../skills/threejs-scene-doctor/scripts/doctor.mjs", import.meta.url).pathname;
const SCAFFOLD = new URL("../evals/scaffold/", import.meta.url).pathname;
const browser = findBrowser();

/**
 * Creates a page from the eval scaffold with a fixture and an optional edit to main.js.
 * @param {string} fixture
 * @param {(source: string) => string} [edit]
 * @returns {Promise<string>} path to index.html
 */
async function page(fixture, edit = (source) => source) {
	const dir = mkdtempSync(join(tmpdir(), "threejs-doctor-"));
	const fixtures = await buildFixtures(join(dir, "fixtures"));
	cpSync(fixtures[fixture], join(dir, "model.glb"));
	cpSync(join(SCAFFOLD, "index.html"), join(dir, "index.html"));
	writeFileSync(join(dir, "main.js"), edit(readFileSync(join(SCAFFOLD, "main.js"), "utf8").replaceAll("MODEL", "model.glb")));
	return join(dir, "index.html");
}

/**
 * Runs the doctor and returns its JSON report.
 * @param {string} target
 * @returns {any}
 */
function doctor(target) {
	const run = spawnSync(process.execPath, [SCRIPT, target, "--json", "--wait", "4000", "--sample", "500"], { encoding: "utf8", timeout: 90000 });
	return JSON.parse(run.stdout);
}

test("flags an unlit metal and reports renderer stats", { skip: !browser && "no Chrome-family browser found" }, async () => {
	const report = doctor(await page("metal-black"));
	assert.equal(report.renderer.type, "WebGLRenderer");
	assert.equal(report.renderer.revision, "186");
	assert.ok(report.findings.some((finding) => finding.code === "metal-no-env"));
});

test("reads the screen scene, not environment scenes, and finds a stuck mixer", { skip: !browser && "no Chrome-family browser found" }, async () => {
	const report = doctor(
		await page("clip-names", (source) =>
			source
				.replace(
					"import { GLTFLoader }",
					'import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";\nimport { GLTFLoader }',
				)
				.replace(
					"scene.add(light);",
					"scene.add(light);\nscene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;",
				)
				.replace(
					"scene.add(gltf.scene);",
					"scene.add(gltf.scene);\nnew THREE.AnimationMixer(gltf.scene).clipAction(gltf.animations[0]).play();",
				),
		),
	);
	assert.equal(report.scene.environment, true);
	assert.equal(report.scene.meshes, 1, "the RoomEnvironment scene must not be mistaken for the app scene");
	assert.ok(report.findings.some((finding) => finding.code === "mixer-not-updated"));
});
