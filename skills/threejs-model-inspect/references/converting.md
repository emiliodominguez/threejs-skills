# Converting other formats to glTF

Read this when the model is not `.glb` or `.gltf`. three.js has loaders for FBX, OBJ, USDZ, STL, PLY and
Collada, but glTF is the only format whose materials, animation and compression GLTFLoader handles fully, and the
model skills assume it. Convert once at build time; never ship FBX to the browser.

## Pick a converter

| Input | Best route | Notes |
| --- | --- | --- |
| FBX (Mixamo, Unity/Unreal exports, asset stores) | Blender script below | Keeps skinning and every take as a clip. |
| OBJ + MTL | `npx obj2gltf -i model.obj -o model.glb` | Static only. Textures must sit where the `.mtl` says. |
| USD / USDZ | Blender script below | Blender 4+ imports USD natively. |
| STL, PLY | Blender script below, or load directly with `STLLoader` / `PLYLoader` | No materials or UVs; assign a material in code. |
| DAE (Collada) | Blender 4.x, or `ColladaLoader` | Blender 5 removed Collada import. |
| `.blend` | Blender script below | Exports the file's active scene. |

The Blender script lives next to the inspect script (`<this-skill-dir>` is the skill root, the directory holding
SKILL.md, not `references/`). It runs inside Blender's own Python; plain `python3` cannot import `bpy`:

```bash
blender -b --factory-startup -P <this-skill-dir>/scripts/convert_blender.py -- input.fbx output.glb
blender -b --factory-startup -P <this-skill-dir>/scripts/convert_blender.py -- input.fbx output.glb --no-animations
```

On macOS the binary is `/Applications/Blender.app/Contents/MacOS/Blender` when `blender` is not on PATH.

## Check the result

Run `inspect.mjs` on the output every time. Conversions commonly change:

- **Clip names.** Blender prefixes actions with the armature or object name: an FBX `Run` take often arrives as
  `Armature|Run` or `root|root|Run`. Rename clips in code (`clip.name = clip.name.split("|").pop()`) or in Blender,
  and read names from the report.
- **Scale.** FBX from 3ds Max, Maya and Unreal is often in centimeters, so the model is 100 times too large. The
  report flags it as `scale-large`.
- **Textures.** FBX files that reference textures by absolute path lose them. Re-link in Blender, or apply them in
  code with `threejs-model-customize`. An empty `## Textures` section means none survived.
- **Extra nodes.** Converters add armature and root nodes; animation still works, but node paths change.

## When not to convert

- Mixamo animation-only FBX files (downloaded "without skin") are clips for an existing rig; convert them, then
  follow `threejs-model-animate` to apply the clips to the character.
- If the project already loads FBX at runtime and works, converting is an optimization, not a fix; ask first.
