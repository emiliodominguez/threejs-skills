#!/usr/bin/env node
// Optimizes a glTF model with a named preset on top of `gltf-transform optimize`, then reports
// what changed: sizes, triangles, draw calls, the decoders the output needs, and any node or
// material names the pass removed (which breaks code that looks parts up by name).
//
//   node optimize.mjs model.glb --preset web
//   node optimize.mjs model.glb out.glb --preset configurator --draco
//   node optimize.mjs model.glb --preset mobile --dry-run
//   node optimize.mjs model.glb --preset web -- --texture-size 1024   # extra flags pass through

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = "@gltf-transform/cli@4";

/** Flags common to presets that must keep names, materials and hierarchy addressable. */
const KEEP_STRUCTURE = ["--join-named", "false", "--palette", "false"];

/**
 * Presets map a use case to `gltf-transform optimize` flags. Each one says what it keeps and what it trades.
 * @type {Record<string, { summary: string, flags: string[] }>}
 */
export const PRESETS = {
	web: {
		summary: "General web delivery. Keeps every triangle and every named node and material; meshopt geometry, WebP textures up to 2048 px.",
		flags: ["--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "2048", "--simplify", "false", ...KEEP_STRUCTURE],
	},
	hero: {
		summary: "The model the camera lingers on. Lossless geometry, textures kept at up to 4096 px in WebP, names and materials kept.",
		flags: ["--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "4096", "--simplify", "false", ...KEEP_STRUCTURE],
	},
	configurator: {
		summary: "Product configurators and anything that edits parts at runtime. Keeps hierarchy, names, materials and separate meshes; compresses only.",
		flags: ["--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "2048", "--simplify", "false", "--flatten", "false", "--join", "false", "--instance", "false", "--palette", "false"],
	},
	animated: {
		summary: "Rigged or animated characters. No simplification (it distorts skinning); resamples and compresses animation tracks; names kept.",
		flags: ["--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "2048", "--simplify", "false", "--resample", "true", ...KEEP_STRUCTURE],
	},
	background: {
		summary: "Props and scenery nobody inspects. Simplifies to about half the vertices, 1024 px textures, joins and palettes everything.",
		flags: ["--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "1024", "--simplify", "true", "--simplify-ratio", "0.5", "--simplify-error", "0.001"],
	},
	mobile: {
		summary: "Phones and low GPU memory. KTX2 textures at up to 1024 px (needs the ktx CLI), light simplification, names and materials kept.",
		flags: ["--compress", "meshopt", "--texture-compress", "ktx2", "--texture-size", "1024", "--simplify", "true", "--simplify-ratio", "0.75", "--simplify-error", "0.001", ...KEEP_STRUCTURE],
	},
	lossless: {
		summary: "Cleanup only: dedup, prune and weld. No compression, no simplification, no texture changes, so no decoders needed.",
		flags: ["--compress", "false", "--texture-compress", "false", "--simplify", "false", ...KEEP_STRUCTURE],
	},
};

/**
 * Formats a byte count for people.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Formats a change as a percentage.
 * @param {number} before
 * @param {number} after
 * @returns {string}
 */
function delta(before, after) {
	if (before === 0) return after === 0 ? "" : "(new)";
	const change = ((after - before) / before) * 100;
	return change === 0 ? "" : `(${change > 0 ? "+" : ""}${change.toFixed(0)}%)`;
}

/**
 * Loads the sibling inspect script when the collection is installed together.
 * @returns {Promise<((path: string) => Promise<any>) | null>}
 */
async function loadInspector() {
	try {
		const module = await import(new URL("../../threejs-model-inspect/scripts/inspect.mjs", import.meta.url).href);
		return module.inspect;
	} catch {
		return null;
	}
}

/**
 * Collects the names code is likely to look up: named nodes and materials.
 * @param {any} report
 * @returns {{ nodes: Set<string>, materials: Set<string> }}
 */
function addressableNames(report) {
	return {
		nodes: new Set(report.tree.map((entry) => entry.threeName).filter(Boolean)),
		materials: new Set(report.materials.map((material) => material.name).filter((name) => !/^material_\d+$/.test(name))),
	};
}

/**
 * Checks whether the KTX-Software CLI is on PATH.
 * @returns {boolean}
 */
function hasKtx() {
	return spawnSync("ktx", ["--version"], { stdio: "ignore" }).status === 0;
}

/**
 * Parses arguments, runs the optimization and prints the comparison.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
	const all = argv.slice(2);
	const separator = all.indexOf("--");
	const args = separator >= 0 ? all.slice(0, separator) : all;
	const passthrough = separator >= 0 ? all.slice(separator + 1) : [];

	if (args.length === 0 || args.includes("-h") || args.includes("--help") || args.includes("--list")) {
		console.log("Usage: node optimize.mjs <input> [output] --preset <name> [--draco] [--dry-run] [-- extra gltf-transform flags]\n\nPresets:");
		for (const [name, preset] of Object.entries(PRESETS)) console.log(`  ${name.padEnd(13)} ${preset.summary}`);
		return args.length === 0 ? 1 : 0;
	}

	const presetIndex = args.indexOf("--preset");
	const presetName = presetIndex >= 0 ? args[presetIndex + 1] : "web";
	const preset = PRESETS[presetName];
	if (!preset) {
		console.error(`Unknown preset "${presetName}". Choose one of: ${Object.keys(PRESETS).join(", ")}`);
		return 1;
	}
	const positional = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--preset");
	const [input, outputArg] = positional;
	if (!input) {
		console.error("No input model given.");
		return 1;
	}
	try {
		await stat(input);
	} catch {
		console.error(`File not found: ${input}`);
		return 1;
	}
	const output = outputArg ?? join(dirname(input), `${basename(input, extname(input))}.${presetName}.glb`);
	if (resolve(output) === resolve(input)) {
		console.error("Output must differ from input; keep the source file as the master copy.");
		return 1;
	}

	let flags = [...preset.flags];
	if (args.includes("--draco")) flags[flags.indexOf("--compress") + 1] = "draco";
	const ktxIndex = flags.indexOf("ktx2");
	if (ktxIndex >= 0 && !hasKtx()) {
		console.warn("The ktx CLI (KTX-Software 4.4+) is not installed, so KTX2 is unavailable; falling back to WebP. Install it for GPU-compressed textures.");
		flags[ktxIndex] = "webp";
	}
	flags = [...flags, ...passthrough];
	const command = ["-y", CLI, "optimize", input, output, ...flags];
	console.log(`Preset ${presetName}: ${preset.summary}`);
	console.log(`$ npx ${command.join(" ")}`);
	if (args.includes("--dry-run")) return 0;

	const inspect = await loadInspector();
	const before = inspect ? await inspect(input) : null;
	const compressed = before?.extensionsUsed.filter((name) => /meshopt_compression|draco_mesh_compression|texture_basisu/.test(name)) ?? [];
	if (compressed.length > 0) {
		console.log(
			`Note: the input is already compressed (${compressed.join(", ")}${before.generator ? `, by ${before.generator}` : ""}). Re-optimizing decodes and re-encodes it; expect little or no gain, and keep the existing pipeline if the result is not smaller.`,
		);
	}
	// npx is a .cmd launcher on Windows, which spawnSync can only start through a shell.
	const run = spawnSync("npx", command, { stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" });
	if (run.status !== 0) {
		console.error(`gltf-transform exited with status ${run.status}.`);
		return run.status ?? 1;
	}

	if (!inspect || !before) {
		const [inStat, outStat] = await Promise.all([stat(input), stat(output)]);
		console.log(`\n${input}: ${formatBytes(inStat.size)} -> ${output}: ${formatBytes(outStat.size)} ${delta(inStat.size, outStat.size)}`);
		console.log("Install threejs-model-inspect next to this skill for the full comparison and decoder list.");
		return 0;
	}

	const after = await inspect(output);
	const rows = [
		["total size", formatBytes(before.bytes.total), formatBytes(after.bytes.total), delta(before.bytes.total, after.bytes.total)],
		["geometry", formatBytes(before.bytes.geometry), formatBytes(after.bytes.geometry), delta(before.bytes.geometry, after.bytes.geometry)],
		["textures", formatBytes(before.bytes.textures), formatBytes(after.bytes.textures), delta(before.bytes.textures, after.bytes.textures)],
		["animation", formatBytes(before.bytes.animation), formatBytes(after.bytes.animation), delta(before.bytes.animation, after.bytes.animation)],
		["texture GPU memory", formatBytes(before.gpuTextureBytes), formatBytes(after.gpuTextureBytes), delta(before.gpuTextureBytes, after.gpuTextureBytes)],
		["triangles", String(before.scene.triangles), String(after.scene.triangles), delta(before.scene.triangles, after.scene.triangles)],
		["draw calls", String(before.scene.drawCalls), String(after.scene.drawCalls), delta(before.scene.drawCalls, after.scene.drawCalls)],
		["materials", String(before.scene.materials), String(after.scene.materials), delta(before.scene.materials, after.scene.materials)],
		["nodes", String(before.scene.nodes), String(after.scene.nodes), delta(before.scene.nodes, after.scene.nodes)],
		["animations", String(before.animations.length), String(after.animations.length), delta(before.animations.length, after.animations.length)],
	];
	console.log(`\n${"".padEnd(20)}${"before".padEnd(14)}${"after".padEnd(14)}`);
	for (const [label, from, to, change] of rows) console.log(`${label.padEnd(20)}${from.padEnd(14)}${to.padEnd(14)}${change}`);
	const smaller = after.bytes.total < before.bytes.total * 0.98 || after.gpuTextureBytes < before.gpuTextureBytes * 0.98 || after.scene.drawCalls < before.scene.drawCalls;
	if (!smaller) {
		console.log(
			`\nNo meaningful gain: the output is not smaller in download, GPU memory or draw calls. Keep the original${compressed.length ? " and its existing pipeline" : ""}; delete ${output}.`,
		);
	}

	const namesBefore = addressableNames(before);
	const namesAfter = addressableNames(after);
	const lostNodes = [...namesBefore.nodes].filter((name) => !namesAfter.nodes.has(name));
	const lostMaterials = [...namesBefore.materials].filter((name) => !namesAfter.materials.has(name));
	if (lostNodes.length > 0 || lostMaterials.length > 0) {
		console.log("\nNames removed by this pass (code using getObjectByName or material names will break):");
		if (lostNodes.length > 0) console.log(`  nodes: ${lostNodes.slice(0, 20).join(", ")}${lostNodes.length > 20 ? ` ... +${lostNodes.length - 20}` : ""}`);
		if (lostMaterials.length > 0) console.log(`  materials: ${lostMaterials.slice(0, 20).join(", ")}${lostMaterials.length > 20 ? ` ... +${lostMaterials.length - 20}` : ""}`);
		console.log("  Use --preset configurator to keep them, or confirm nothing references them.");
	} else {
		console.log("\nAll named nodes and materials survived.");
	}

	console.log(`\nLoader wiring for ${output}:`);
	if (after.decoders.length === 0) console.log("  GLTFLoader as-is (no decoders needed).");
	for (const decoder of after.decoders) console.log(`  ${decoder.wiring}`);
	for (const warning of after.warnings.filter((entry) => entry.level !== "info")) console.log(`  [${warning.level}] ${warning.code}: ${warning.message}`);

	const render = fileURLToPath(new URL("../../threejs-model-inspect/scripts/render.mjs", import.meta.url));
	console.log(`\nCompare visually:\n  node ${render} ${input} --compare ${output}`);
	return 0;
}

// Compare real paths so the script also runs when invoked through a symlinked skill directory.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	process.exitCode = await main(process.argv);
}
