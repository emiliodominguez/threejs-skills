# Third-party notices

Some skills in this repository are forks of MIT-licensed work. Each forked `SKILL.md` names its source
and commit in `metadata.source`. Changes made here: added `metadata.source`, cross-links to the `threejs-model-*`
skills, and (for `threejs-model-generate`) a rewritten `SKILL.md` and reference-image notes without the original
repository's sibling skills.

## cloudai-x/threejs-skills

Skills: `threejs-animation`, `threejs-asset-pipeline`, `threejs-fundamentals`, `threejs-geometry`,
`threejs-interaction`, `threejs-lighting`, `threejs-loaders`, `threejs-materials`, `threejs-performance`,
`threejs-postprocessing`, `threejs-react-three-fiber`, `threejs-shaders`, `threejs-textures`.
Source: https://github.com/cloudai-x/threejs-skills at commit 0e181866f095b5f06d005133876e926515390d95.

```text
MIT License

Copyright (c) 2026 CloudAI-X

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## majidmanzarpour/threejs-game-skills

Skill: `threejs-model-generate` (from `threejs-3d-generator`; `scripts/threejs_3d_asset.py`, `references/api-notes.md`
and `references/threejs-integration.md` are kept as-is apart from skill-name references).
Source: https://github.com/majidmanzarpour/threejs-game-skills at commit 8286774b22a2566bf894dbc825825c16921866af.

```text
MIT License

Copyright (c) 2026 Majid Manzarpour

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Local annotations in forked skills

One-line notes about changes announced for three.js r187 were added where the forks use affected APIs
(`threejs-lighting`: `library.addLight`, `threejs-materials`: `iridescenceThicknessRange`, `threejs-postprocessing`:
`pixelationPass`). `scripts/check-upstream.mjs --sync` replaces fork bodies with upstream and drops these notes;
re-check them against the release after syncing.
