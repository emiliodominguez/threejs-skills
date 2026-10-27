---
name: threejs-scroll
description: "Scroll-driven 3D in three.js or R3F: camera paths, model reveals and clips scrubbed by scroll, pinned sections, HTML overlays. Use for landing pages and product stories where scroll moves the scene. Hands off to `threejs-performance`."
---

# Scroll-driven 3D

A scroll story maps one number, scroll progress from 0 to 1, onto scene state: camera position, model rotation, a
clip's time, material opacity. Keep that mapping in one place, drive it from a single scroll source, and render
from the frame loop. Most broken scroll scenes have two scroll sources fighting, state set in scroll events instead
of the frame loop, or no reduced-motion path.

## Process

1. Pick the scroll source by stack:
   - Vanilla three.js: GSAP `ScrollTrigger` over normal page scroll, with a fixed full-screen canvas behind the
     content. Read `references/vanilla.md`.
   - React Three Fiber: drei `ScrollControls` + `useScroll` when the canvas owns the page; GSAP when the page is a
     normal document with a 3D section. Read `references/r3f.md`.
2. Write the story as keyframes first: for each section, the progress range and the scene state at its end (camera
   position and target, model rotation, clip time). Code follows that table.
3. Drive state from progress inside the frame loop (`setAnimationLoop` or `useFrame`), interpolating with damping
   (`THREE.MathUtils.damp` or GSAP `scrub: 1`) so the scene eases instead of jumping between scroll events.
4. Scrub animation clips by setting their time from progress (`mixer.setTime(progress * clip.duration)` with the
   action playing and paused), never by `play()` per scroll event.
5. Respect `prefers-reduced-motion`: jump between section states without camera flights, or show a static render.
6. Check on a phone-sized viewport: mobile address bars resize the viewport while scrolling (set
   `ScrollTrigger.config({ ignoreMobileResize: true })`), and fill rate is lower (cap the pixel ratio at 2).
7. Verify by scrolling through every section in a browser and watching for jumps, jitter and text overlapping
   the model.

## Anti-patterns

- Two scroll systems at once (ScrollControls plus GSAP on the same scroll, or Lenis without wiring it to ScrollTrigger).
- Moving the camera inside the scroll event handler; it stutters because scroll events and frames are not in sync.
- `camera.lookAt` once at setup while tweening the position: the camera drifts off the subject. Tween a target and
  call `lookAt` every frame.
- Loading the hero model lazily at the section where it appears; preload it before the story starts.

## Done when

- Scrolling top to bottom and back is smooth and reversible, with no jumps at section boundaries.
- Reduced motion has a working path, and the page works at phone width.
- Clips scrub forward and backward with the scroll.

Next: `threejs-performance` if frames drop during the scroll.
