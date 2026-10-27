#!/usr/bin/env node
// Keeps the collection current. Reports, in order:
//   1. three.js releases after the target (lint.mjs TARGET), with the migration-guide items for each,
//      which skill files mention the affected APIs, and which items have no lint rule yet;
//   2. drift between the library versions the skills document and the latest on npm;
//   3. upstream commits to forked skills since the commit recorded in their metadata.source.
// With --sync, forked cloudai-x skills are replaced by upstream HEAD, keeping our metadata line and
// the See Also lines we added. Review the result with git diff.
//
//   node scripts/check-upstream.mjs
//   node scripts/check-upstream.mjs --sync
//
// Network: npm registry, raw.githubusercontent.com and api.github.com (set GITHUB_TOKEN to avoid rate
// limits; behind a proxy set NODE_USE_ENV_PROXY=1).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RULES, TARGET } from "../skills/threejs-upgrade/scripts/lint.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SKILLS = join(ROOT, "skills");
const MIGRATION_GUIDE = "https://raw.githubusercontent.com/wiki/mrdoob/three.js/Migration-Guide.md";

/** Library versions the skills are written against. Update together with the skill text. */
export const DOCUMENTED = {
	three: "0.186.1",
	"@react-three/fiber": "9.8.2",
	"@react-three/drei": "10.7.9",
	"@gltf-transform/cli": "4.5.1",
	gsap: "3.15.0",
	lenis: "1.3.27",
	"@dimforge/rapier3d-compat": "0.21.0",
	"@react-three/rapier": "2.2.0",
	"@sparkjsdev/spark": "2.4.0",
	"@google/model-viewer": "4.4.0",
	"@react-three/xr": "6.6.32",
};

/**
 * Fetches text, with a GitHub token when present.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function getText(url) {
	const headers = { "user-agent": "threejs-skills-upstream-check" };
	if (process.env.GITHUB_TOKEN && url.includes("github")) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`${response.status} for ${url}`);
	return response.text();
}

/**
 * Splits the migration guide into releases and their bullet items.
 * @param {string} markdown
 * @returns {{ from: number, to: number, items: string[] }[]}
 */
export function parseMigrationGuide(markdown) {
	const releases = [];
	let current = null;
	for (const line of markdown.split("\n")) {
		const heading = /^## r?(\d+)\s*→\s*r?(\d+)/.exec(line);
		if (heading) {
			current = { from: Number(heading[1]), to: Number(heading[2]), items: [] };
			releases.push(current);
		} else if (current && /^\s*-\s+/.test(line)) {
			current.items.push(line.replace(/^\s*-\s+/, "").trim());
		}
	}
	return releases;
}

/**
 * Extracts API identifiers from a migration item (backticked names, without call parentheses).
 * @param {string} item
 * @returns {string[]}
 */
export function identifiers(item) {
	return [...item.matchAll(/`([^`]+)`/g)]
		.map((match) => match[1].replace(/\(.*$/, "").replace(/^.*\./, ""))
		.filter((name) => /^[A-Za-z_][\w]{3,}$/.test(name) && !COMMON_NAMES.has(name));
}

/** Names that appear in nearly every three.js file; matching them says nothing about a change. */
const COMMON_NAMES = new Set([
	"WebGLRenderer",
	"WebGPURenderer",
	"Number",
	"String",
	"Object3D",
	"Scene",
	"Mesh",
	"Material",
	"Texture",
	"Node",
	"renderer",
	"storage",
	"member",
	"element",
	"true",
	"false",
	"null",
]);

/**
 * Lists every Markdown and script file under skills/.
 * @param {string} dir
 * @returns {string[]}
 */
function skillFiles(dir = SKILLS) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : skillFiles(path);
		return /\.(md|mjs|js|html)$/.test(entry.name) && !path.endsWith("lint.mjs") ? [path] : [];
	});
}

/**
 * Reports releases after the target and where the skills mention changed APIs.
 * @returns {Promise<void>}
 */
async function checkThree() {
	const latest = JSON.parse(await getText("https://registry.npmjs.org/three/latest")).version;
	const latestRelease = Number(latest.split(".")[1]);
	console.log(`three: target r${TARGET}, latest on npm ${latest} (r${latestRelease})${latestRelease > TARGET ? "  <- skills are behind" : ""}`);
	const releases = parseMigrationGuide(await getText(MIGRATION_GUIDE)).filter((release) => release.to > TARGET);
	if (releases.length === 0) {
		console.log("  migration guide has nothing after the target");
		return;
	}
	const files = skillFiles().map((path) => ({ path, text: readFileSync(path, "utf8") }));
	const ruleSources = RULES.map((rule) => rule.pattern.source).join("\n");
	for (const release of releases) {
		const status = release.to > latestRelease ? "in development" : "released";
		console.log(`\n  r${release.from} -> r${release.to} (${status}), ${release.items.length} items`);
		for (const item of release.items) {
			const names = identifiers(item);
			const mentions = files
				.filter((file) => names.some((name) => new RegExp(`\\b${name}\\b`).test(file.text)))
				.map((file) => file.path.slice(SKILLS.length + 1));
			const unlinted = names.filter((name) => !ruleSources.includes(name));
			console.log(`  - ${item.slice(0, 150)}${item.length > 150 ? "..." : ""}`);
			if (mentions.length) console.log(`      mentioned in: ${[...new Set(mentions)].join(", ")}`);
			if (names.length && unlinted.length === names.length) console.log(`      no lint rule for: ${unlinted.join(", ")}`);
		}
	}
}

/**
 * Reports documented library versions that are behind npm.
 * @returns {Promise<void>}
 */
async function checkLibraries() {
	console.log("\nLibraries (documented -> latest):");
	for (const [name, documented] of Object.entries(DOCUMENTED)) {
		try {
			const latest = JSON.parse(await getText(`https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`)).version;
			const [dMajor, dMinor] = documented.split(".").map(Number);
			const [lMajor, lMinor] = latest.split(".").map(Number);
			const drift = lMajor !== dMajor ? "MAJOR" : lMinor !== dMinor ? "minor" : "";
			console.log(
				`  ${name.padEnd(28)} ${documented.padEnd(9)} -> ${latest.padEnd(9)} ${drift ? `<- ${drift} update, review the skill` : "ok"}`,
			);
		} catch (error) {
			console.log(`  ${name.padEnd(28)} ${documented.padEnd(9)} -> ? (${error.message})`);
		}
	}
}

/**
 * Reads fork metadata from every skill.
 * @returns {{ skill: string, repo: string, path: string, commit: string, file: string, text: string }[]}
 */
function forks() {
	return readdirSync(SKILLS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => {
			const file = join(SKILLS, entry.name, "SKILL.md");
			const text = readFileSync(file, "utf8");
			const match = /source: "https:\/\/github\.com\/([\w.-]+\/[\w.-]+) \(([^,]+), (\w+), commit (\w+)\)"/.exec(text);
			return match ? { skill: entry.name, repo: match[1], path: match[2], commit: match[4], file, text } : null;
		})
		.filter(Boolean);
}

/**
 * Re-applies our additions to an upstream SKILL.md: the metadata line and any See Also lines we added.
 * @param {string} upstream
 * @param {string} ours
 * @param {string} metadataLine
 * @returns {string}
 */
export function reapply(upstream, ours, metadataLine) {
	const end = upstream.indexOf("\n---", 4);
	let merged = `${upstream.slice(0, end)}\n${metadataLine}${upstream.slice(end)}`;
	const seeAlso = (text) =>
		text
			.split("## See Also")[1]
			?.split("\n")
			.filter((line) => line.startsWith("- ")) ?? [];
	const added = seeAlso(ours).filter((line) => !seeAlso(upstream).includes(line));
	if (added.length) merged = `${merged.replace(/\n*$/, "")}\n${added.join("\n")}\n`;
	return merged;
}

/**
 * Reports upstream commits for forks and optionally syncs cloudai-x forks to HEAD.
 * @param {boolean} sync
 * @returns {Promise<void>}
 */
async function checkForks(sync) {
	console.log("\nForked skills:");
	const byRepo = new Map();
	for (const fork of forks()) {
		if (!byRepo.has(fork.repo)) {
			const commits = JSON.parse(await getText(`https://api.github.com/repos/${fork.repo}/commits?per_page=1`));
			byRepo.set(fork.repo, commits[0].sha);
		}
		const head = byRepo.get(fork.repo);
		if (head.startsWith(fork.commit)) {
			console.log(`  ${fork.skill.padEnd(26)} up to date (${fork.commit})`);
			continue;
		}
		const compare = JSON.parse(await getText(`https://api.github.com/repos/${fork.repo}/compare/${fork.commit}...${head}`));
		const touched = (compare.files ?? []).filter((file) => file.filename.startsWith(fork.path));
		console.log(
			`  ${fork.skill.padEnd(26)} ${touched.length ? `${touched.length} upstream file(s) changed since ${fork.commit}` : `no changes to ${fork.path} since ${fork.commit}`}`,
		);
		if (!sync || touched.length === 0) continue;
		if (fork.repo !== "cloudai-x/threejs-skills") {
			console.log(
				`      not synced automatically: ${fork.skill} was rewritten; port changes by hand from ${touched.map((file) => file.filename).join(", ")}`,
			);
			continue;
		}
		const upstream = await getText(`https://raw.githubusercontent.com/${fork.repo}/${head}/${fork.path}/SKILL.md`);
		const metadata = `metadata:\n  source: "https://github.com/${fork.repo} (${fork.path}, MIT, commit ${head.slice(0, 7)})"`;
		writeFileSync(fork.file, reapply(upstream, fork.text, metadata));
		console.log(`      synced to ${head.slice(0, 7)}; review with git diff and record the change in THIRD_PARTY_NOTICES.md`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const sync = process.argv.includes("--sync");
	try {
		await checkThree();
		await checkLibraries();
		await checkForks(sync);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
