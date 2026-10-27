import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { recordCredit } from "../skills/threejs-assets/scripts/fetch.mjs";

test("credits accumulate, replace by file, and render attribution notes", () => {
	const dir = mkdtempSync(join(tmpdir(), "threejs-credits-"));
	const base = { source: "Sketchfab", url: "https://sketchfab.com/3d-models/x", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" };
	recordCredit(dir, { ...base, name: "Chair", file: "chair.glb", author: "A", license: "CC Attribution", attributionRequired: true });
	recordCredit(dir, { ...base, name: "Lamp", file: "lamp.glb", author: "B", license: "CC0 Public Domain", attributionRequired: false });
	recordCredit(dir, { ...base, name: "Chair v2", file: "chair.glb", author: "A", license: "CC Attribution", attributionRequired: true });

	const credits = JSON.parse(readFileSync(join(dir, "CREDITS.json"), "utf8"));
	assert.deepEqual(
		credits.map((credit) => credit.name),
		["Chair v2", "Lamp"],
	);
	assert.match(credits[0].downloaded, /^\d{4}-\d{2}-\d{2}$/);
	const markdown = readFileSync(join(dir, "CREDITS.md"), "utf8");
	assert.match(markdown, /\*\*Chair v2\*\*.*Attribution required\./);
	assert.doesNotMatch(
		markdown.split("\n").find((line) => line.includes("Lamp")),
		/Attribution required/,
	);
});
