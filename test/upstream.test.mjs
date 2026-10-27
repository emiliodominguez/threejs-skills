import assert from "node:assert/strict";
import { test } from "node:test";

import { identifiers, parseMigrationGuide, reapply } from "../scripts/check-upstream.mjs";

test("parses migration guide releases and their items", () => {
	const releases = parseMigrationGuide(
		"intro\n\n## 186 → 187\n\n- `Foo` was renamed.\n- Second item.\n\n## r160 → r161\n\n- `GroundProjectedSkybox` replaced.\n",
	);
	assert.deepEqual(
		releases.map(({ from, to, items }) => [from, to, items.length]),
		[
			[186, 187, 2],
			[160, 161, 1],
		],
	);
});

test("extracts changed API names and skips ubiquitous ones", () => {
	assert.deepEqual(identifiers("`WebGLRenderer.setViewport()` and `WebGLRenderer.setScissor()` no longer scale; a `Number` now."), [
		"setViewport",
		"setScissor",
	]);
	assert.deepEqual(
		identifiers("`renderer.library.addLight( CustomLightNode, CustomLight );` is now `CustomLight.registerNode( CustomLightNode );`"),
		["addLight", "registerNode"],
	);
});

test("reapply keeps our metadata and added See Also lines on top of upstream", () => {
	const upstream = '---\nname: threejs-loaders\ndescription: "Loading."\n---\n\n# Loaders\n\n## See Also\n\n- `threejs-textures` - textures\n';
	const ours =
		'---\nname: threejs-loaders\ndescription: "Loading."\nmetadata:\n  source: "old"\n---\n\n# Loaders\n\n## See Also\n\n- `threejs-textures` - textures\n- `threejs-model-inspect` - ours\n';
	const merged = reapply(upstream, ours, 'metadata:\n  source: "new"');
	assert.match(merged, /description: "Loading."\nmetadata:\n {2}source: "new"\n---/);
	assert.match(merged, /- `threejs-textures` - textures\n- `threejs-model-inspect` - ours\n$/);
	assert.equal(merged.match(/threejs-textures/g).length, 1);
});
