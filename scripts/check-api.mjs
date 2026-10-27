#!/usr/bin/env node
// Verifies the three.js API surface the skills use against the installed three package (the version
// the skills target): every three/addons import path exists and exports the imported names, every
// name imported from three, three/webgpu and three/tsl exists, and every THREE.X reference resolves.
// Scans fenced code in Markdown plus the bundled scripts, assets and examples.
//
//   node scripts/check-api.mjs          # exit 1 on unknown APIs

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const THREE_DIR = join(ROOT, "node_modules", "three");

/**
 * Lists files to scan.
 * @param {string} dir
 * @returns {string[]}
 */
function files(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name.startsWith(".") || entry.name === "node_modules" ? [] : files(path);
		return /\.(md|mjs|js|html)$/.test(entry.name) ? [path] : [];
	});
}

/**
 * Returns the code to scan: fenced blocks for Markdown, everything else verbatim.
 * @param {string} path
 * @returns {string}
 */
function code(path) {
	const text = readFileSync(path, "utf8");
	if (!path.endsWith(".md")) return text;
	return [...text.matchAll(/^\s*```[\w-]*\n([\s\S]*?)^\s*```/gm)].map((match) => match[1]).join("\n");
}

/**
 * Collects exported names from an ES module source file by reading its export statements.
 * @param {string} source
 * @returns {Set<string>}
 */
function exportedNames(source) {
	const names = new Set();
	for (const [, list] of source.matchAll(/export\s*\{([^}]*)\}/g)) {
		for (const part of list.split(",")) {
			const name = part
				.trim()
				.split(/\s+as\s+/)
				.pop()
				?.trim();
			if (name) names.add(name);
		}
	}
	for (const [, name] of source.matchAll(/export\s+(?:default\s+)?(?:class|function\*?|const|let|var|async\s+function)\s+([\w$]+)/g))
		names.add(name);
	if (/export\s+default/.test(source)) names.add("default");
	return names;
}

/**
 * Collects names a three entry point exports, following `export * from` re-exports.
 * @param {string} file
 * @param {Set<string>} [seen]
 * @returns {Set<string>}
 */
function entryExports(file, seen = new Set()) {
	if (seen.has(file) || !existsSync(file)) return new Set();
	seen.add(file);
	const source = readFileSync(file, "utf8");
	const names = exportedNames(source);
	for (const [, target] of source.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)) {
		for (const name of entryExports(join(file, "..", target), seen)) names.add(name);
	}
	for (const [, target] of source.matchAll(/export\s*\*\s*as\s+(\w+)\s+from/g)) names.add(target);
	return names;
}

/**
 * Collects names a package exports by walking its type declarations (export lists, declarations and
 * `export *` re-exports). Returns null when the package is not installed.
 * @param {string} name
 * @returns {Set<string> | null}
 */
function packageExports(name) {
	const dir = join(ROOT, "node_modules", name);
	const manifestPath = join(dir, "package.json");
	if (!existsSync(manifestPath)) return null;
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const rootExport = manifest.exports?.["."];
	const typesEntry =
		manifest.types ?? manifest.typings ?? (typeof rootExport === "object" ? (rootExport.types ?? rootExport.import?.types) : undefined);
	if (!typesEntry) return null;
	const names = new Set();
	const seen = new Set();
	/**
	 * Reads one declaration file and its re-exports.
	 * @param {string} file
	 */
	function walk(file) {
		const candidates = [file, `${file}.d.ts`, file.replace(/\.js$/, ".d.ts"), join(file, "index.d.ts")];
		const path = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
		if (!path || seen.has(path)) return;
		seen.add(path);
		const source = readFileSync(path, "utf8");
		for (const [, list] of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
			for (const part of list.split(",")) {
				const exported = part
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)
					.pop()
					?.trim();
				if (exported) names.add(exported);
			}
		}
		for (const [, exported] of source.matchAll(
			/export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|function|const|let|var|type|interface|enum|namespace)\s+([\w$]+)/g,
		))
			names.add(exported);
		for (const [, alias] of source.matchAll(/export\s*\*\s*as\s+(\w+)\s+from/g)) names.add(alias);
		for (const [, target] of source.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)) walk(join(path, "..", target));
	}
	walk(join(dir, typesEntry));
	// Some packages (gsap) declare types as ambient modules; the runtime ES entry is the ground truth.
	const runtimeEntry =
		manifest.module ??
		(typeof rootExport === "object" ? (typeof rootExport.import === "string" ? rootExport.import : rootExport.default) : undefined);
	if (runtimeEntry && existsSync(join(dir, runtimeEntry)))
		for (const exported of exportedNames(readFileSync(join(dir, runtimeEntry), "utf8"))) names.add(exported);
	return names;
}

/**
 * Parses `import { a, b as c } from "x"` statements.
 * @param {string} source
 * @returns {{ names: string[], from: string }[]}
 */
function imports(source) {
	return [...source.matchAll(/import\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)].map(([, list, from]) => ({
		names: list
			.split(",")
			.map((part) =>
				part
					.trim()
					.split(/\s+as\s+/)[0]
					.replace(/^type\s+/, "")
					.trim(),
			)
			.filter(Boolean),
		from,
	}));
}

if (!existsSync(join(THREE_DIR, "package.json"))) {
	console.error("three is not installed; run pnpm install.");
	process.exit(1);
}
const version = JSON.parse(readFileSync(join(THREE_DIR, "package.json"), "utf8")).version;
const core = entryExports(join(THREE_DIR, "src", "Three.js"));
const webgpu = entryExports(join(THREE_DIR, "src", "Three.WebGPU.js"));
const tsl = entryExports(join(THREE_DIR, "src", "Three.TSL.js"));
const entries = { three: core, "three/webgpu": webgpu, "three/tsl": tsl };
const packages = {};

const problems = [];
let checked = 0;
for (const path of [...files(join(ROOT, "skills")), ...files(join(ROOT, "examples"))]) {
	const source = code(path);
	const where = relative(ROOT, path);
	if (readFileSync(path, "utf8").includes("three-lint-disable-file")) continue; // quotes outdated APIs on purpose
	for (const { names, from } of imports(source)) {
		if (entries[from]) {
			for (const name of names) {
				checked++;
				if (!entries[from].has(name)) problems.push(`${where}: "${name}" is not exported by ${from}`);
			}
		} else if (/^(@[\w-]+\/)?[\w-]+$/.test(from)) {
			packages[from] ??= packageExports(from);
			if (!packages[from]) continue; // not installed: cannot check
			for (const name of names) {
				checked++;
				if (!packages[from].has(name)) problems.push(`${where}: "${name}" is not exported by ${from}`);
			}
		} else if (from.startsWith("three/addons/")) {
			const file = join(THREE_DIR, "examples", "jsm", from.slice("three/addons/".length));
			checked++;
			if (!existsSync(file)) {
				problems.push(`${where}: ${from} does not exist in three ${version}`);
				continue;
			}
			const exported = exportedNames(readFileSync(file, "utf8"));
			for (const name of names) {
				checked++;
				if (!exported.has(name)) problems.push(`${where}: "${name}" is not exported by ${from}`);
			}
		}
	}
	for (const [, from] of source.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+["'](three\/addons\/[^"']+)["']/g)) {
		checked++;
		if (!existsSync(join(THREE_DIR, "examples", "jsm", from.slice("three/addons/".length))))
			problems.push(`${where}: ${from} does not exist in three ${version}`);
	}
	const isWebGPU = /three\/webgpu/.test(source);
	for (const [, name] of source.matchAll(/\bTHREE\.([A-Za-z_$][\w$]*)/g)) {
		checked++;
		if (!core.has(name) && !(isWebGPU && webgpu.has(name)))
			problems.push(`${where}: THREE.${name} does not exist in three ${version}${webgpu.has(name) ? " (WebGPU build only)" : ""}`);
	}
}

for (const problem of [...new Set(problems)]) console.log(`✗ ${problem}`);
console.log(`${checked} API references checked against three ${version}: ${new Set(problems).size} problem(s).`);
process.exitCode = problems.length ? 1 : 0;
