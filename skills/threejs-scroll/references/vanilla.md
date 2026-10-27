# Vanilla three.js with GSAP ScrollTrigger (gsap 3.15, three r186)

GSAP and all its plugins are free, including commercial use. Install with `npm i gsap`, or use an import map.

## Contents

1. Page structure
2. Camera path from a timeline
3. Scrubbing an animation clip
4. Pinned sections and HTML overlays
5. Reduced motion and mobile
6. Smooth scrolling with Lenis

## 1. Page structure

The canvas is fixed behind normal document content; the document's height is the scroll length.

```html
<style>
	canvas.webgl { position: fixed; inset: 0; width: 100%; height: 100%; z-index: -1; }
	section { min-height: 100vh; display: grid; align-items: center; padding: 0 8vw; }
</style>
<canvas class="webgl"></canvas>
<main id="story">
	<section id="intro"><h1>Meet the speaker</h1></section>
	<section id="detail"><h2>Machined aluminium</h2></section>
	<section id="outro"><h2>Available now</h2></section>
</main>
<script type="importmap">
	{
		"imports": {
			"three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
			"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/",
			"gsap": "https://cdn.jsdelivr.net/npm/gsap@3.15.0/index.js",
			"gsap/": "https://cdn.jsdelivr.net/npm/gsap@3.15.0/"
		}
	}
</script>
```

## 2. Camera path from a timeline

Tween plain objects (camera position and a look-at target), and apply them in the frame loop.

```js
import * as THREE from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger.js";
gsap.registerPlugin(ScrollTrigger);

const canvas = document.querySelector("canvas.webgl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
const target = new THREE.Vector3(0, 0, 0);
camera.position.set(0, 0.2, 3);

const story = gsap.timeline({
	defaults: { ease: "none" }, // linear in progress; the scrub provides the easing
	scrollTrigger: { trigger: "#story", start: "top top", end: "bottom bottom", scrub: 1 },
});
// Each section is one unit of timeline time.
story
	.to(camera.position, { x: 1.2, y: 0.4, z: 1.6 }, 0)
	.to(target, { x: 0.2, y: 0.1 }, 0)
	.to(model.rotation, { y: Math.PI * 0.75 }, 0)
	.to(camera.position, { x: 0, y: 1.5, z: 4 }, 1)
	.to(target, { x: 0, y: 0 }, 1);

renderer.setAnimationLoop(() => {
	camera.lookAt(target);
	renderer.render(scene, camera);
});
window.addEventListener("resize", () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
```

`scrub: 1` lags the timeline one second behind the scrollbar, which smooths wheel steps. `scrub: true` follows it
exactly.

## 3. Scrubbing an animation clip

```js
const mixer = new THREE.AnimationMixer(model);
const clip = gltf.animations.find((entry) => entry.name === "Open"); // real name from the inspect report
const action = mixer.clipAction(clip);
action.play();
action.paused = true; // time is driven by scroll, not by the clock

ScrollTrigger.create({
	trigger: "#detail",
	start: "top bottom",
	end: "bottom top",
	scrub: true,
	onUpdate: (self) => mixer.setTime(self.progress * clip.duration),
});
```

## 4. Pinned sections and HTML overlays

Pin a section so the scene animates while the text stays put:

```js
gsap.timeline({ scrollTrigger: { trigger: "#detail", start: "top top", end: "+=150%", scrub: 1, pin: true } })
	.to(model.position, { y: 0.3 })
	.to("#detail h2", { opacity: 0 }, "<50%");
```

To pin text to a point on the model, project that point to screen space every frame:

```js
const anchor = model.getObjectByName("Grille");
const label = document.querySelector("#grille-label");
const point = new THREE.Vector3();
// in the frame loop:
anchor.getWorldPosition(point).project(camera);
label.style.transform = `translate(${((point.x + 1) / 2) * window.innerWidth}px, ${((1 - point.y) / 2) * window.innerHeight}px)`;
```

## 5. Reduced motion and mobile

```js
ScrollTrigger.config({ ignoreMobileResize: true });
const media = gsap.matchMedia();
media.add("(prefers-reduced-motion: no-preference)", () => {
	// build the scrubbed timelines here; they are reverted automatically when the query stops matching
});
media.add("(prefers-reduced-motion: reduce)", () => {
	// snap to section states without camera flights, e.g. ScrollTrigger.create({ trigger, onEnter: () => applyState(i) })
});
```

## 6. Smooth scrolling with Lenis

Lenis smooths native scroll; wire it to ScrollTrigger and GSAP's ticker so there is one clock:

```js
import Lenis from "lenis"; // npm i lenis
const lenis = new Lenis();
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);
```
