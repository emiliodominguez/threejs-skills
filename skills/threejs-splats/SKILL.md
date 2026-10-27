---
name: threejs-splats
description: "Gaussian splats in three.js and R3F with Spark: loading SPZ, PLY, SPLAT, KSPLAT and SOG captures, orientation, mixing with meshes, LOD. Use when showing photogrammetry or radiance-field captures. Hands off to `threejs-performance`."
---

# Gaussian splats

A Gaussian splat is a captured scene stored as millions of soft colored ellipsoids instead of triangles: real-world
places and objects with view-dependent lighting baked in. Use Spark (`@sparkjsdev/spark` 2.4, MIT, by World Labs):
it renders splats inside the normal three.js pipeline, sorts several splat objects together, mixes them with
meshes, and runs on mobile WebGL2. It needs `WebGLRenderer`; there is no WebGPU path.

## Process

1. Get the capture into a supported format: `.spz` (smallest, preferred for the web), `.ply` (raw training output,
   often 50-500 MB), compressed `.ply`, `.splat`, `.ksplat`, or `.sog`. Convert large PLY files to SPZ before
   shipping (Spark's `transcodeSpz`, or the capture tool's SPZ export).
2. Read `references/spark.md` and set up `SparkRenderer` plus one `SplatMesh` per capture.
3. Fix orientation once: most captures come out in a y-down convention, so they appear upside down until rotated
   (`splat.quaternion.set(1, 0, 0, 0)` flips them). Set scale and position on the `SplatMesh` like any `Object3D`.
4. Wait for `await splat.initialized` before framing the camera or reading bounds.
5. For large scenes, turn on level of detail (`lod: true` on the mesh, `enableLod` on the renderer) and paging for
   multi-million-splat captures, and cap the pixel ratio; splats are fill-rate heavy.
6. Check on a phone: splat count and screen coverage decide frame rate, not file size alone.

## Mixing with meshes

Splats and meshes share the depth buffer, so a mesh can stand inside a captured room. Splats carry their own baked
lighting: three.js lights do not affect them, so light meshes to match the capture (an environment map made from
the same location matches best).

## Anti-patterns

- Shipping the raw training PLY; SPZ is usually around 10 times smaller.
- Looking for the capture without fixing its orientation, and concluding it failed to load.
- Expecting three.js lights, shadows or tone mapping to change a splat's look.
- Using drei's `<Splat>` for new work that needs several captures, editing or LOD; it is a lighter, single-splat
  component.

## Done when

- The capture is upright, scaled to meters, and framed after `initialized` resolves.
- File size and splat count fit the target devices, verified on a phone.
- Meshes placed in the scene sort correctly against the splats.

Next: `threejs-performance` for fill rate and pixel ratio when frames drop.
