#!/usr/bin/env node
// Validates every skill: frontmatter shape, name and directory agreement, description budgets,
// that referenced bundled files exist, that referenced skills exist, and that profiles and the
// plugin manifest agree with the skills on disk.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKILLS_DIR = join(ROOT, "skills");
const OWN_DESCRIPTION_LIMIT = 300;
const FORK_DESCRIPTION_LIMIT = 420;
const CORPUS_LIMIT = 8000;
const BODY_LINE_LIMIT = 500;
const EXTERNAL_SKILLS = new Set(["img2threejs"]);

/**
 * Splits a SKILL.md into a flat frontmatter map and its body. Handles the subset of YAML skills use.
 * @param {string} text
 * @returns {{ data: Record<string, string>, body: string } | null}
 */
function parseSkill(text) {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
	if (!match) return null;
	const data = {};
	let parent = "";
	for (const line of match[1].split("\n")) {
		const entry = /^(\s*)([\w-]+):\s*(.*)$/.exec(line);
		if (!entry) continue;
		const [, indent, key, raw] = entry;
		const value = raw.replace(/^"(.*)"$/, "$1");
		if (indent.length === 0) parent = key;
		data[indent.length === 0 ? key : `${parent}.${key}`] = value;
	}
	return { data, body: match[2] };
}

/**
 * Validates all skills and distribution files.
 * @returns {string[]} problems found
 */
function validate() {
	const problems = [];
	const names = readdirSync(SKILLS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => entry.name);
	const known = new Set(names);
	let corpus = 0;

	for (const name of names) {
		const dir = join(SKILLS_DIR, name);
		const file = join(dir, "SKILL.md");
		if (!existsSync(file)) {
			problems.push(`${name}: missing SKILL.md`);
			continue;
		}
		const parsed = parseSkill(readFileSync(file, "utf8"));
		if (!parsed) {
			problems.push(`${name}: frontmatter is missing or malformed`);
			continue;
		}
		const { data, body } = parsed;
		const isFork = Boolean(data["metadata.source"]);
		if (data.name !== name) problems.push(`${name}: frontmatter name "${data.name}" does not match the directory`);
		if (!data.description) problems.push(`${name}: description is empty`);
		const limit = isFork ? FORK_DESCRIPTION_LIMIT : OWN_DESCRIPTION_LIMIT;
		if ((data.description ?? "").length > limit) problems.push(`${name}: description is ${data.description.length} characters (limit ${limit})`);
		if (!isFork && !/Use when|Use for/.test(data.description ?? "")) problems.push(`${name}: description lacks a "Use when" trigger`);
		if (!isFork && !/(Hands off to|Routes to|Feeds) `[\w-]+`/.test(data.description ?? ""))
			problems.push(`${name}: description lacks a handoff clause`);
		corpus += (data.description ?? "").length;

		const lines = body.split("\n").length;
		if (lines > BODY_LINE_LIMIT) problems.push(`${name}: body is ${lines} lines (limit ${BODY_LINE_LIMIT})`);
		if (!isFork) {
			for (const section of ["## Anti-patterns", "## Done when"]) if (!body.includes(section)) problems.push(`${name}: missing "${section}"`);
		}

		for (const [, path] of body.matchAll(/`((?:references|scripts|assets)\/[\w./-]+)`/g)) {
			if (!existsSync(join(dir, path))) problems.push(`${name}: references ${path}, which does not exist`);
		}
		for (const [, ref] of body.matchAll(/`((?:threejs|web3d)(?:-[\w-]+)?)`/g)) {
			if (!known.has(ref)) problems.push(`${name}: mentions skill \`${ref}\`, which does not exist`);
		}
		for (const [, ref] of (data.description ?? "").matchAll(/`([\w-]+)`/g)) {
			if (!known.has(ref) && !EXTERNAL_SKILLS.has(ref)) problems.push(`${name}: description mentions \`${ref}\`, which does not exist`);
		}
	}
	if (corpus > CORPUS_LIMIT) problems.push(`descriptions total ${corpus} characters (limit ${CORPUS_LIMIT})`);

	const profiles = JSON.parse(readFileSync(join(ROOT, "profiles.json"), "utf8")).profiles;
	for (const [profile, skills] of Object.entries(profiles)) {
		for (const skill of skills) if (!known.has(skill)) problems.push(`profiles.json: profile "${profile}" lists unknown skill "${skill}"`);
	}
	const listed = new Set(Object.values(profiles).flat());
	for (const name of names) if (!listed.has(name)) problems.push(`profiles.json: skill "${name}" is in no profile`);

	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	for (const manifest of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
		const plugin = JSON.parse(readFileSync(join(ROOT, manifest), "utf8"));
		if (plugin.version !== pkg.version) problems.push(`${manifest} version ${plugin.version} differs from package.json ${pkg.version}`);
	}
	JSON.parse(readFileSync(join(ROOT, ".agents", "plugins", "marketplace.json"), "utf8"));

	// Optional Codex UI metadata: the short description shows in pickers and should be 25-64 characters.
	for (const name of names) {
		const file = join(SKILLS_DIR, name, "agents", "openai.yaml");
		if (!existsSync(file)) continue;
		const short = /short_description:\s*"([^"]*)"/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
		if (short.length < 25 || short.length > 64)
			problems.push(`${name}: agents/openai.yaml short_description is ${short.length} characters (25-64)`);
		if (!readFileSync(file, "utf8").includes(`$${name}`)) problems.push(`${name}: agents/openai.yaml default_prompt does not mention $${name}`);
	}

	console.log(`${names.length} skills, ${corpus} description characters`);
	return problems;
}

const problems = validate();
for (const problem of problems) console.error(`✗ ${problem}`);
process.exitCode = problems.length > 0 ? 1 : 0;
if (problems.length === 0) console.log("✓ all skills valid");
