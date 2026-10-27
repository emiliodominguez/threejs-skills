---
name: threejs-physics
description: "Rigid-body physics for three.js and R3F with Rapier: colliders from glTF models, dynamic and kinematic bodies, collision events, character controllers. Use when objects fall, collide, get thrown or walked on. Hands off to `threejs-performance`."
---

# Physics with Rapier

Rapier (`@dimforge/rapier3d-compat` 0.21, `@react-three/rapier` 2.2) is the default physics engine for three.js
work: WASM, deterministic, with character controllers and good React bindings. Most physics bugs are scale and
shape problems, not engine problems: bodies in centimeters fall 100 times too slowly, triangle-mesh colliders on
moving bodies tunnel or explode, and rendering at a variable rate while stepping at it makes motion jitter.

## Process

1. Inspect every model that gets a collider (`threejs-model-inspect`): scale must be meters (fix `scale-large`
   first; physics in centimeters behaves like slow motion), and note which nodes are the floor, walls and props.
2. Choose collider shapes per object, cheapest that fits:

   | Object | Body | Collider |
   | --- | --- | --- |
   | Floor, walls, level geometry | fixed | trimesh (static only) or cuboids |
   | Props that move | dynamic | cuboid, ball, capsule, or convex hull |
   | Concave props that move (chairs, cups) | dynamic | several convex shapes, never trimesh |
   | Player | kinematicPosition + character controller | capsule |
   | Triggers (pickups, zones) | fixed | sensor collider |

3. Read the recipe file for the stack: `references/vanilla.md` or `references/r3f.md`.
4. Step the world at a fixed rate (60 Hz) decoupled from rendering, and interpolate or sync transforms after the
   step. `@react-three/rapier` does this with `timeStep={1/60}` and `interpolate` (the defaults).
5. Turn on the debug view while building (`debug` prop, or `world.debugRender()` lines) and check that every
   collider hugs its mesh. Turn it off before shipping.
6. Test edge cases on screen: fast objects (enable CCD), stacking (sleeping, friction), and the player on slopes and
   steps (autostep, snap to ground).

## Anti-patterns

- Trimesh colliders on dynamic bodies: they collide poorly with other trimeshes and cost far more than hulls.
- Scaling a mesh after its collider was built; the collider keeps the old size. Build colliders from final transforms.
- Setting a dynamic body's mesh position directly; the next step overwrites it. Move bodies through the body API
  (`setTranslation`, `applyImpulse`, `setLinvel`) or make them kinematic.
- `world.step()` once per rendered frame on 120 Hz screens: physics runs twice as fast. Accumulate time and step at
  a fixed rate.

## Done when

- The debug view shows colliders matching the meshes, and objects rest without jitter.
- Behavior is the same at 60 Hz and 120 Hz refresh rates.
- Fast objects do not pass through thin walls.

Next: `threejs-performance` if body counts grow (instancing with `InstancedRigidBodies`, sleeping, simpler shapes).
