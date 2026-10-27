"""Convert FBX, OBJ, USD/USDZ, STL, PLY, DAE or BLEND files to GLB with headless Blender.

Usage:
    blender -b --factory-startup -P convert_blender.py -- input.fbx output.glb [--no-animations] [--y-up-off]

Imports into an empty scene, applies nothing destructive, and exports a single GLB with
embedded textures, animations (when present) and +Y up, which is what three.js expects.
"""

import os
import sys

import bpy


def importer_for(path):
    """Return a callable that imports the file at path, or None when the format is unknown."""
    ext = os.path.splitext(path)[1].lower()
    ops = bpy.ops
    table = {
        ".fbx": lambda: ops.import_scene.fbx(filepath=path),
        ".obj": lambda: ops.wm.obj_import(filepath=path),
        ".usd": lambda: ops.wm.usd_import(filepath=path),
        ".usda": lambda: ops.wm.usd_import(filepath=path),
        ".usdc": lambda: ops.wm.usd_import(filepath=path),
        ".usdz": lambda: ops.wm.usd_import(filepath=path),
        ".stl": lambda: ops.wm.stl_import(filepath=path),
        ".ply": lambda: ops.wm.ply_import(filepath=path),
        ".dae": lambda: ops.wm.collada_import(filepath=path),
        ".glb": lambda: ops.import_scene.gltf(filepath=path),
        ".gltf": lambda: ops.import_scene.gltf(filepath=path),
    }
    return table.get(ext)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    flags = {arg for arg in argv if arg.startswith("--")}
    paths = [arg for arg in argv if not arg.startswith("--")]
    if len(paths) != 2:
        print("Usage: blender -b --factory-startup -P convert_blender.py -- input output.glb [--no-animations]")
        sys.exit(1)
    source, target = (os.path.abspath(path) for path in paths)

    if source.lower().endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=source)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        importer = importer_for(source)
        if importer is None:
            print(f"Unsupported input format: {source}")
            sys.exit(1)
        try:
            importer()
        except AttributeError:
            print(f"This Blender build has no importer for {os.path.splitext(source)[1]} (Collada was removed in Blender 5).")
            sys.exit(1)

    bpy.ops.export_scene.gltf(
        filepath=target,
        export_format="GLB",
        export_yup=True,
        export_animations="--no-animations" not in flags,
        export_apply=False,
    )
    meshes = sum(1 for obj in bpy.data.objects if obj.type == "MESH")
    print(f"Wrote {target} ({meshes} mesh objects, {len(bpy.data.actions)} actions)")


main()
