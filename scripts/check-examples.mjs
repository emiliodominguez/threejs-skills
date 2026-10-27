#!/usr/bin/env node
// Renders every runnable example headlessly and checks it: no console errors, the page's own checks
// (window.__exampleResult.checks) all true, and enough of the canvas covered and lit. three.js comes
// from node_modules (offline); other libraries (gsap, rapier, model-viewer, spark) load from their CDNs.
//
//   node scripts/check-examples.mjs                # all examples except network-only ones
//   node scripts/check-examples.mjs --network      # include examples that fetch remote assets
//   node scripts/check-examples.mjs scroll-gsap    # one example; writes examples/<name>/check.png

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildFixtures } from "../evals/fixtures.mjs";
import { capturePage, findBrowser, findLocalThree, launch, startServer } from "../skills/threejs-model-inspect/scripts/render.mjs";
import { measureRender } from "./eval.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const EXAMPLES = join(ROOT, "examples");

/**
 * Checks one example and returns its result.
 * @param {string} name
 * @param {Record<string, string>} fixtures
 * @param {string} executable
 * @param {string | null} three
 * @returns {Promise<{ name: string, pass: boolean, problems: string[], stats: string }>}
 */
async function checkExample(name, fixtures, executable, three) {
	const source = join(EXAMPLES, name);
	const meta = JSON.parse(readFileSync(join(source, "example.json"), "utf8"));
	const dir = mkdtempSync(join(tmpdir(), `threejs-example-${name}-`));
	cpSync(source, dir, { recursive: true });
	for (const [file, fixture] of Object.entries(meta.fixtures ?? {})) cpSync(fixtures[fixture], join(dir, file));

	const server = await startServer({ mounts: { "/": dir }, three, pages: { "/index.html": join(dir, "index.html") } });
	const page = await launch(executable);
	const problems = [];
	let stats = "";
	try {
		const { result, png, consoleErrors } = await capturePage(page, `${server.origin}/index.html`, {
			resultExpression: "window.__exampleResult",
			width: 960,
			height: 600,
			timeout: meta.timeout ?? 30000,
		});
		writeFileSync(join(source, "check.png"), png);
		if (!result.ok) problems.push(result.error ?? "page reported failure");
		for (const [check, passed] of Object.entries(result.checks ?? {}))
			if (passed !== true) problems.push(`check ${check} is ${JSON.stringify(passed)}`);
		const errors = consoleErrors.filter((error) => !(meta.ignoreErrors ?? []).some((pattern) => new RegExp(pattern).test(error)));
		for (const error of new Set(errors)) problems.push(`console: ${error.slice(0, 200)}`);
		if (meta.minCoverage !== undefined || meta.minLuminance !== undefined) {
			const { coverage, luminance } = measureRender(png);
			stats = `coverage ${(coverage * 100).toFixed(1)}%, luminance ${luminance.toFixed(2)}`;
			if (coverage < (meta.minCoverage ?? 0)) problems.push(`coverage ${(coverage * 100).toFixed(1)}% < ${meta.minCoverage * 100}%`);
			if (luminance < (meta.minLuminance ?? 0) || luminance > (meta.maxLuminance ?? 1))
				problems.push(`luminance ${luminance.toFixed(2)} outside [${meta.minLuminance ?? 0}, ${meta.maxLuminance ?? 1}]`);
		}
	} catch (error) {
		problems.push(error.message);
	} finally {
		await page.close();
		await server.close();
	}
	return { name, pass: problems.length === 0, problems, stats };
}

/**
 * Runs the selected examples.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
	const args = argv.slice(2);
	const executable = findBrowser();
	if (!executable) {
		console.error("No Chrome-family browser found; set CHROME_PATH.");
		return 1;
	}
	const requested = args.filter((arg) => !arg.startsWith("--"));
	const names = readdirSync(EXAMPLES, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(EXAMPLES, entry.name, "example.json")))
		.map((entry) => entry.name)
		.filter((name) => (requested.length ? requested.includes(name) : true))
		.filter(
			(name) =>
				requested.length || args.includes("--network") || !JSON.parse(readFileSync(join(EXAMPLES, name, "example.json"), "utf8")).network,
		);
	const fixtures = await buildFixtures(mkdtempSync(join(tmpdir(), "threejs-example-fixtures-")));
	const three = findLocalThree([ROOT]);
	let failed = 0;
	for (const name of names) {
		const result = await checkExample(name, fixtures, executable, three);
		console.log(`${result.pass ? "PASS" : "FAIL"} ${name}${result.stats ? `  (${result.stats})` : ""}`);
		for (const problem of result.problems) console.log(`     ${problem}`);
		if (!result.pass) failed++;
	}
	console.log(`${names.length - failed}/${names.length} examples passed.`);
	return failed ? 1 : 0;
}

process.exitCode = await main(process.argv);
