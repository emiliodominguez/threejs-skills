// three.js scene doctor: runtime diagnosis of a live three.js app (r186; WebGLRenderer, partial WebGPURenderer).
//
// Capture: when this script runs before three.js loads, it registers the official __THREE_DEVTOOLS__
// hook, so every renderer, scene and animation mixer the app creates is captured with no app changes
// (React Three Fiber included). doctor.mjs injects it that way.
//
// Use by hand:
//   - load before the app:  <script src="scene-doctor.js"></script>, then in the console: await threejsDoctor.report()
//   - or pass objects:      threejsDoctor.report({ renderer, scene, camera })
//
// report() returns { renderer, scene, frames, findings } and logs a table of findings.

(function install() {
	if (typeof window === "undefined" || window.threejsDoctor) return;

	const captured = { renderers: new Set(), scenes: new Set(), mixers: new Set(), revision: null, screenScene: null, screenCamera: null };

	/**
	 * Wraps a renderer's render() to remember which scene and camera reach the screen (not a render target).
	 * Environment generators such as RoomEnvironment are scenes too; this tells them apart from the app's scene.
	 * @param {any} renderer
	 */
	function trackScreenRenders(renderer) {
		const render = renderer.render;
		if (typeof render !== "function" || render.__doctorWrapped) return;
		const wrapped = function (scene, camera) {
			if (!this.getRenderTarget?.()) {
				captured.screenScene = scene;
				captured.screenCamera = camera;
			}
			return render.apply(this, arguments);
		};
		wrapped.__doctorWrapped = true;
		renderer.render = wrapped;
	}

	const hook = window.__THREE_DEVTOOLS__ ?? new EventTarget();
	hook.addEventListener("observe", (event) => {
		const object = event.detail;
		if (object?.isWebGLRenderer || object?.isWebGPURenderer || object?.isRenderer) {
			captured.renderers.add(object);
			trackScreenRenders(object);
		}
		else if (object?.isScene) captured.scenes.add(object);
		else if (object?.constructor?.name === "AnimationMixer" || typeof object?.clipAction === "function") captured.mixers.add(object);
	});
	hook.addEventListener("register", (event) => {
		captured.revision = event.detail?.revision ?? captured.revision;
	});
	window.__THREE_DEVTOOLS__ = hook;

	/**
	 * Measures frame times with requestAnimationFrame.
	 * @param {number} durationMs
	 * @returns {Promise<{ frames: number, averageMs: number, p95Ms: number, longFrames: number }>}
	 */
	function sampleFrames(durationMs) {
		return new Promise((done) => {
			const times = [];
			let last = performance.now();
			const end = last + durationMs;
			function tick(now) {
				times.push(now - last);
				last = now;
				if (now < end) requestAnimationFrame(tick);
				else {
					const sorted = [...times].sort((a, b) => a - b);
					done({
						frames: times.length,
						averageMs: Number((times.reduce((sum, value) => sum + value, 0) / times.length).toFixed(2)),
						p95Ms: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2)),
						longFrames: times.filter((value) => value > 50).length,
					});
				}
			}
			requestAnimationFrame(tick);
		});
	}

	/**
	 * Picks the scene that is actually rendered: the last one drawn to the screen, else the largest.
	 * @returns {any}
	 */
	function mainScene() {
		if (captured.screenScene) return captured.screenScene;
		let best = null;
		let bestCount = -1;
		for (const scene of captured.scenes) {
			let count = 0;
			scene.traverse(() => count++);
			if (count > bestCount) {
				best = scene;
				bestCount = count;
			}
		}
		return best;
	}

	/**
	 * Builds the diagnosis.
	 * @param {{ renderer?: any, scene?: any, camera?: any, sampleMs?: number }} [options]
	 * @returns {Promise<any>}
	 */
	async function report(options = {}) {
		const renderer = options.renderer ?? [...captured.renderers].at(-1);
		const scene = options.scene ?? mainScene();
		const findings = [];
		const add = (level, code, message) => findings.push({ level, code, message });
		if (!renderer && !scene) {
			return { findings: [{ level: "error", code: "nothing-captured", message: "No three.js renderer or scene captured. Load scene-doctor.js before three.js, or pass { renderer, scene }." }] };
		}

		const frames = await sampleFrames(options.sampleMs ?? 2000);
		const info = renderer?.info ?? {};
		const render = info.render ?? {};
		const memory = info.memory ?? {};
		const size = renderer?.domElement ? { width: renderer.domElement.width, height: renderer.domElement.height } : null;
		const pixelRatio = renderer?.getPixelRatio?.() ?? 1;
		const rendererReport = {
			type: renderer?.isWebGPURenderer ? "WebGPURenderer" : renderer?.isWebGLRenderer ? "WebGLRenderer" : "unknown",
			revision: captured.revision,
			drawCalls: render.calls ?? render.drawCalls ?? null,
			triangles: render.triangles ?? null,
			geometriesInMemory: memory.geometries ?? null,
			texturesInMemory: memory.textures ?? null,
			programs: info.programs?.length ?? null,
			pixelRatio,
			drawingBuffer: size,
			outputColorSpace: renderer?.outputColorSpace,
			toneMapping: renderer?.toneMapping,
			shadowMap: renderer?.shadowMap ? { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type } : null,
			maxTextureSize: renderer?.capabilities?.maxTextureSize ?? null,
		};

		// Scene walk.
		const geometries = new Set();
		const materials = new Set();
		const textures = new Map();
		const lights = [];
		const batches = new Map();
		let meshes = 0;
		let visibleMeshes = 0;
		let transparent = 0;
		let shadowCasters = 0;
		let noCulling = 0;
		let objects = 0;
		scene?.traverse((object) => {
			objects++;
			if (object.isLight) lights.push(object);
			if (!(object.isMesh || object.isPoints || object.isLine)) return;
			meshes++;
			if (object.visible) visibleMeshes++;
			if (object.castShadow) shadowCasters++;
			if (object.frustumCulled === false) noCulling++;
			if (object.geometry) geometries.add(object.geometry);
			for (const material of [].concat(object.material ?? [])) {
				materials.add(material);
				if (material.transparent) transparent++;
				for (const key of Object.keys(material)) {
					const value = material[key];
					if (value?.isTexture && !textures.has(value)) textures.set(value, key);
				}
			}
			if (object.isMesh && !object.isInstancedMesh && !object.isSkinnedMesh && object.geometry && !Array.isArray(object.material)) {
				const key = `${object.geometry.uuid}|${object.material?.uuid}`;
				batches.set(key, (batches.get(key) ?? 0) + 1);
			}
		});
		let textureBytes = 0;
		const largeTextures = [];
		const wrongColorSpace = [];
		for (const [texture, slot] of textures) {
			const image = texture.image ?? texture.source?.data;
			const width = image?.width ?? image?.videoWidth ?? 0;
			const height = image?.height ?? image?.videoHeight ?? 0;
			textureBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
			if (Math.max(width, height) > 2048) largeTextures.push(`${texture.name || slot} ${width}x${height}`);
			const isColor = slot === "map" || slot === "emissiveMap" || slot === "sheenColorMap" || slot === "specularColorMap";
			if (isColor && !texture.isCompressedTexture && !texture.isDataTexture && !texture.isRenderTargetTexture && texture.colorSpace !== "srgb") wrongColorSpace.push(`${texture.name || "(unnamed)"} on ${slot}`);
		}
		const sceneReport = {
			objects,
			meshes,
			visibleMeshes,
			geometries: geometries.size,
			materials: materials.size,
			textures: textures.size,
			textureMemoryEstimate: Math.round(textureBytes),
			lights: lights.map((light) => ({ type: light.type, intensity: light.intensity, castShadow: Boolean(light.castShadow), shadowMapSize: light.castShadow ? light.shadow?.mapSize?.toArray?.() : undefined })),
			environment: Boolean(scene?.environment),
			background: scene?.background ? (scene.background.isColor ? `#${scene.background.getHexString()}` : "texture") : null,
			transparentMaterials: transparent,
			mixers: [...captured.mixers].map((mixer) => ({ time: Number(mixer.time.toFixed(3)), actions: mixer._actions?.length ?? null, activeActions: mixer._nActiveActions ?? null })),
		};

		// Findings.
		if (frames.averageMs > 20) add("warn", "slow-frames", `Average frame ${frames.averageMs} ms (${(1000 / frames.averageMs).toFixed(0)} fps), p95 ${frames.p95Ms} ms. Headless browsers render on the CPU; confirm in a real browser before optimizing.`);
		if (frames.longFrames > 0) add("info", "long-frames", `${frames.longFrames} frame(s) over 50 ms while sampling: shader compiles, texture uploads or GC. Use renderer.compileAsync() before showing the scene.`);
		if (pixelRatio > 2) add("warn", "pixel-ratio", `Pixel ratio ${pixelRatio}: fill cost grows with its square. Cap it: renderer.setPixelRatio(Math.min(devicePixelRatio, 2)) (R3F: <Canvas dpr={[1, 2]}>).`);
		if (rendererReport.drawCalls > 300) add("warn", "draw-calls", `${rendererReport.drawCalls} draw calls in the last frame: CPU-bound on mobile. Merge static meshes, use InstancedMesh or BatchedMesh.`);
		if (rendererReport.triangles > 2_000_000) add("warn", "triangles", `${rendererReport.triangles.toLocaleString()} triangles per frame: simplify or add LODs.`);
		if (rendererReport.programs > 40) add("warn", "programs", `${rendererReport.programs} shader programs: every material variant compiles its own. Share materials and avoid toggling defines at runtime.`);
		const candidates = [...batches.values()].filter((count) => count >= 20);
		if (candidates.length > 0) add("warn", "instancing", `${candidates.length} geometry+material pair(s) drawn as ${candidates.join(", ")} separate meshes: use InstancedMesh for each.`);
		if (memory.geometries > geometries.size + 20) add("warn", "geometry-leak", `${memory.geometries} geometries on the GPU but ${geometries.size} in the scene: removed objects were not disposed (geometry.dispose()).`);
		if (memory.textures > textures.size + 10) add("warn", "texture-leak", `${memory.textures} textures on the GPU but ${textures.size} on scene materials: replaced or removed textures were not disposed (texture.dispose()). Some may be render targets or environment maps.`);
		const lit = [...materials].filter((material) => material.isMeshStandardMaterial || material.isMeshPhongMaterial || material.isMeshLambertMaterial || material.isMeshToonMaterial);
		if (lit.length > 0 && lights.length === 0 && !scene?.environment) add("error", "no-light", `${lit.length} lit material(s) but no lights and no scene.environment: everything renders black.`);
		const metals = lit.filter((material) => material.isMeshStandardMaterial && material.metalness >= 0.9 && !material.metalnessMap && !material.envMap);
		if (metals.length > 0 && !scene?.environment) add("warn", "metal-no-env", `${metals.length} metallic material(s) and no scene.environment: metals reflect only the environment and look black. Add RoomEnvironment or an HDR.`);
		if (wrongColorSpace.length > 0) add("warn", "texture-color-space", `${wrongColorSpace.length} color texture(s) not in SRGBColorSpace (${wrongColorSpace.slice(0, 3).join(", ")}): colors look washed out. Set texture.colorSpace = THREE.SRGBColorSpace.`);
		if (renderer?.outputColorSpace && renderer.outputColorSpace !== "srgb") add("warn", "output-color-space", `renderer.outputColorSpace is ${renderer.outputColorSpace}; leave it at SRGBColorSpace unless post-processing handles output.`);
		if (largeTextures.length > 0) add("info", "large-textures", `${largeTextures.length} texture(s) over 2048 px: ${largeTextures.slice(0, 3).join(", ")}.`);
		if (textureBytes > 512 * 1024 * 1024) add("warn", "texture-memory", `About ${(textureBytes / 1024 / 1024).toFixed(0)} MB of texture memory: risky on mobile. Use KTX2 or smaller textures.`);
		if (shadowCasters > 0 && renderer?.shadowMap && !renderer.shadowMap.enabled) add("warn", "shadows-disabled", `${shadowCasters} object(s) cast shadows but renderer.shadowMap.enabled is false.`);
		const shadowLights = lights.filter((light) => light.castShadow);
		if (shadowLights.length > 2) add("info", "shadow-lights", `${shadowLights.length} shadow-casting lights: each renders the scene again (point lights six times).`);
		for (const light of shadowLights) if (light.shadow?.mapSize?.x > 2048) add("info", "shadow-map-size", `${light.type} shadow map ${light.shadow.mapSize.x}px: 2048 is usually enough; fit the shadow camera instead.`);
		if (transparent > 30) add("info", "transparency", `${transparent} transparent meshes: sorted every frame and prone to artifacts. Use alphaTest for cutouts.`);
		if (noCulling > 50) add("info", "frustum-culling", `${noCulling} objects have frustumCulled = false: they render even off screen.`);
		const camera = options.camera ?? captured.screenCamera;
		if (camera?.isPerspectiveCamera && camera.far / camera.near > 1e5) add("warn", "depth-range", `Camera near ${camera.near} / far ${camera.far}: ratio ${(camera.far / camera.near).toExponential(1)} causes z-fighting. Raise near.`);
		for (const mixer of captured.mixers) {
			if ((mixer._nActiveActions ?? 0) > 0 && mixer.time === 0) add("error", "mixer-not-updated", "An AnimationMixer has playing actions but its time is 0: mixer.update(delta) is not called in the loop.");
		}
		if (captured.renderers.size > 1) add("info", "renderers", `${captured.renderers.size} renderers created: each owns a GL context (browsers allow about 16). Reuse one.`);

		const order = { error: 0, warn: 1, info: 2 };
		findings.sort((a, b) => order[a.level] - order[b.level]);
		const result = { renderer: rendererReport, scene: sceneReport, frames, findings };
		if (!options.silent) {
			console.log("[threejs-doctor]", result);
			console.table(findings);
		}
		return result;
	}

	/**
	 * Logs GPU memory growth every interval; growth with no scene change means a leak.
	 * @param {number} [intervalMs]
	 * @returns {() => void} stop function
	 */
	function watch(intervalMs = 5000) {
		const renderer = [...captured.renderers].at(-1);
		let last = { ...renderer?.info?.memory };
		const id = setInterval(() => {
			const now = { ...renderer?.info?.memory };
			console.log("[threejs-doctor] memory", now, "change", { geometries: now.geometries - last.geometries, textures: now.textures - last.textures });
			last = now;
		}, intervalMs);
		return () => clearInterval(id);
	}

	window.threejsDoctor = { report, watch, captured };
})();
