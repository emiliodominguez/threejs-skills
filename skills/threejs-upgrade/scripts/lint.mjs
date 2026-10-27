#!/usr/bin/env node
// Finds outdated three.js code: APIs that were removed, renamed or deprecated up to the target release,
// old import paths, and pre-release changes announced for the next one. Zero dependencies.
//
//   node lint.mjs                      # scan the current directory
//   node lint.mjs src --json           # machine-readable
//   node lint.mjs src --fix            # apply the safe one-to-one renames, then report the rest
//
// Exit code 1 when anything at level "removed" is found (code that breaks on the target release).
// Rules come from the official migration guide and the r186 source; each cites the release it changed in.
// Suppress with a "three-lint-disable-line" comment on a line, or "three-lint-disable-file" anywhere in a file.
// three-lint-disable-file (this file quotes every outdated API in its rule table)

import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TARGET = 186;

const EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".astro", ".html", ".glsl", ".frag", ".vert"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", ".svelte-kit", ".astro", "out", "coverage", ".vercel", ".turbo", "vendor"]);
const TSL = /from\s+["']three\/(tsl|webgpu)["']/;

/**
 * @typedef {object} Rule
 * @property {string} id
 * @property {RegExp} pattern
 * @property {"removed" | "deprecated" | "upcoming" | "outdated"} level
 * @property {number} since  release the change landed in
 * @property {string} message
 * @property {string} [replace]  replacement for the match when the rename is one-to-one and safe
 * @property {RegExp} [requires]  only check files whose content matches
 * @property {RegExp} [unless]  skip files whose content matches
 */

/** @type {Rule[]} */
export const RULES = [
	// Imports and builds
	{ id: "examples-js", pattern: /three\/examples\/js\//, level: "removed", since: 148, message: "examples/js was removed; import ES modules from three/addons/." },
	{ id: "examples-jsm-path", pattern: /three\/examples\/jsm\//, level: "outdated", since: 148, message: "Prefer the three/addons/ alias; examples/jsm paths do not resolve under the documented import map.", replace: "three/addons/" },
	{ id: "build-umd", pattern: /three(@[\d.]+)?\/build\/three(\.min)?\.js\b/, level: "removed", since: 161, message: "build/three.js and three.min.js were removed; use ES modules (three.module.js) with an import map or a bundler." },
	{ id: "nodes-import", pattern: /three\/(examples\/jsm\/)?nodes['"/]/, level: "removed", since: 167, message: "Node materials and TSL import from three/webgpu and three/tsl." },
	{ id: "webgpu-addon-import", pattern: /renderers\/webgpu\/WebGPURenderer(\.js)?/, level: "removed", since: 167, message: "Import WebGPURenderer from three/webgpu." },

	// Pre-BufferGeometry era
	{ id: "geometry-class", pattern: /\bnew\s+(THREE\.)?Geometry\s*\(/, level: "removed", since: 125, message: "Geometry was removed; use BufferGeometry." },
	{ id: "face3", pattern: /\b(THREE\.)?Face3\b/, level: "removed", since: 126, message: "Face3 was removed with Geometry; use BufferGeometry index and attributes." },
	{ id: "json-loader", pattern: /\b(THREE\.)?JSONLoader\b/, level: "removed", since: 99, message: "JSONLoader was removed; convert to glTF and use GLTFLoader." },
	{ id: "three-math", pattern: /\bTHREE\.Math\./, level: "removed", since: 113, message: "THREE.Math is THREE.MathUtils.", replace: "THREE.MathUtils." },
	{ id: "apply-matrix", pattern: /\.applyMatrix\s*\(/, level: "removed", since: 113, message: "Object3D/BufferGeometry.applyMatrix() is applyMatrix4().", replace: ".applyMatrix4(" },
	{ id: "font-in-core", pattern: /\bTHREE\.(FontLoader|TextGeometry|Font)\b/, level: "removed", since: 133, message: "FontLoader, Font and TextGeometry moved to addons: three/addons/loaders/FontLoader.js and three/addons/geometries/TextGeometry.js." },

	// Color management (r152)
	{ id: "output-encoding", pattern: /\boutputEncoding\b/, level: "removed", since: 152, message: "renderer.outputEncoding is renderer.outputColorSpace (default SRGBColorSpace; usually delete the line).", replace: "outputColorSpace" },
	{ id: "srgb-encoding", pattern: /\bsRGBEncoding\b/, level: "removed", since: 152, message: "sRGBEncoding is SRGBColorSpace.", replace: "SRGBColorSpace" },
	{ id: "linear-encoding", pattern: /\bLinearEncoding\b/, level: "removed", since: 152, message: "LinearEncoding is LinearSRGBColorSpace (for data textures, usually NoColorSpace).", replace: "LinearSRGBColorSpace" },
	{ id: "texture-encoding", pattern: /\.encoding\s*=(?!=)/, level: "removed", since: 152, message: "texture.encoding is texture.colorSpace.", replace: ".colorSpace =" },
	{ id: "color-management-legacy", pattern: /ColorManagement\.legacyMode/, level: "removed", since: 150, message: "ColorManagement.legacyMode = false is ColorManagement.enabled = true (the default; delete the line)." },
	{ id: "gamma-output", pattern: /\b(gammaOutput|gammaFactor|gammaInput)\b/, level: "removed", since: 112, message: "Gamma settings were removed; color management is automatic (outputColorSpace)." },
	{ id: "uv2-attribute", pattern: /(setAttribute|attributes)\s*[(.[]\s*["']?uv2["']?/, level: "removed", since: 152, message: "The second UV set is named uv1 now (uv, uv1, uv2, uv3); texture.channel selects it." },
	{ id: "working-color-space", pattern: /\b(fromWorkingColorSpace|toWorkingColorSpace)\b/, level: "removed", since: 177, message: "ColorManagement.fromWorkingColorSpace/toWorkingColorSpace are workingToColorSpace/colorSpaceToWorking." },

	// Lighting
	{ id: "physically-correct-lights", pattern: /\bphysicallyCorrectLights\b/, level: "removed", since: 150, message: "physicallyCorrectLights was removed; physical light units are always on. Re-tune intensities (multiply old values by about PI)." },
	{ id: "legacy-lights", pattern: /\buseLegacyLights\b/, level: "removed", since: 155, message: "useLegacyLights was deprecated in r155 and no longer exists; physical light units are always on. Delete the line and re-tune intensities." },
	{ id: "pcf-soft", pattern: /\bPCFSoftShadowMap\b/, level: "deprecated", since: 182, message: "PCFSoftShadowMap falls back to PCFShadowMap (now soft) with a warning.", replace: "PCFShadowMap" },
	// JS assignments only (`.envMapIntensity =`, `envMapIntensity:`); the GLSL uniform of the same name is fine.
	{
		id: "env-map-intensity",
		pattern: /\.envMapIntensity\s*=(?!=)|\benvMapIntensity\s*:/,
		level: "outdated",
		since: 163,
		message:
			"material.envMapIntensity has no effect unless the material has its own envMap: with scene.environment, WebGLRenderer uses scene.environmentIntensity instead. Assign material.envMap or scale scene.environmentIntensity.",
	},

	// Loaders
	{ id: "rgbe-loader", pattern: /\bRGBELoader\b/, level: "deprecated", since: 180, message: "RGBELoader is HDRLoader (three/addons/loaders/HDRLoader.js).", replace: "HDRLoader" },
	{ id: "rgbm-loader", pattern: /\bRGBMLoader\b/, level: "removed", since: 180, message: "RGBMLoader was removed; use HDRLoader, EXRLoader or UltraHDRLoader." },
	{ id: "basis-loader", pattern: /\bBasisTextureLoader\b/, level: "removed", since: 150, message: "BasisTextureLoader was removed; use KTX2 files with KTX2Loader." },
	{ id: "usdz-loader", pattern: /\bUSDZLoader\b/, level: "deprecated", since: 179, message: "USDZLoader is deprecated; use USDLoader." },
	{ id: "lottie-loader", pattern: /\bLottieLoader\b/, level: "removed", since: 176, message: "LottieLoader was deprecated in r176 and no longer ships; use lottie-web and a CanvasTexture." },
	{ id: "deprecated-loaders", pattern: /\b(LWOLoader|VTKLoader)\b/, level: "deprecated", since: 184, message: "LWOLoader (r185) and VTKLoader (r184) are deprecated and will be removed." },
	{ id: "draco-decoder-config", pattern: /\.setDecoderConfig\s*\(/, level: "deprecated", since: 185, message: "DRACOLoader.setDecoderConfig() is deprecated; DRACOLoader always uses WASM. Delete the call." },
	{ id: "ktx2-detect-async", pattern: /\.detectSupportAsync\s*\(/, level: "deprecated", since: 181, message: "detectSupportAsync() is deprecated; await renderer.init() then call detectSupport(renderer)." },
	{ id: "draco-exporter-parse", pattern: /DRACOExporter\(\)\s*\.parse\s*\(/, level: "removed", since: 185, message: "DRACOExporter.parse() is parseAsync()." },
	{ id: "svg-create-shapes", pattern: /SVGLoader\.createShapes\s*\(/, level: "deprecated", since: 185, message: "SVGLoader.createShapes(path) is path.toShapes()." },

	// Core API renames
	{ id: "clock", pattern: /\bnew\s+(THREE\.)?Clock\s*\(/, level: "deprecated", since: 183, message: "Clock is deprecated; use THREE.Timer: timer.update(timestamp) in the loop, then timer.getDelta(). Call timer.connect(document) to pause on hidden tabs." },
	{ id: "timer-addon", pattern: /addons\/misc\/Timer(\.js)?/, level: "removed", since: 179, message: "Timer is in core: import { Timer } from 'three'." },
	{ id: "merge-buffer-geometries", pattern: /\bmergeBufferGeometries\b/, level: "removed", since: 151, message: "mergeBufferGeometries is mergeGeometries.", replace: "mergeGeometries" },
	{ id: "merge-buffer-attributes", pattern: /\bmergeBufferAttributes\b/, level: "removed", since: 151, message: "mergeBufferAttributes is mergeAttributes.", replace: "mergeAttributes" },
	{ id: "bone-transform", pattern: /\.boneTransform\s*\(/, level: "removed", since: 151, message: "SkinnedMesh.boneTransform() is applyBoneTransform().", replace: ".applyBoneTransform(" },
	{ id: "update-range", pattern: /\.updateRange\b/, level: "removed", since: 159, message: "BufferAttribute.updateRange is addUpdateRange(start, count) / clearUpdateRanges()." },
	{ id: "grounded-skybox", pattern: /\b(GroundProjectedEnv|GroundProjectedSkybox)\b/, level: "removed", since: 161, message: "Use GroundedSkybox (three/addons/objects/GroundedSkybox.js).", replace: "GroundedSkybox" },
	{ id: "multiple-render-targets", pattern: /\bWebGLMultipleRenderTargets\b/, level: "removed", since: 162, message: "Use a render target with { count: n } for MRT." },
	{ id: "gouraud", pattern: /\bMeshGouraudMaterial\b/, level: "removed", since: 173, message: "MeshGouraudMaterial is gone; use MeshLambertMaterial.", replace: "MeshLambertMaterial" },
	{ id: "euler-default-order", pattern: /\bEuler\.DefaultOrder\b/, level: "removed", since: 149, message: "Euler.DefaultOrder is Euler.DEFAULT_ORDER.", replace: "Euler.DEFAULT_ORDER" },
	{ id: "object3d-default-up", pattern: /\bObject3D\.DefaultUp\b/, level: "removed", since: 149, message: "Object3D.DefaultUp is Object3D.DEFAULT_UP.", replace: "Object3D.DEFAULT_UP" },
	{ id: "two-pass-double-side", pattern: /\bTwoPassDoubleSide\b/, level: "removed", since: 149, message: "TwoPassDoubleSide was removed; transparent DoubleSide materials render in two passes by default." },
	{ id: "parse-animation", pattern: /AnimationClip\.parseAnimation\s*\(/, level: "deprecated", since: 175, message: "AnimationClip.parseAnimation() is deprecated; build clips from KeyframeTracks or load glTF." },
	{
		id: "light-probe-grid",
		pattern: /\bLightProbeGrid(Helper)?\b/,
		level: "removed",
		since: 186,
		message: "With WebGLRenderer, LightProbeGrid / LightProbeGridHelper are LightProbeGridWebGL / LightProbeGridHelperWebGL; the old names now belong to the WebGPU version.",
		unless: /three\/webgpu/,
	},
	{ id: "texture-source", pattern: /import\s*{[^}]*\bSource\b[^}]*}\s*from\s*["']three["']/, level: "deprecated", since: 186, message: "Source was renamed to TextureSource." },
	{ id: "simplify-modifier", pattern: /\.modify\s*\(/, level: "outdated", since: 186, message: "SimplifyModifier.modify() is async since r186 (meshoptimizer based): await it.", requires: /SimplifyModifier/ },
	{ id: "to-triangles-draw-mode", pattern: /\btoTrianglesDrawMode\s*\(/, level: "outdated", since: 186, message: "toTrianglesDrawMode() changes the geometry in place since r186; clone() first if you need the original." },
	{ id: "text-geometry-height", pattern: /\bheight\s*:/, level: "outdated", since: 163, message: "TextGeometry's extrusion option is depth, not height.", requires: /TextGeometry/ },
	{ id: "capsule-length", pattern: /\blength\s*:/, level: "outdated", since: 176, message: "CapsuleGeometry's length parameter is called height.", requires: /CapsuleGeometry/ },
	{ id: "transform-controls-add", pattern: /\bscene\.add\(\s*\w*[cC]ontrols\s*\)/, level: "removed", since: 169, message: "TransformControls is not an Object3D; add controls.getHelper() to the scene.", requires: /TransformControls/ },
	{ id: "drag-controls-activate", pattern: /\.(activate|deactivate)\s*\(\s*\)/, level: "removed", since: 168, message: "DragControls.activate()/deactivate() are connect()/disconnect().", requires: /DragControls/ },
	{ id: "pointer-lock-get-object", pattern: /\.getObject\s*\(\s*\)/, level: "removed", since: 168, message: "PointerLockControls.getObject() is controls.object.", requires: /PointerLockControls/ },
	{ id: "file-loader-return", pattern: /=\s*new\s+(THREE\.)?(FileLoader|ImageBitmapLoader)\([^)]*\)\s*\.load\s*\(/, level: "removed", since: 184, message: "FileLoader/ImageBitmapLoader.load() return nothing now; use the onLoad callback or loadAsync()." },
	{ id: "matrix3-transform", pattern: /\.(translate|scale|rotate)\s*\(/, level: "deprecated", since: 185, message: "Matrix3.translate()/scale()/rotate() are deprecated; use makeTranslation/makeScale/makeRotation and multiply.", requires: /new\s+(THREE\.)?Matrix3\s*\(/ },

	// WebGPURenderer and TSL
	{ id: "post-processing-class", pattern: /\bnew\s+(THREE\.)?PostProcessing\s*\(/, level: "deprecated", since: 183, message: "PostProcessing is RenderPipeline.", replace: "new RenderPipeline(" },
	{ id: "render-async", pattern: /\.(renderAsync|computeAsync|clearAsync|initTextureAsync|hasFeatureAsync)\s*\(/, level: "deprecated", since: 181, message: "The async WebGPURenderer methods are deprecated; await renderer.init() once (setAnimationLoop does it), then use the sync versions." },
	{ id: "wait-for-gpu", pattern: /\.waitForGPU\s*\(/, level: "removed", since: 181, message: "waitForGPU() was removed from WebGPURenderer." },
	{ id: "color-buffer-type", pattern: /\b(colorBufferType|getColorBufferType)\b/, level: "removed", since: 182, message: "colorBufferType/getColorBufferType() are outputBufferType/getOutputBufferType()." },
	{ id: "traa-pass-node", pattern: /\bTRAAPassNode\b/, level: "removed", since: 179, message: "TRAAPassNode is TRAANode with a new setup." },
	{ id: "tsl-pi2", pattern: /\bPI2\b/, level: "deprecated", since: 181, message: "TSL PI2 is TWO_PI.", replace: "TWO_PI", requires: TSL },
	{ id: "tsl-label", pattern: /\.label\s*\(/, level: "deprecated", since: 179, message: "TSL label() is setName() (label() still works but warns).", replace: ".setName(", requires: TSL },
	// The varying() and vertexStage() functions are current; r173 renamed only their method-chaining forms.
	{ id: "tsl-varying-chain", pattern: /\.(varying|vertexStage)\s*\(/, level: "removed", since: 173, message: "Chained node.varying()/node.vertexStage() are node.toVarying()/node.toVertexStage(); the varying(node) function form is unchanged.", requires: TSL },
	{ id: "tsl-fog", pattern: /\b(rangeFog|densityFog)\s*\(/, level: "removed", since: 172, message: "rangeFog/densityFog are fog(color, rangeFogFactor(near, far)) / fog(color, densityFogFactor(density)).", requires: TSL },
	{ id: "tsl-renames-172", pattern: /\b(materialAOMap|shadowWorldPosition|PostProcessingUtils)\b/, level: "removed", since: 172, message: "Renamed: materialAOMap -> materialAO, shadowWorldPosition -> shadowPositionWorld, PostProcessingUtils -> RendererUtils.", requires: TSL },
	{ id: "tsl-uniforms", pattern: /(?<![\w.])uniforms\s*\(/, level: "removed", since: 168, message: "TSL uniforms() is uniformArray().", requires: TSL },
	{ id: "tsl-viewport", pattern: /\b(viewportTopLeft|viewportBottomLeft)\b/, level: "removed", since: 168, message: "viewportTopLeft is viewportUV; viewportBottomLeft is viewportUV.flipY().", requires: TSL },
	{ id: "tsl-blend", pattern: /(?<![\w.])(burn|dodge|screen|overlay)\s*\(/, level: "removed", since: 171, message: "TSL blend functions are blendBurn/blendDodge/blendScreen/blendOverlay.", requires: TSL },
	{ id: "tsl-storage-object", pattern: /\bstorageObject\s*\(/, level: "removed", since: 171, message: "storageObject() is storage().setPBO(true).", requires: TSL },
	{ id: "tsl-texture-uv", pattern: /\.uv\s*\(/, level: "removed", since: 172, message: "TextureNode.uv() is sample().", requires: TSL },
	{ id: "tsl-direction-color", pattern: /\b(directionToColor|colorToDirection)\s*\(/, level: "deprecated", since: 185, message: "directionToColor/colorToDirection are packNormalToRGB/unpackRGBToNormal.", requires: TSL },
	{
		id: "glsl-inverse-transform-direction",
		pattern: /\binverseTransformDirection\s*\(/,
		level: "deprecated",
		since: 185,
		message:
			"GLSL inverseTransformDirection() is a deprecated alias: use transformNormalByInverseViewMatrix() for normals, transformDirectionByInverseViewMatrix() for directions. Both compute the same math, so either preserves behavior.",
	},
	// Only the WebGPU GTAONode changed; the WebGL GTAOPass shader still uses both uniforms.
	{
		id: "gtao-distance",
		pattern: /\b(distanceExponent|distanceFallOff)\b/,
		level: "deprecated",
		since: 186,
		message: "GTAONode distanceExponent/distanceFallOff have no effect since r186.",
		requires: /GTAONode|from\s+["']three\/(tsl|webgpu)["']/,
		unless: /GTAOPass/,
	},
	{ id: "webgpu-pcf-soft", pattern: /\bPCFSoftShadowMap\b/, level: "removed", since: 186, message: "PCFSoftShadowMap was removed from WebGPURenderer; use PCFShadowMap.", requires: /three\/webgpu/ },

	// Announced for r187 (in development)
	{ id: "next-cube-uv", pattern: /\bCubeUVReflectionMapping\b/, level: "upcoming", since: 187, message: "CubeUVReflectionMapping is removed in r187 (PMREMs become cube render targets)." },
	{ id: "next-iridescence-range", pattern: /\biridescenceThicknessRange\b/, level: "upcoming", since: 187, message: "iridescenceThicknessRange becomes iridescenceThicknessMinimum/iridescenceThicknessMaximum in r187." },
	{ id: "next-register-light", pattern: /library\.addLight\s*\(/, level: "upcoming", since: 187, message: "renderer.library.addLight(Node, Light) becomes Light.registerNode(Node) in r187." },
	{
		id: "next-pixelation-size",
		pattern: /pixelationPass\s*\([^)]*\b(uniform|float|int)\s*\(/,
		level: "upcoming",
		since: 187,
		message: "pixelationPass() takes a plain number for pixelSize in r187; node values are no longer supported.",
	},
	{
		id: "next-viewport-scale",
		pattern: /\.(setViewport|setScissor)\s*\(/,
		level: "upcoming",
		since: 187,
		message: "In r187 setViewport()/setScissor() no longer scale by pixel ratio while a render target is bound; check render-target code.",
		requires: /setRenderTarget\s*\(/,
	},
];

const LEVEL_ORDER = { removed: 0, deprecated: 1, outdated: 2, upcoming: 3 };

/**
 * Lists files to scan under a path.
 * @param {string} root
 * @param {{ markdown?: boolean }} [options]
 * @returns {string[]}
 */
export function listFiles(root, options = {}) {
	const stats = statSync(root);
	if (stats.isFile()) return [root];
	const files = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name.startsWith(".") && entry.name !== ".") continue;
		const path = join(root, entry.name);
		const extension = extname(entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) files.push(...listFiles(path, options));
		} else if ((EXTENSIONS.has(extension) || (options.markdown && extension === ".md")) && !/\.min\.js$/.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

/**
 * Blanks everything in a Markdown file except fenced code blocks, keeping line numbers.
 * @param {string} text
 * @returns {string}
 */
export function codeBlocksOnly(text) {
	let inside = false;
	return text
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				inside = !inside;
				return "";
			}
			return inside ? line : "";
		})
		.join("\n");
}

/**
 * Tells whether a rule applies to a file, given its requires and unless gates.
 * @param {Rule} rule
 * @param {string} text
 * @returns {boolean}
 */
function appliesTo(rule, text) {
	return (!rule.requires || rule.requires.test(text)) && (!rule.unless || !rule.unless.test(text));
}

/**
 * Checks one file's text against every rule.
 * @param {string} text
 * @returns {{ rule: Rule, line: number, column: number, source: string }[]}
 */
export function lintText(text) {
	const findings = [];
	const lines = text.split("\n");
	const active = RULES.filter((rule) => appliesTo(rule, text));
	lines.forEach((line, index) => {
		const trimmed = line.trim();
		if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || line.includes("three-lint-disable-line")) return;
		for (const rule of active) {
			const match = rule.pattern.exec(line);
			if (match) findings.push({ rule, line: index + 1, column: match.index + 1, source: trimmed.slice(0, 140) });
		}
	});
	// The WebGPU variant of a rule supersedes the generic one on the same line.
	return findings.filter((finding) => !(finding.rule.id === "pcf-soft" && findings.some((other) => other.rule.id === "webgpu-pcf-soft" && other.line === finding.line)));
}

/**
 * Applies the safe one-to-one replacements to a file's text.
 * @param {string} text
 * @returns {{ text: string, count: number }}
 */
export function fixText(text) {
	let count = 0;
	const lines = text.split("\n").map((line) => {
		const trimmed = line.trim();
		if (trimmed.startsWith("//") || trimmed.startsWith("*")) return line;
		let next = line;
		for (const rule of RULES) {
			if (!rule.replace || !appliesTo(rule, text)) continue;
			const global = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
			next = next.replace(global, () => {
				count++;
				return rule.replace;
			});
		}
		return next;
	});
	return { text: lines.join("\n"), count };
}

/**
 * Reads the three, @react-three/fiber and @react-three/drei versions from the nearest package.json.
 * @param {string} start
 * @returns {{ file: string, three?: string, fiber?: string, drei?: string, react?: string } | null}
 */
export function readVersions(start) {
	let dir = resolve(start);
	if (statSync(dir).isFile()) dir = resolve(dir, "..");
	while (true) {
		const file = join(dir, "package.json");
		try {
			const pkg = JSON.parse(readFileSync(file, "utf8"));
			const deps = { ...pkg.devDependencies, ...pkg.dependencies };
			if (deps.three || deps["@react-three/fiber"]) return { file, three: deps.three, fiber: deps["@react-three/fiber"], drei: deps["@react-three/drei"], react: deps.react };
		} catch {
			// no package.json here
		}
		const parent = resolve(dir, "..");
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Turns dependency versions into upgrade advice.
 * @param {ReturnType<typeof readVersions>} versions
 * @returns {string[]}
 */
export function versionAdvice(versions) {
	if (!versions) return [];
	const advice = [];
	const major = (range) => Number(/(\d+)\.(\d+)/.exec(range ?? "")?.[1]);
	const minor = (range) => Number(/\d+\.(\d+)/.exec(range ?? "")?.[1]);
	if (versions.three) {
		const release = minor(versions.three);
		if (release && release < TARGET) {
			advice.push(`three ${versions.three} is r${release}; these skills target r${TARGET}.${TARGET - release > 10 ? " Upgrade in steps of about 10 releases: deprecation warnings last 10 releases, so each step tells you what the next one removes." : ""}`);
		}
	}
	if (versions.fiber && major(versions.fiber) < 9) advice.push(`@react-three/fiber ${versions.fiber}: v9 pairs with React 19; v8 with React 18. Upgrade fiber and react together.`);
	if (versions.fiber && major(versions.fiber) >= 9 && versions.react && major(versions.react) < 19) advice.push(`@react-three/fiber ${versions.fiber} needs React 19, but react is ${versions.react}.`);
	if (versions.drei && major(versions.drei) < 10 && major(versions.fiber) >= 9) advice.push(`@react-three/drei ${versions.drei} predates fiber 9; use drei 10.`);
	return advice;
}

/**
 * Parses arguments, scans and prints findings.
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
	const args = argv.slice(2);
	if (args.includes("-h") || args.includes("--help")) {
		console.log("Usage: node lint.mjs [path...] [--json] [--fix] [--md] [--level removed|deprecated|outdated|upcoming]");
		return 0;
	}
	const json = args.includes("--json");
	const fix = args.includes("--fix");
	const markdown = args.includes("--md");
	const levelIndex = args.indexOf("--level");
	const minLevel = levelIndex >= 0 ? args[levelIndex + 1] : "upcoming";
	const roots = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--level");
	if (roots.length === 0) roots.push(".");

	let fixed = 0;
	const results = [];
	for (const root of roots) {
		for (const file of listFiles(root, { markdown })) {
			const isMarkdown = file.endsWith(".md");
			let text = readFileSync(file, "utf8");
			if (!/three|@react-three|THREE|tsl/.test(text) || text.includes("three-lint-disable-file")) continue;
			// Markdown: lint only fenced code, never rewrite prose (Common Mistakes lists quote old APIs on purpose).
			if (isMarkdown) text = codeBlocksOnly(text);
			if (fix && !isMarkdown) {
				const result = fixText(text);
				if (result.count > 0) {
					writeFileSync(file, result.text);
					fixed += result.count;
					text = result.text;
				}
			}
			for (const finding of lintText(text)) {
				if (LEVEL_ORDER[finding.rule.level] <= LEVEL_ORDER[minLevel]) results.push({ file: relative(process.cwd(), file), ...finding });
			}
		}
	}
	const versions = readVersions(roots[0]);
	const advice = versionAdvice(versions);
	results.sort((a, b) => LEVEL_ORDER[a.rule.level] - LEVEL_ORDER[b.rule.level] || a.file.localeCompare(b.file) || a.line - b.line);

	if (json) {
		console.log(
			JSON.stringify(
				{
					target: `r${TARGET}`,
					versions,
					advice,
					fixed,
					findings: results.map(({ file, line, column, source, rule }) => ({ file, line, column, source, id: rule.id, level: rule.level, since: `r${rule.since}`, message: rule.message, autofix: Boolean(rule.replace) })),
				},
				null,
				"\t",
			),
		);
	} else {
		if (versions) console.log(`${relative(process.cwd(), versions.file) || "package.json"}: three ${versions.three ?? "-"}, fiber ${versions.fiber ?? "-"}, drei ${versions.drei ?? "-"}, react ${versions.react ?? "-"}`);
		for (const line of advice) console.log(`! ${line}`);
		if (fix) console.log(`Applied ${fixed} safe rename(s).`);
		for (const result of results) {
			console.log(`${result.file}:${result.line}:${result.column} [${result.rule.level} r${result.rule.since}] ${result.rule.id}: ${result.rule.message}${result.rule.replace && !fix ? " (--fix)" : ""}`);
			console.log(`    ${result.source}`);
		}
		const counts = Object.keys(LEVEL_ORDER).map((level) => `${results.filter((result) => result.rule.level === level).length} ${level}`);
		console.log(`${results.length === 0 ? "No outdated three.js code found" : counts.join(", ")} (target r${TARGET}).`);
	}
	return results.some((result) => result.rule.level === "removed") ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	process.exitCode = main(process.argv);
}
