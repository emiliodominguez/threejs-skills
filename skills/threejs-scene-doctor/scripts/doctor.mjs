#!/usr/bin/env node
// Diagnoses a running three.js app: opens the page headlessly, injects scene-doctor.js before any
// page script (so three.js hands it every renderer, scene and mixer through __THREE_DEVTOOLS__),
// waits, samples frames, and prints findings with renderer and scene stats. No app changes needed.
//
//   node doctor.mjs http://localhost:5173              # a dev server
//   node doctor.mjs dist/index.html                    # a built page, served from its folder
//   node doctor.mjs http://localhost:5173 --wait 8000 --sample 3000 --json
//   node doctor.mjs http://localhost:5173 --screenshot shot.png --click "#start"
//
// Frame times in a headless browser come from a software renderer; trust counts (draw calls,
// triangles, memory, findings) over fps, and confirm timing in a real browser.

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCTOR = fileURLToPath(new URL("../assets/scene-doctor.js", import.meta.url));

/**
 * Loads the render harness from threejs-model-inspect (installed next to this skill).
 * @returns {Promise<any>}
 */
async function harness() {
	try {
		return await import(new URL("../../threejs-model-inspect/scripts/render.mjs", import.meta.url).href);
	} catch {
		throw new Error("doctor.mjs needs threejs-model-inspect installed next to this skill (it provides the browser harness).");
	}
}

/**
 * Parses arguments, runs the diagnosis and prints it.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
	const args = argv.slice(2);
	const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
	const takesValue = new Set(["--wait", "--sample", "--screenshot", "--click", "--width", "--height"]);
	const target = args.find((arg, index) => !arg.startsWith("--") && !takesValue.has(args[index - 1]));
	if (!target || args.includes("--help")) {
		console.log("Usage: node doctor.mjs <url|file.html> [--wait ms] [--sample ms] [--click selector] [--screenshot out.png] [--json]");
		return target ? 0 : 1;
	}

	const { findBrowser, launch, startServer } = await harness();
	const executable = findBrowser();
	if (!executable) {
		console.error("No Chrome, Chromium or Edge found. Install one, run `npx playwright install chromium`, or set CHROME_PATH.");
		return 1;
	}

	let url = target;
	let server = null;
	if (!/^https?:\/\//.test(target)) {
		if (!existsSync(target)) {
			console.error(`Not a URL and not a file: ${target}`);
			return 1;
		}
		server = await startServer({ mounts: { "/": dirname(resolve(target)) }, three: null });
		url = `${server.origin}/${basename(target)}`;
	}

	const page = await launch(executable);
	const consoleErrors = [];
	page.on("Runtime.exceptionThrown", (params) => consoleErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text));
	page.on("Runtime.consoleAPICalled", (params) => {
		if (params.type === "error") consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
	});
	page.on("Log.entryAdded", (params) => {
		if (params.entry.level === "error" && !/favicon/.test(params.entry.url ?? "")) consoleErrors.push(`${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ""}`);
	});
	let result;
	try {
		await page.send("Runtime.enable");
		await page.send("Log.enable");
		await page.send("Page.enable");
		await page.send("Emulation.setDeviceMetricsOverride", { width: Number(value("--width") ?? 1280), height: Number(value("--height") ?? 800), deviceScaleFactor: 1, mobile: false });
		await page.send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(DOCTOR, "utf8") });
		await page.send("Page.navigate", { url });
		await new Promise((done) => setTimeout(done, Number(value("--wait") ?? 5000)));
		if (value("--click")) {
			await page.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(value("--click"))})?.click()` });
			await new Promise((done) => setTimeout(done, 2000));
		}
		const evaluation = await page.send("Runtime.evaluate", {
			expression: `window.threejsDoctor.report({ silent: true, sampleMs: ${Number(value("--sample") ?? 2000)} }).then((report) => JSON.stringify(report))`,
			awaitPromise: true,
			returnByValue: true,
		});
		result = JSON.parse(evaluation.result.value ?? "{}");
		if (value("--screenshot")) {
			const { data } = await page.send("Page.captureScreenshot", { format: "png" });
			writeFileSync(value("--screenshot"), Buffer.from(data, "base64"));
		}
	} finally {
		await page.close();
		await server?.close();
	}

	result.consoleErrors = [...new Set(consoleErrors)];
	if (args.includes("--json")) {
		console.log(JSON.stringify(result, null, "\t"));
	} else {
		const { renderer, scene, frames, findings } = result;
		if (renderer) {
			console.log(`${renderer.type} r${renderer.revision ?? "?"}: ${renderer.drawCalls} draw calls, ${renderer.triangles} triangles, ${renderer.programs} programs, pixel ratio ${renderer.pixelRatio}, buffer ${renderer.drawingBuffer?.width}x${renderer.drawingBuffer?.height}`);
			console.log(`GPU memory: ${renderer.geometriesInMemory} geometries, ${renderer.texturesInMemory} textures`);
		}
		if (scene) {
			console.log(
				`Scene: ${scene.objects} objects, ${scene.meshes} meshes, ${scene.materials} materials, ${scene.textures} textures (~${(scene.textureMemoryEstimate / 1024 / 1024).toFixed(0)} MB), ${scene.lights.length} lights, environment ${scene.environment ? "yes" : "no"}, ${scene.mixers.length} mixers`,
			);
		}
		if (frames) console.log(`Frames: ${frames.frames} sampled, average ${frames.averageMs} ms, p95 ${frames.p95Ms} ms, ${frames.longFrames} over 50 ms (headless: indicative only)`);
		for (const finding of findings ?? []) console.log(`[${finding.level}] ${finding.code}: ${finding.message}`);
		for (const error of result.consoleErrors) console.log(`console error: ${error}`);
		if ((findings ?? []).length === 0) console.log("No findings.");
		if (value("--screenshot")) console.log(`Screenshot: ${value("--screenshot")}`);
	}
	return (result.findings ?? []).some((finding) => finding.level === "error") ? 2 : 0;
}

// Compare real paths so the script also runs when invoked through a symlinked skill directory.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	process.exitCode = await main(process.argv);
}
