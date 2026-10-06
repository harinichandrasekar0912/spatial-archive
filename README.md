# Spatial Archive

An experimental spatial information system: can creative research be organised through
position, proximity, depth and relationships instead of hierarchical folders?

Plain JavaScript + Three.js + Vite. No framework, no backend; everything is stored locally in
the browser (project list in `localStorage`, workspace assets and files in IndexedDB).

## Run

```bash
npm install
npm run dev      # http://localhost:5173/spatial-archive/
npm run build    # production build in dist/
```

## Using it

Scrolling up zooms in, scrolling down zooms out.

| Where | Action |
|---|---|
| Landing | Scroll up ("zoom in to start"), swipe, or press ↑ / Enter to travel to Projects |
| Projects | Click a tile to open it · **CREATE** to make a project · scroll down past the end, ↓ or Escape to return |
| Create form | X, click outside, or Escape to close |
| Opening a workspace | Click or press any key to hurry the transition along |
| Workspace | **+** → NOTE / FILE · drop or paste files anywhere (new items go on the nearest layer in view) |
| | Click to select · drag to move within its layer · drag the corner arc to resize · ✕ or Delete to remove |
| | **Shift + drag up / down** pushes an item back / pulls it forward one layer at a time · `[` / `]` or the ↑ ↓ control do the same |
| | Drag the **dial on the floor** (in front of the selected item) sideways to turn it · R / Shift + R |
| | Drag empty space to pan · mouse wheel flies through the layers towards the pointer · trackpad scrolls / pinches |
| | **Alt + drag** (or right-drag) tilts the view to see the layers; release eases back to the front |
| | Double-click an image / PDF / 3D model to focus it (title, tags, notes; models orbit, White model / Materials) · double-click a note to write |
| | Home key or ⌂ frames everything, with the floor's edge at the bottom of the screen · arrow keys nudge (Shift = larger) · X returns to Projects |

Supported files: JPG, PNG, WebP, SVG, PDF, and 3D models — GLB / glTF (+ .bin), OBJ (+ .mtl),
DAE, STL, FBX with their textures, and SketchUp `.skp` (see below). Models are kept as a light
copy (outer shell, simplified, one `.glb`). Everything autosaves; refresh restores the archive.

### SketchUp files

Browsers cannot read `.skp`, so the SketchUp installed on this computer exports them:

- **While `npm run dev` runs**, drop a `.skp` into a workspace. SketchUp opens briefly in the
  background, exports the model, and quits; it then appears in the workspace (about a minute or
  two for a large model). Only requests from this computer are accepted.
- **Or convert first:** `npm run convert:skp -- "model.skp" [--out folder]` writes a `.dae` (plus
  textures) to drop in. On a static (GitHub Pages) build, export from SketchUp as `.dae` / `.glb`
  instead.

The converter looks for `C:\Program Files\SketchUp\SketchUp 20xx\SketchUp.exe` (or set
`SKETCHUP_EXE`), works on a copy of the file, and answers SketchUp's "File Version Warning"
automatically.

Development only: add `?reduced-motion` to the URL to preview the reduced-motion variant.

## Structure

```text
src/
├── app/         App shell markup, central constants, view navigator, dust choreography
├── three/       SpatialScene (renderer + single frame loop), DotField, CameraRig, DustLayer
├── ui/          Landing / Projects / Create markup and their controllers, dust sampling
├── workspace/   Workspace controller, cards, floor, pointer controls, focus view, projection maths
│   └── models/  3D model loading, light copies, styling, inspector
├── data/        projects (localStorage), IndexedDB wrapper, workspace store
└── utils/       easing helpers, DOM helpers (escaping, icons, announcements)
tools/skp/       SketchUp → Collada converter (dev-server endpoint, CLI, dialog watcher)
```

See `DEVLOG.md` for architecture decisions, bugs and milestones.
