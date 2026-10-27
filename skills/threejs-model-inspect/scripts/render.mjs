#!/usr/bin/env node
// Renders a glTF/GLB model headlessly so an agent can look at it: a six-view contact sheet, or a
// before/after comparison with a pixel diff. Zero dependencies: it serves the bundled viewer from
// a local server and drives Chrome or Chromium over the DevTools protocol.
//
//   node render.mjs model.glb                          # writes model.sheet.png
//   node render.mjs model.glb --out shots/model.png --size 512
//   node render.mjs model.glb --clip Run --time 0.4    # pose an animation first
//   node render.mjs before.glb --compare after.glb     # writes before.compare.png, prints diff %
//   node render.mjs before.glb --compare after.glb --max-diff 2   # exit 3 when diff exceeds 2%
//
// Browser: set CHROME_PATH, or it searches common Chrome, Chromium, Edge and Playwright locations.
// three.js comes from node_modules/three next to the model or the working directory when present
// (offline-safe), otherwise from the jsDelivr CDN.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const VIEWER = fileURLToPath(new URL("../assets/viewer.html", import.meta.url));
const CDN_THREE = "https://cdn.jsdelivr.net/npm/three@0.186.1/";
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".json": "application/json",
	".wasm": "application/wasm",
	".glb": "model/gltf-binary",
	".gltf": "model/gltf+json",
	".bin": "application/octet-stream",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".avif": "image/avif",
	".ktx2": "image/ktx2",
	".hdr": "application/octet-stream",
	".css": "text/css",
};

/**
 * Finds a Chrome-family browser executable.
 * @returns {string | null}
 */
export function findBrowser() {
	if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
	const candidates = [
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/snap/bin/chromium",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	];
	for (const candidate of candidates) if (existsSync(candidate)) return candidate;

	// Playwright's browser cache, newest first.
	const caches = [join(homedir(), "Library", "Caches", "ms-playwright"), join(homedir(), ".cache", "ms-playwright"), join(homedir(), "AppData", "Local", "ms-playwright")];
	for (const cache of caches) {
		if (!existsSync(cache)) continue;
		const builds = readdirSync(cache)
			.filter((name) => /^chromium-\d+$/.test(name))
			.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
		for (const build of builds) {
			for (const relative of [
				"chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
				"chrome-mac/Chromium.app/Contents/MacOS/Chromium",
				"chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
				"chrome-linux/chrome",
				"chrome-linux64/chrome",
				"chrome-win/chrome.exe",
				"chrome-win64/chrome.exe",
			]) {
				const path = join(cache, build, relative);
				if (existsSync(path)) return path;
			}
		}
	}
	return null;
}

/**
 * Finds a local three package by walking up from each start directory.
 * @param {string[]} starts
 * @returns {string | null}
 */
export function findLocalThree(starts) {
	for (const start of starts) {
		let dir = resolve(start);
		while (true) {
			const candidate = join(dir, "node_modules", "three");
			if (existsSync(join(candidate, "build", "three.module.js"))) return candidate;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	return null;
}

/**
 * Starts a static server. Routes map a URL prefix to a directory; the viewer is served at /viewer.html
 * with its import map pointed at /three/ when a local three package is available.
 * @param {{ mounts: Record<string, string>, three: string | null, pages?: Record<string, string> }} options
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startServer({ mounts, three, pages = {} }) {
	const viewer = readFileSync(VIEWER, "utf8");
	const allMounts = { ...mounts };
	if (three) allMounts["/three/"] = three;

	const server = createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		const path = decodeURIComponent(url.pathname);
		if (path === "/viewer.html" || pages[path]) {
			let html = path === "/viewer.html" ? viewer : await readFile(pages[path], "utf8");
			if (three) html = html.replaceAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@[\d.]+\//g, "/three/");
			response.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
			response.end(html);
			return;
		}
		// Longest prefix first, so /three/ wins over a / mount.
		const prefix = Object.keys(allMounts)
			.sort((a, b) => b.length - a.length)
			.find((mount) => path.startsWith(mount));
		if (!prefix) {
			response.writeHead(404).end();
			return;
		}
		const root = resolve(allMounts[prefix]);
		const file = resolve(root, `.${sep}${path.slice(prefix.length)}`);
		if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "access-control-allow-origin": "*" });
		response.end(await readFile(file));
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const { port } = server.address();
	return {
		origin: `http://127.0.0.1:${port}`,
		close: () => new Promise((done) => server.close(() => done())),
	};
}

/**
 * Launches a headless browser with remote debugging and returns a page session.
 * @param {string} executable
 * @returns {Promise<{ send: (method: string, params?: object) => Promise<any>, on: (event: string, handler: (params: any) => void) => void, close: () => Promise<void> }>}
 */
export async function launch(executable) {
	const profile = mkdtempSync(join(tmpdir(), "threejs-render-"));
	const child = spawn(
		executable,
		[
			"--headless=new",
			"--remote-debugging-port=0",
			`--user-data-dir=${profile}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--hide-scrollbars",
			"--enable-unsafe-swiftshader",
			"--ignore-gpu-blocklist",
			"about:blank",
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	const browserUrl = await new Promise((done, fail) => {
		let output = "";
		const timeout = setTimeout(() => fail(new Error(`Browser did not start: ${output.slice(-400)}`)), 20000);
		child.stderr.on("data", (chunk) => {
			output += chunk;
			const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
			if (match) {
				clearTimeout(timeout);
				done(match[1]);
			}
		});
		child.on("exit", (code) => fail(new Error(`Browser exited with code ${code}: ${output.slice(-400)}`)));
	});

	const socket = new WebSocket(browserUrl);
	await new Promise((done, fail) => {
		socket.addEventListener("open", done, { once: true });
		socket.addEventListener("error", () => fail(new Error("Could not connect to the browser")), { once: true });
	});
	let nextId = 1;
	const pending = new Map();
	const listeners = new Map();
	let sessionId;
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.id && pending.has(message.id)) {
			const { done, fail } = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) fail(new Error(message.error.message));
			else done(message.result);
		} else if (message.method) {
			for (const handler of listeners.get(message.method) ?? []) handler(message.params);
		}
	});

	/**
	 * Sends a DevTools command, scoped to the page once attached.
	 * @param {string} method
	 * @param {object} [params]
	 * @param {boolean} [browserLevel]
	 * @returns {Promise<any>}
	 */
	function rawSend(method, params = {}, browserLevel = false) {
		const id = nextId++;
		socket.send(JSON.stringify({ id, method, params, ...(sessionId && !browserLevel ? { sessionId } : {}) }));
		return new Promise((done, fail) => pending.set(id, { done, fail }));
	}

	const { targetId } = await rawSend("Target.createTarget", { url: "about:blank" }, true);
	({ sessionId } = await rawSend("Target.attachToTarget", { targetId, flatten: true }, true));

	return {
		send: (method, params) => rawSend(method, params),
		on: (event, handler) => listeners.set(event, [...(listeners.get(event) ?? []), handler]),
		close: async () => {
			socket.close();
			child.kill();
		},
	};
}

/**
 * Opens a URL, waits for a global to be set (or a fixed time with waitMs, for pages that publish
 * nothing), screenshots the page, and returns the global's value with console errors.
 * @param {Awaited<ReturnType<typeof launch>>} page
 * @param {string} url
 * @param {{ resultExpression?: string, waitMs?: number, timeout?: number, width?: number, height?: number }} [options]
 * @returns {Promise<{ result: any, png: Buffer, consoleErrors: string[] }>}
 */
export async function capturePage(page, url, options = {}) {
	const { waitMs, timeout = 60000, width = 1280, height = 800 } = options;
	const resultExpression = waitMs ? `(performance.now() > ${waitMs} ? { ok: true } : null)` : (options.resultExpression ?? "window.__result");
	const consoleErrors = [];
	page.on("Runtime.exceptionThrown", (params) => consoleErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text));
	page.on("Runtime.consoleAPICalled", (params) => {
		if (params.type === "error") consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
	});
	page.on("Log.entryAdded", (params) => {
		if (params.entry.level === "error") consoleErrors.push(`${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ""}`);
	});
	await page.send("Runtime.enable");
	await page.send("Log.enable");
	await page.send("Page.enable");
	await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
	await page.send("Page.navigate", { url });

	const started = Date.now();
	let result;
	while (Date.now() - started < timeout) {
		const { result: value } = await page.send("Runtime.evaluate", { expression: `JSON.stringify(${resultExpression} ?? null)`, returnByValue: true });
		if (value.value && value.value !== "null") {
			result = JSON.parse(value.value);
			break;
		}
		await new Promise((done) => setTimeout(done, 150));
	}
	if (result === undefined) result = { ok: false, error: `Timed out after ${timeout} ms waiting for ${resultExpression}` };

	if (result.width && result.height) await page.send("Emulation.setDeviceMetricsOverride", { width: result.width, height: result.height, deviceScaleFactor: 1, mobile: false });
	const { data } = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
	return { result, png: Buffer.from(data, "base64"), consoleErrors };
}

/**
 * Parses arguments, renders, writes the image and prints a summary.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
	const args = argv.slice(2);
	if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
		console.log("Usage: node render.mjs <model> [--compare other] [--out file.png] [--size 384] [--clip name --time s] [--no-env] [--max-diff percent]");
		return args.length === 0 ? 1 : 0;
	}
	const valueOf = (flag) => {
		const index = args.indexOf(flag);
		return index >= 0 ? args[index + 1] : undefined;
	};
	const takesValue = new Set(["--compare", "--out", "--size", "--clip", "--time", "--max-diff"]);
	const model = args.find((arg, index) => !arg.startsWith("--") && !takesValue.has(args[index - 1]));
	if (!model || !existsSync(model)) {
		console.error(`Model not found: ${model ?? "(none given)"}`);
		return 1;
	}
	const compare = valueOf("--compare");
	if (compare && !existsSync(compare)) {
		console.error(`Comparison model not found: ${compare}`);
		return 1;
	}
	const executable = findBrowser();
	if (!executable) {
		console.error("No Chrome, Chromium or Edge found. Install one, run `npx playwright install chromium`, or set CHROME_PATH.");
		return 1;
	}

	const three = findLocalThree([dirname(model), process.cwd()]);
	const mounts = { "/a/": dirname(resolve(model)) };
	if (compare) mounts["/b/"] = dirname(resolve(compare));
	const server = await startServer({ mounts, three });
	const query = new URLSearchParams({ capture: compare ? "compare" : "sheet", model: `/a/${basename(model)}`, size: valueOf("--size") ?? "384" });
	if (compare) query.set("compare", `/b/${basename(compare)}`);
	if (valueOf("--clip")) query.set("clip", valueOf("--clip"));
	if (valueOf("--time")) query.set("time", valueOf("--time"));
	if (args.includes("--no-env")) query.set("env", "0");

	const page = await launch(executable);
	let capture;
	try {
		capture = await capturePage(page, `${server.origin}/viewer.html?${query}`);
	} finally {
		await page.close();
		await server.close();
	}

	const { result, png, consoleErrors } = capture;
	const out = valueOf("--out") ?? join(dirname(model), `${basename(model, extname(model))}.${compare ? "compare" : "sheet"}.png`);
	await mkdir(dirname(resolve(out)), { recursive: true });
	await writeFile(out, png);

	console.log(`three.js: ${three ? `local ${three}` : `CDN ${CDN_THREE}`}`);
	if (!result.ok) {
		console.error(`Render failed: ${result.error}`);
		for (const error of new Set(consoleErrors)) console.error(`  console: ${error}`);
		console.log(`Screenshot of the failure: ${out}`);
		return 1;
	}
	const describe = (label, facts) =>
		console.log(`${label}: ${facts.triangles} triangles, ${facts.drawCalls} draw calls, size [${facts.size.join(", ")}], center [${facts.center.join(", ")}]${facts.clips.length ? `, clips ${facts.clips.join(", ")}` : ""}`);
	describe(compare ? "A" : "model", result.model);
	if (compare) {
		describe("B", result.compare);
		console.log(`Pixel diff: ${result.diff.percent}% of covered pixels (per view: ${result.diff.perView.join("%, ")}%)`);
	}
	for (const error of new Set([...(result.errors ?? []), ...consoleErrors])) console.log(`console error: ${error}`);
	console.log(`Wrote ${out} (${result.width}x${result.height}). Open it to look at the model.`);

	const maxDiff = valueOf("--max-diff");
	if (compare && maxDiff !== undefined && result.diff.percent > Number(maxDiff)) {
		console.error(`Diff ${result.diff.percent}% exceeds --max-diff ${maxDiff}%.`);
		return 3;
	}
	return 0;
}

// Compare real paths so the script also runs when invoked through a symlinked skill directory.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	process.exitCode = await main(process.argv);
}
