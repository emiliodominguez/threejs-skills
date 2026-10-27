import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { PRESETS } from "../skills/threejs-model-optimize/scripts/optimize.mjs";

const SCRIPT = new URL("../skills/threejs-model-optimize/scripts/optimize.mjs", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "threejs-skills-opt-"));
const input = join(dir, "model.glb");
writeFileSync(input, "placeholder");

/**
 * Runs the optimize script and returns its result.
 * @param {string[]} args
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function run(args) {
	return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

/**
 * Returns the value following a flag in a list of arguments.
 * @param {string[]} flags
 * @param {string} name
 * @returns {string | undefined}
 */
function flag(flags, name) {
	const index = flags.indexOf(name);
	return index >= 0 ? flags[index + 1] : undefined;
}

test("presets that keep names disable joining named meshes and palettes", () => {
	for (const name of ["web", "hero", "configurator", "animated", "mobile", "lossless"]) {
		assert.equal(flag(PRESETS[name].flags, "--join-named") ?? flag(PRESETS[name].flags, "--join"), "false", name);
		assert.equal(flag(PRESETS[name].flags, "--palette"), "false", name);
	}
	assert.equal(flag(PRESETS.configurator.flags, "--flatten"), "false");
	assert.equal(flag(PRESETS.animated.flags, "--simplify"), "false");
});

test("dry run prints the gltf-transform command with the default output path", () => {
	const result = run([input, "--preset", "configurator", "--dry-run"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /optimize .*model\.glb .*model\.configurator\.glb/);
	assert.match(result.stdout, /--flatten false/);
});

test("--draco swaps the geometry codec and passthrough flags are appended", () => {
	const result = run([input, "--preset", "web", "--draco", "--dry-run", "--", "--texture-size", "512"]);
	assert.match(result.stdout, /--compress draco/);
	assert.match(result.stdout, /--texture-size 512$/m);
});

test("rejects unknown presets and writing over the input", () => {
	assert.equal(run([input, "--preset", "tiny"]).status, 1);
	assert.equal(run([input, input, "--preset", "web"]).status, 1);
});

test("--list prints every preset", () => {
	const result = run(["--list"]);
	assert.equal(result.status, 0);
	for (const name of Object.keys(PRESETS)) assert.match(result.stdout, new RegExp(`^\\s+${name}\\s`, "m"));
});
