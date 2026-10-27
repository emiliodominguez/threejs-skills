#!/usr/bin/env node
// Runs coding agents on the tasks in evals/tasks.json, with and without these skills, in throwaway
// projects, and grades the outcome: renders of the resulting page, file checks, the linter, and the
// agent's answer. Agent runs cost tokens; start small.
//
//   node scripts/eval.mjs --list
//   node scripts/eval.mjs --task fix-black                      # Claude Code, with and without skills, 1 run each
//   node scripts/eval.mjs --agent codex --task fix-black,upgrade-code --runs 3
//   node scripts/eval.mjs --all --runs 3 --condition with       # only the with-skills condition
//   node scripts/eval.mjs --setup-only --task fix-black                # create the project, no agent
//   node scripts/eval.mjs --grade-only <projectDir> --task fix-black   # re-grade an existing project
//
// Results go to evals/results/<timestamp>.json; projects stay in the temp directory printed per run.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { inflateSync } from "node:zlib";

import { buildFixtures } from "../evals/fixtures.mjs";
import { capturePage, findBrowser, launch, startServer } from "../skills/threejs-model-inspect/scripts/render.mjs";
import { lintText } from "../skills/threejs-upgrade/scripts/lint.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const TASKS = JSON.parse(readFileSync(join(ROOT, "evals", "tasks.json"), "utf8")).tasks;
const SCAFFOLD = join(ROOT, "evals", "scaffold");
const TIMEOUT_MS = 15 * 60 * 1000;
const SKILL_DIRS = { claude: ".claude/skills", codex: ".agents/skills" };

/**
 * Hashes a file's contents.
 * @param {string} path
 * @returns {string}
 */
function hash(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Decodes an 8-bit RGB or RGBA, non-interlaced PNG (what Chrome screenshots produce).
 * @param {Buffer} png
 * @returns {{ width: number, height: number, channels: number, pixels: Uint8Array }}
 */
export function decodePng(png) {
	let offset = 8;
	let width = 0;
	let height = 0;
	let channels = 4;
	const idat = [];
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.toString("ascii", offset + 4, offset + 8);
		const data = png.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			if (data[8] !== 8 || data[12] !== 0) throw new Error("Only 8-bit non-interlaced PNGs are supported");
			channels = { 2: 3, 6: 4 }[data[9]];
			if (!channels) throw new Error(`Unsupported PNG color type ${data[9]}`);
		} else if (type === "IDAT") {
			idat.push(data);
		}
		offset += 12 + length;
	}
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const pixels = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? pixels[y * stride + x - channels] : 0;
			const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
			const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
			let value = line[x];
			if (filter === 1) value += left;
			else if (filter === 2) value += up;
			else if (filter === 3) value += Math.floor((left + up) / 2);
			else if (filter === 4) {
				const p = left + up - upLeft;
				const pa = Math.abs(p - left);
				const pb = Math.abs(p - up);
				const pc = Math.abs(p - upLeft);
				value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
			}
			pixels[y * stride + x] = value & 0xff;
		}
	}
	return { width, height, channels, pixels };
}

/**
 * Measures how much of a screenshot differs from its background (sampled at the corners) and how
 * bright those pixels are.
 * @param {Buffer} png
 * @returns {{ coverage: number, luminance: number }}
 */
export function measureRender(png) {
	const { width, height, channels, pixels } = decodePng(png);
	const at = (x, y) => pixels.subarray((y * width + x) * channels, (y * width + x) * channels + 3);
	const corners = [at(2, 2), at(width - 3, 2), at(2, height - 3), at(width - 3, height - 3)];
	const background = [0, 1, 2].map((channel) => corners.reduce((sum, corner) => sum + corner[channel], 0) / corners.length);
	let covered = 0;
	let luminance = 0;
	for (let i = 0; i < width * height; i++) {
		const r = pixels[i * channels];
		const g = pixels[i * channels + 1];
		const b = pixels[i * channels + 2];
		if (Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) > 24) {
			covered++;
			luminance += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
		}
	}
	return { coverage: covered / (width * height), luminance: covered ? luminance / covered : 0 };
}

/**
 * Creates a throwaway project for a task, optionally with the skills installed for the agent.
 * @param {any} task
 * @param {Record<string, string>} fixtures
 * @param {{ agent: string, withSkills: boolean }} options
 * @returns {{ dir: string, model: string }}
 */
function createProject(task, fixtures, { agent, withSkills }) {
	const dir = mkdtempSync(join(tmpdir(), `threejs-eval-${task.id}-`));
	const fixture = fixtures[task.fixture];
	const model = basename(fixture);
	cpSync(fixture, join(dir, model));
	writeFileSync(join(dir, "index.html"), readFileSync(join(SCAFFOLD, "index.html"), "utf8"));
	const source = task.scaffold === "legacy" ? "legacy.js" : "main.js";
	writeFileSync(join(dir, "main.js"), readFileSync(join(SCAFFOLD, source), "utf8").replaceAll("MODEL", model));
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: `eval-${task.id}`, private: true, type: "module", dependencies: { three: "0.186.1" } }, null, "\t"),
	);
	if (withSkills)
		cpSync(join(ROOT, "skills"), join(dir, SKILL_DIRS[agent]), { recursive: true, filter: (path) => !basename(path).startsWith(".") });
	return { dir, model };
}

/**
 * Runs an agent non-interactively in a project directory.
 * @param {string} agent
 * @param {string} dir
 * @param {string} prompt
 * @param {string | undefined} model
 * @returns {Promise<{ answer: string, exitCode: number | null, seconds: number }>}
 */
function runAgent(agent, dir, prompt, model) {
	const started = Date.now();
	const [command, args] =
		agent === "codex"
			? ["codex", ["exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", dir, ...(model ? ["-m", model] : []), prompt]]
			: ["claude", ["-p", prompt, "--dangerously-skip-permissions", "--output-format", "text", ...(model ? ["--model", model] : [])]];
	return new Promise((done) => {
		const child = spawn(command, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
		child.on("close", (exitCode) => {
			clearTimeout(timer);
			done({ answer: output, exitCode, seconds: Math.round((Date.now() - started) / 1000) });
		});
	});
}

/**
 * Renders a project's index.html headlessly and measures the result.
 * @param {string} dir
 * @returns {Promise<{ coverage: number, luminance: number, consoleErrors: string[], png: Buffer }>}
 */
async function renderProject(dir) {
	const executable = findBrowser();
	if (!executable) throw new Error("No Chrome-family browser for render checks");
	const server = await startServer({ mounts: { "/": dir }, three: null });
	const page = await launch(executable);
	try {
		// The page publishes no result: give it time to load the CDN modules and the model, then capture.
		const { png, consoleErrors } = await capturePage(page, `${server.origin}/index.html`, {
			waitMs: 5000,
			width: 960,
			height: 600,
			timeout: 30000,
		});
		return { ...measureRender(png), consoleErrors, png };
	} finally {
		await page.close();
		await server.close();
	}
}

/**
 * Grades a finished project against a task's checks.
 * @param {any} task
 * @param {string} dir
 * @param {{ model: string, modelHash: string, answer: string }} context
 * @returns {Promise<{ label: string, pass: boolean, detail: string }[]>}
 */
async function grade(task, dir, context) {
	const results = [];
	let rendered;
	const needsRender = task.checks.some((check) => check.type === "render" || check.type === "no-console-errors");
	if (needsRender) {
		try {
			rendered = await renderProject(dir);
			writeFileSync(join(dir, "eval-render.png"), rendered.png);
		} catch (error) {
			rendered = { error: error.message, coverage: 0, luminance: 0, consoleErrors: [error.message] };
		}
	}
	const read = (file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : "");
	for (const check of task.checks) {
		const label = check.label ?? check.type;
		if (check.type === "unchanged") {
			const same = existsSync(join(dir, context.model)) && hash(join(dir, context.model)) === context.modelHash;
			results.push({ label: `${context.model} unchanged`, pass: same, detail: same ? "" : "model file was modified or removed" });
		} else if (check.type === "render") {
			const okCoverage = rendered.coverage >= (check.minCoverage ?? 0) && rendered.coverage <= (check.maxCoverage ?? 1);
			const okLuminance = rendered.luminance >= (check.minLuminance ?? 0) && rendered.luminance <= (check.maxLuminance ?? 1);
			results.push({
				label,
				pass: okCoverage && okLuminance,
				detail: `coverage ${(rendered.coverage * 100).toFixed(1)}%, luminance ${rendered.luminance.toFixed(2)}`,
			});
		} else if (check.type === "no-console-errors") {
			const errors = (rendered.consoleErrors ?? []).filter((error) => !/favicon/.test(error));
			results.push({ label: "no console errors", pass: errors.length === 0, detail: errors.slice(0, 3).join(" | ") });
		} else if (check.type === "file-matches" || check.type === "file-not-matches") {
			const matches = new RegExp(check.pattern, check.flags).test(read(check.file));
			results.push({ label, pass: check.type === "file-matches" ? matches : !matches, detail: `${check.file} /${check.pattern}/` });
		} else if (check.type === "lint-clean") {
			const order = { removed: 0, deprecated: 1, outdated: 2, upcoming: 3 };
			const findings = lintText(read("main.js")).filter((finding) => order[finding.rule.level] <= order[check.level ?? "removed"]);
			results.push({ label, pass: findings.length === 0, detail: findings.map((finding) => finding.rule.id).join(", ") });
		} else if (check.type === "answer-matches") {
			results.push({ label, pass: new RegExp(check.pattern, check.flags).test(context.answer), detail: `/${check.pattern}/` });
		}
	}
	return results;
}

/**
 * Parses arguments and runs the requested evaluations.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
	const args = argv.slice(2);
	const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
	if (args.includes("--list") || args.length === 0) {
		for (const task of TASKS) console.log(`${task.id.padEnd(18)} ${task.skill.padEnd(26)} ${task.prompt}`);
		return 0;
	}
	const agent = value("--agent") ?? "claude";
	const model = value("--model");
	const runs = Number(value("--runs") ?? 1);
	const condition = value("--condition") ?? "both";
	const selected = args.includes("--all") ? TASKS : TASKS.filter((task) => (value("--task") ?? "").split(",").includes(task.id));
	if (selected.length === 0) {
		console.error("No tasks selected. Use --task id[,id] or --all (see --list).");
		return 1;
	}
	const fixtures = await buildFixtures(mkdtempSync(join(tmpdir(), "threejs-eval-fixtures-")));

	if (args.includes("--setup-only")) {
		for (const task of selected) console.log(`${task.id}: ${createProject(task, fixtures, { agent, withSkills: condition !== "without" }).dir}`);
		return 0;
	}

	if (value("--grade-only")) {
		const dir = value("--grade-only");
		const task = selected[0];
		const model = basename(fixtures[task.fixture]);
		const checks = await grade(task, dir, {
			model,
			modelHash: hash(fixtures[task.fixture]),
			answer: existsSync(join(dir, "eval-answer.txt")) ? readFileSync(join(dir, "eval-answer.txt"), "utf8") : "",
		});
		for (const check of checks) console.log(`${check.pass ? "PASS" : "FAIL"} ${check.label} ${check.detail}`);
		return checks.every((check) => check.pass) ? 0 : 1;
	}

	const conditions = condition === "both" ? [true, false] : [condition === "with"];
	const records = [];
	for (const task of selected) {
		for (const withSkills of conditions) {
			for (let run = 1; run <= runs; run++) {
				const { dir, model: modelFile } = createProject(task, fixtures, { agent, withSkills });
				const label = `${task.id} ${withSkills ? "with" : "without"} skills, run ${run}`;
				console.log(`\n> ${label} (${dir})`);
				const { answer, exitCode, seconds } = await runAgent(agent, dir, task.prompt, model);
				writeFileSync(join(dir, "eval-answer.txt"), answer);
				const checks = await grade(task, dir, { model: modelFile, modelHash: hash(fixtures[task.fixture]), answer });
				const passed = checks.filter((check) => check.pass).length;
				for (const check of checks)
					console.log(`  ${check.pass ? "PASS" : "FAIL"} ${check.label}${check.detail ? `  (${check.detail})` : ""}`);
				console.log(`  ${passed}/${checks.length} checks, ${seconds}s, agent exit ${exitCode}`);
				records.push({
					task: task.id,
					skill: task.skill,
					withSkills,
					run,
					agent,
					model: model ?? "default",
					dir,
					seconds,
					exitCode,
					passed,
					total: checks.length,
					success: passed === checks.length,
					checks,
				});
			}
		}
	}

	console.log("\nSummary (tasks fully passed / runs):");
	for (const task of selected) {
		const line = conditions.map((withSkills) => {
			const subset = records.filter((record) => record.task === task.id && record.withSkills === withSkills);
			return `${withSkills ? "with" : "without"} ${subset.filter((record) => record.success).length}/${subset.length}`;
		});
		console.log(`  ${task.id.padEnd(18)} ${line.join("   ")}`);
	}
	const resultsDir = join(ROOT, "evals", "results");
	mkdirSync(resultsDir, { recursive: true });
	const file = join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
	writeFileSync(file, JSON.stringify({ agent, model: model ?? "default", runs, records }, null, "\t"));
	console.log(`\nWrote ${file}`);
	return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
	process.exitCode = await main(process.argv);
}
