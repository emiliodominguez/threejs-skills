import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { codeBlocksOnly, fixText, lintText, RULES, versionAdvice } from "../skills/threejs-upgrade/scripts/lint.mjs";

const SCRIPT = new URL("../skills/threejs-upgrade/scripts/lint.mjs", import.meta.url).pathname;

/**
 * Returns the rule ids found in a snippet.
 * @param {string} text
 * @returns {string[]}
 */
function ids(text) {
	return lintText(text).map((finding) => finding.rule.id);
}

test("every rule has an id, a level, a release and a message", () => {
	const seen = new Set();
	for (const rule of RULES) {
		assert.ok(!seen.has(rule.id), `duplicate id ${rule.id}`);
		seen.add(rule.id);
		assert.ok(["removed", "deprecated", "outdated", "upcoming"].includes(rule.level), rule.id);
		assert.ok(rule.since >= 99 && rule.since <= 187, rule.id);
		assert.ok(rule.message.length > 10, rule.id);
	}
});

test("finds color management, lighting and loader changes", () => {
	const found = ids(
		[
			"renderer.outputEncoding = THREE.sRGBEncoding;",
			"renderer.useLegacyLights = false;",
			"import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';",
			"const clock = new THREE.Clock();",
			"geometry.attributes.position.updateRange.count = 3;",
		].join("\n"),
	);
	for (const id of ["output-encoding", "srgb-encoding", "legacy-lights", "rgbe-loader", "examples-jsm-path", "clock", "update-range"])
		assert.ok(found.includes(id), id);
});

test("ignores comments and suppressed lines", () => {
	assert.deepEqual(ids("// renderer.outputEncoding = THREE.sRGBEncoding;"), []);
	assert.deepEqual(ids("renderer.outputEncoding = x; // three-lint-disable-line"), []);
});

test("gates TSL rules on TSL imports and keeps the varying() function form valid", () => {
	assert.deepEqual(ids("const v = PI2;"), []);
	const tsl =
		"import { varying, PI2 } from 'three/tsl';\nconst a = varying(positionWorld.y, 'vY');\nconst b = positionLocal.varying();\nconst c = PI2;";
	const found = ids(tsl);
	assert.ok(found.includes("tsl-varying-chain"));
	assert.ok(found.includes("tsl-pi2"));
	assert.equal(lintText(tsl).filter((finding) => finding.rule.id === "tsl-varying-chain").length, 1);
});

test("LightProbeGrid is only flagged outside WebGPU code", () => {
	assert.ok(ids("import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';").includes("light-probe-grid"));
	assert.ok(!ids("import { WebGPURenderer } from 'three/webgpu';\nnew LightProbeGrid();").includes("light-probe-grid"));
	assert.ok(!ids("new LightProbeGridWebGL();").includes("light-probe-grid"));
});

test("context rules need their class in the file", () => {
	assert.deepEqual(ids("scene.add(controls);"), []);
	assert.ok(ids("const controls = new TransformControls(camera, el);\nscene.add(controls);").includes("transform-controls-add"));
});

test("fix applies only one-to-one renames", () => {
	const { text, count } = fixText(
		[
			"import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';",
			"renderer.outputEncoding = THREE.sRGBEncoding;",
			"renderer.useLegacyLights = false;",
		].join("\n"),
	);
	assert.equal(count, 4);
	assert.match(text, /import \{ mergeGeometries \} from 'three\/addons\/utils\/BufferGeometryUtils\.js';/);
	assert.match(text, /renderer\.outputColorSpace = THREE\.SRGBColorSpace;/);
	assert.match(text, /useLegacyLights/);
});

test("markdown mode keeps only fenced code with line numbers", () => {
	const md = "Use `sRGBEncoding` no more.\n\n```js\nrenderer.outputEncoding = 1;\n```\n";
	const masked = codeBlocksOnly(md);
	assert.equal(masked.split("\n").length, md.split("\n").length);
	assert.deepEqual(
		lintText(masked).map((finding) => [finding.rule.id, finding.line]),
		[["output-encoding", 4]],
	);
});

test("version advice covers stepwise upgrades and React pairing", () => {
	const advice = versionAdvice({ file: "package.json", three: "^0.150.0", fiber: "^9.1.0", react: "^18.3.0" });
	assert.ok(advice.some((line) => /r150.*steps of about 10/.test(line)));
	assert.ok(advice.some((line) => /needs React 19/.test(line)));
	assert.deepEqual(versionAdvice({ file: "package.json", three: "0.186.1" }), []);
});

test("CLI exits 1 on removed APIs, applies --fix and skips node_modules", () => {
	const dir = mkdtempSync(join(tmpdir(), "threejs-lint-"));
	mkdirSync(join(dir, "src"));
	mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { three: "0.186.1" } }));
	writeFileSync(join(dir, "src", "app.js"), "import * as THREE from 'three';\nrenderer.outputEncoding = THREE.sRGBEncoding;\n");
	writeFileSync(join(dir, "node_modules", "pkg", "old.js"), "import * as THREE from 'three';\nTHREE.sRGBEncoding;\n");

	const report = spawnSync(process.execPath, [SCRIPT, dir, "--json"], { encoding: "utf8" });
	assert.equal(report.status, 1);
	const parsed = JSON.parse(report.stdout);
	assert.equal(parsed.findings.length, 2);
	assert.ok(parsed.findings.every((finding) => finding.file.includes("src")));

	const fixed = spawnSync(process.execPath, [SCRIPT, dir, "--fix"], { encoding: "utf8" });
	assert.equal(fixed.status, 0);
	assert.match(readFileSync(join(dir, "src", "app.js"), "utf8"), /outputColorSpace = THREE\.SRGBColorSpace/);
});
