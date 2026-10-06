# Spatial Archive — Development Record

A concise log of architecture decisions, bugs, fixes and milestones. Written to double as
portfolio process material (spec §133–135). Newest entries first.

---

## 2026-10-07 — Stage 3: threads, groups, search, undo, colours, glowing dots, previews

Everything the audit below listed as missing, except the Luxury Apartment demo content (the
user will add the material themselves). Asked for by the user: loose threads with gravity, gold
specks and colours; note colours; search that travels to the match; dots that glow near the
pointer. The rest comes from the brief.

### Built

- **Glowing dots (Landing, Projects).** The dot shader brightens each dot by its distance on
  screen to the pointer and a short trail of fading samples behind it (`three/dotGlow.js`).
  Each dot's response is scaled by a hashed "star" brightness and a slow twinkle, so the lit
  patch reads as a cluster of stars and reveals the depth of the lattice. Off in the workspace
  and on touch; it fades with the field during transitions.
- **Note colours.** Graphite (default) plus yellow, green, blue, pink and purple: the usual
  sticky-note set (as in Apple's Stickies and Freeform), made very mild. They were chosen in
  OKLCH so each has the same lightness and chroma (pale paper at L 0.86, written in dark ink).
  The picker is a row of round wells under a selected note, with a ring on the chosen one. New
  notes start in the last colour used.
- **Threads (spec §100–102, §118).** Drag the node above a selected item or group onto another
  to tie one. Each thread is a small Verlet rope (28 points, both ends tied, gravity, floor
  collision) with about 2% slack, so it settles into a shallow curve with its lowest point
  between its ends and sways when an end moves. It sleeps when still. It is drawn as a
  camera-facing ribbon with a true pixel width, soft edges and a faint sheen, plus tiny gold
  specks that glint as the view moves. Thread colours are the note hues one step deeper
  (L 0.72), plus a default silk. Click a thread to recolour or cut it: a cut thread parts in the
  middle and both halves fall before fading. Records reference both ends by ID.
- **Groups (spec §103–106).** Decided when something is put down: within 0.45 world units
  (about 58 px) of a neighbour on the same layer it joins that neighbour's group (or forms one).
  Beyond 0.9 of every member it leaves. A group that comes apart splits, and one left with a
  single member dissolves. Groups never merge on their own (`workspace/groups.js`). The bubble is
  a signed distance field: padded member rectangles, bridges between neighbours, soft joins. It
  is thin, grey and live, with a matching zone on the floor plan. A selected group can be dragged
  as one, ungrouped, and given threads.
- **Search (spec §109–112, redesigned by the user).** The magnifier sits above the +. The bar
  grows out from its middle at the top centre, with a × beside it. Typing travels the camera to
  the best match: centred, about 56% of the screen high, and on long journeys the path eases
  back mid-way to keep its bearings. Nothing dims. Matches rank by field (title and tags over
  file name and type over notes), then by whole-word matches. "1 of 3" with ⌃ ⌄, Enter or ↓,
  Shift + Enter or ↑.
- **Undo / redo (spec §114).** Ctrl / Cmd + Z, Ctrl / Cmd + Shift + Z, Ctrl + Y. A step stores
  the before and after state of every record it touched (assets, threads, groups). Undo glides
  items back. Deleted items return from their stored files, with their threads and group.
  Repeated key presses on one item merge into a single step.
- **Light files (spec §123).** Photographs over 2000 px (or over 1.2 MB) are stored as WebP web
  copies, or JPEG where WebP cannot be written. PNGs stay PNG for crisp linework. PDFs get a
  picture of their first page for their card and their proportions, drawn with pdf.js. That is
  the only new dependency, loaded as its own chunk only when a PDF needs it. PDFs added earlier
  get their picture quietly after the workspace opens. The focus view shows the web copy facts
  and page counts.
- **Phones and tablets.** On portrait screens the opening view centres the work and the floor
  reaches out further, so its edge still meets the bottom of the screen. The search bar drops
  below the title on narrow screens. Swatch rows stay on screen. Threads, groups and pinch all
  work with touch.
- **Testing kit:** `06_TESTING/Spatial Archive - testing kit.md` (tasks, observation sheet,
  post-test questions, User 01 diary, observation → change template).

### Architecture decisions

- Threads, bubbles and the dot glow are drawn in the one WebGL scene and frame loop. Rope physics
  runs at a fixed 120 Hz step inside the workspace frame. The bubbles' fill sits just behind the
  cards, so cards cover it.
- History records whole-record snapshots (structured clones, without `updatedAt`) rather than
  commands, so grouping side effects and deletions with their threads undo as one step.
- Grouping runs only when something is put down by hand (drag end, key, depth or turn), never
  on import. A multi-file drop arranged in rows does not group itself.
- Reduced motion: threads take their resting curve at once; cut or dropped threads fade
  without falling; search moves without travel.

### Bugs found and fixed

- Threads did not appear: the ribbon's triangles face away from the camera when a thread runs
  right to left, and were culled. *Fix:* double-sided.
- pdf.js's page drawing waits for animation frames, which a background tab never gets, so a PDF
  added while the tab was hidden never finished. *Fix:* the print intent, which draws in one go.
- pdf.js 6 has no `PDFDocumentProxy.destroy()`, and the error in `finally` made the whole drop
  fail silently. *Fix:* destroy the loading task.
- Group bubbles bulged where neighbours met: the polynomial smooth-min with a large radius
  overshoots. *Fix:* explicit bridges between neighbours and a small smoothing radius.
- The thread pill sat on the thread's lowest point, which can be an end over a card. *Fix:* it
  sits by the middle of the thread, below or above, wherever it covers fewer cards.

### Not done yet

- The Luxury Apartment demo content and a way to ship it with the hosted site (left to the user
  for now).
- Tying threads from the keyboard (threads can be selected, recoloured and cut from the
  keyboard; tying needs a pointer).
- Milestone screenshots for the portfolio (§133, §151).

---

## 2026-10-07 — Brief audit: what is still missing

The full brief (task brief + master specification §00–§170) re-read against the build.

### Missing

- **Proximity grouping** (Priority 4, §103–106): soft boundary, leaving by moving away, a
  connection node on the group. The `groups` store exists; nothing uses it yet.
- **Connections** (Priority 5, §100–102, §118): top-centre node on the selected item, thin lines
  stored by asset ID. The `connections` store exists; nothing uses it yet.
- **Search** (Priority 7, §87, §109–112): magnifier at top-centre; matches come forward, others
  recede and dim; clearing restores everything. Title, filename, tags, notes and type are stored.
- **Undo / redo** (§114): Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z.
- **A demo corpus that ships with the site** (§121–124, Output 2): workspaces live in each
  browser's IndexedDB, so on GitHub Pages every visitor opens an empty Luxury Apartment. Needs
  the files plus a metadata list in `public/assets/demo/`, loaded on first open, and a bulk
  import that reads titles, tags and notes.

### Partial

- PDF cards are typographic, with no first-page preview (§92, §123); it would need a PDF library.
- Images are stored at full size; no web versions (WebP, ~2000 px long edge) on import (§123).
- Tablet and touch not re-checked since the workspace became a volume.
- Milestone screenshots (§133, §151): `05_ITERATIONS/` holds source snapshots only.
- SketchUp conversion only runs on the dev server (it uses the local SketchUp install), so the
  hosted build accepts the other model formats but not `.skp`.

### Outside the code

- User testing (§125–132), at least one testing-driven change (§162), the final video (§136),
  storyboard and model A/B/C diagrams, the case study (§140–143), Git checkpoints (§135).

### Changed on purpose (user direction)

- Black space / white ink instead of the warm off-white palette (§23).
- Dust transitions and the "zoom in to start" hint, where the brief ruled out particles and
  arrows (§24, §27).
- Scroll up zooms in, scroll down zooms out; the brief let both directions enter (§48).
- The Create form swishes out of the plus.
- 3D models and SketchUp files, which the brief left for later (§91).
- The + sits above Home instead of top-left (§87).

---

## 2026-10-06 — Opening a workspace: the glitch fixed

**Report (user):** opening a project "looks like it's glitching", perhaps because of loading.

**Measured** (real time, a workspace with six 12-megapixel photos and the residential model):
the animation froze for 0.37 s just after the click, **1.28 s** in the middle of the swirl,
0.06 s at the burst and 0.30 s when the objects appeared. All of it was loading work landing on
the same thread as the animation:

| Stall | Cause | Fix |
|---|---|---|
| Photos | decoded and downscaled on the page (canvas) | decoded and resized in a worker (`workspace/imageWorker.js`, `createImageBitmap`) |
| Model | white-model edge lines computed on the page (~0.5 s) | computed in a worker (`models/edgesWorker.js`) |
| Burst | 20 000 candidate dots built and sorted on the bang frame | targets shared out per lattice plane and picked at random, during the swirl |
| Reveal | shaders compiled and geometry/textures uploaded on first draw | shaders compiled in parallel beforehand (both fading and settled variants; models drawn single-pass); textures uploaded ahead; every part drawn once, invisibly, inside real frames while the dust is a gathered point |
| First frames | each new dust effect ran unoptimised for 3 frames | effect loops are shared module functions, warmed up once while the page is idle |

Also: the clicked tile no longer snaps out of its hover lift; it cross-fades into its own dust;
the replica text used for the dust is aligned to the real baseline and case; a double-click no
longer fast-forwards the sequence.

**After:** median frame 17 ms, worst gap 36 ms (the click itself), no frame over 18 ms during
the swirl, burst or reveal. The gathered point holds ~0.3 s longer while the workspace is
prepared (up to 4 s if loading is slow), which reads as the point gathering itself. On Windows
the graphics driver (ANGLE on Direct3D) finishes a shader on its first real draw (up to ~0.1 s);
that draw is placed in the hold, where the pause is invisible.

---

## 2026-10-06 — Stage 2: dots + floor, 3D models, and the transitions

**Feedback that drove it (user, in order):** settle the lattice on **dots + floor**; make the dots
calmer (fainter with depth, slightly larger and further apart, everywhere); footprints must lie on
the floor grid; no dots below the floor; models should stamp their base on the floor; support
SketchUp files and keep imported models light ("only the outer shell"); a quieter, corner-hugging
workspace chrome; and transitions that feel like travelling through the tesseract: scroll up to
zoom in, the phrase crumbling into dust, the Create form swishing out of its plus, a panel
collapsing into a point and bursting into the workspace, and the workspace falling away as dust.
The brief's "no decorative effects" rule is relaxed exactly where the user asked for these.

### Lattice and floor

- **Dots** (`DOT_FIELD`): step 1.1 → 1.25, size 0.06 → 0.068, and a halving falloff (full up to
  10 units, half as bright every 10 units more) instead of a slow linear one. The nearest plane
  reads clearly; the depth behind it is felt rather than counted. Applies on every page.
- **Floor** sits on a lattice row (the lattice rests on it) and clips the dot field below it in the
  point shader (`FLOOR.clipDotsBelow`, one flag to undo). Cards sit 0.05 (was 0.3) in front of
  their layer and footprints are drawn on the layer's own grid line, so they land exactly on the
  grid. Models stamp their base rectangle (outline + faint fill) with corner drop lines.
- **Opening view:** every workspace opens framed on all its content, centred, with the floor's
  front edge on the bottom edge of the screen (`computeEntryView`). Home returns to it. Saved camera
  views are no longer used (and no longer stored).
- **Turn dial on the floor:** the rotate handle is now an icon lying flat on the floor in front of
  the selected item's footprint (drag sideways to turn), instead of a floating button.
- **Chrome:** brand and a smaller title in the top-left corner, × in the top-right, + just above
  Home; heavier + / × and a solid Home.

### 3D models and SketchUp

- Drop or pick `.glb .gltf(+.bin) .obj(+.mtl) .dae .stl .fbx` (with textures) or `.skp`. Loaders
  come from three/addons and load on demand. Models live in the volume like cards: layer, move,
  resize, turn, footprint; double-click opens an orbit inspector with **White model / Materials**.
- **Light copies** (`models/modelOptimize.js`): on import every model is baked per material, its
  **outer shell** is found by drawing it from 96 directions into an ID buffer on the GPU (faces never
  seen from outside are dropped), it is simplified by vertex clustering if still over 150k
  triangles, and it is stored as one flat-shaded binary `.glb`. Measured on the user's residential
  cluster: **2.14 M triangles / 109 MB → 90 k triangles / 2.1 MB**, identical from outside, opening
  in a fraction of a second. The record keeps the before / after numbers (shown in the inspector).
- **SketchUp:** browsers cannot read `.skp`, so the installed SketchUp exports it (dev server
  endpoint, or `npm run convert:skp`). Unattended runs stalled on SketchUp's "File Version
  Warning" (models saved by a newer SketchUp) and on dialogs after export; a UI-Automation watcher
  (`tools/skp/answerDialogs.ps1`) answers the known dialog and logs any other, and a finished `.dae`
  is accepted even if SketchUp never reports back. The page polls a job and downloads files as
  binary (no base64). Faces are exported single-sided and drawn double-sided; edges ignore face
  winding and duplicated back faces, so flat faces never show their triangulation.

### Transitions

All particle work happens in one screen-space **dust layer** (`three/DustLayer.js`) drawn by the
same renderer after the 3D scene, from the same frame loop. Elements are redrawn into a canvas from
their computed styles and sampled into grains (`ui/dustSources.js`); the 3D view is sampled from a
captured frame. Effects are functions of time only (`app/dustEffects.js`).

| Moment | What happens |
|---|---|
| Landing intro | Empty → the caret alone, blinking → the phrase typed → "zoom in to start" with a softly bouncing arrow |
| Zoom in (scroll up) | The phrase crumbles left to right into dust that falls; the camera glides 0 → −32 through the lattice; the project panels sit on the lattice plane at −40 and grow with true perspective, emerging from the dark |
| Zoom out (scroll down at the list's end) | The reverse glide; dust rises from below and settles back into the phrase |
| Create | The form swishes out of the plus on an arc: plus-sized and round, tilted back and blurred, growing into place; closing plays it back into the plus |
| Open a workspace | Everything but the chosen panel (or form) fades with the dots; it becomes dust that spirals into a bright point; the point bursts and the grains fly to the workspace's own lattice dots, handing over to the real ones; then the floor appears, footprints draw left to right, drop lines rise from the floor, objects fade in. A click or key fast-forwards |
| Close a workspace | The rendered view becomes dust that falls out of the screen; Projects fades back |

Reduced motion keeps short cross-fades for all of them.

### Architecture decisions

| Decision | Why |
|---|---|
| Dust as one WebGL points overlay in the existing renderer | One context, one loop (as the brief requires); 20k+ grains cost about a millisecond. |
| DOM elements redrawn from computed styles for sampling | No html2canvas dependency; a few hundred character rectangles per element is cheap. |
| Burst targets are the workspace lattice's real screen positions | The grains become the dots: the hand-off is exact, not a cross-fade between unrelated images. |
| One clock for all animation (`performance.now()` in the loop) | Start times recorded in handlers and frame times now agree; also makes the timeline testable. |
| Projects at camera −32, panels on the plane at −40 | A longer, smoother glide through more planes, and the panels genuinely live in the lattice. |
| Light copy instead of the original model | The workspace collects material; fidelity inside a model is not needed there, load time is. |
| Outer shell by GPU visibility (ID buffer), clustering only above budget | Exact and fast; keeps planar architecture crisp, collapses only fine detail. |

### Bugs found and fixed

- SketchUp conversions "took too long": blocked by a modal version warning (newer file) and, for the
  residential model, by a dialog after export. See above.
- The Landing glide finished early (status read before the move existed). *Fix:* progress is read
  from the next frame.
- A flat model showed its triangulation (double-sided export + winding-sensitive edges). *Fix:*
  single-sided export, winding-independent feature edges.
- Light copies have no normals; the white material now has a flat-shaded twin.
- The opening view could put the floor's edge inside the camera's near fade. *Fix:* a minimum gap.
- Test copies in `public/` would have been shipped in `dist/` (removed).

### Not done yet

- Stage 2 items from the brief: proximity grouping, connections, search, undo / redo.
- Import / export of a curated demo workspace for the GitHub Pages build.

---

## 2026-10-06 — Visual direction: black space, white ink

**Decision (user):** after seeing the lattice studies rendered on black, the whole app moves to a
black background with white text, dots and lattice. White points on black read as light in a
space rather than marks on paper, which suits the spatial idea.

- Central `THEME` (`src/app/constants.js`) for WebGL / canvas colours; CSS tokens in `styles.css`
  mirror it. Dots `#f2f1ed` on `#0a0a0a`; tone mapping removed so white stays white.
- Tiles, panels and note / PDF cards are dark surfaces with hairline edges (shadows vanish on
  black). Deeper cards now recede into the dark instead of into a pale fog.
- Veils behind the Create form and focus view darken instead of lighten; the CREATE button
  inverts to a white pill.

**Lattice exploration (ongoing).** Two rounds of interactive studies were shown in conversation:
round 1 compared dot volume, layer frames, dotted room, line lattice, floor and footprints,
focus lens; round 2 combined the dot volume with the floor and footprints in several ways
(dotted floor, faint dots, numbered floor, lens, floor + ceiling). The user's favourites so far:
**dot volume** and **floor and footprints**, and especially the **dots + floor** combination.
Round 3 proposed new ideas (colonnade, acrylic layers, cells, studio corner, dot shadows, survey
markers, perspective construction, depth ruler). **Chosen: dots + floor** (see Stage 2).

---

## 2026-10-06 — Stage 1b: the workspace becomes a 3D volume

**Feedback that drove it:** the first workspace read like a flat board (Miro) with dots behind it.
The intent is a genuinely three-dimensional organising space in which the dots *are* the
coordinate system and things can be pushed into the background or pulled into the foreground.
Two decisions were taken with the user: **face in + tilt to look**, and **depth snaps to layers**.

### What changed

- **The lattice is the space.** Inside a project the dot field fills in: an extra plane every
  2.5 units between the travel planes (every fourth layer coincides with an existing travel plane,
  so the Landing / Projects whoosh is untouched). The planes are the depth layers (0 = front, 11 = back).
- **Cards are real 3D objects** in the same Three.js scene (`workspace/scene3d.js`): textured planes
  with rounded corners, a soft shadow and a caption. They write depth and the dots are drawn after
  them, so dots in front of a deep card veil it while dots behind it are hidden. Cards also fade
  towards the background colour with distance (atmospheric depth), so depth reads as prominence.
- **Depth interaction** (spec §107): Shift + drag up / down moves a card one layer per step along its
  lattice column; `[` / `]` and the ↑ / ↓ control above the selected card do the same. While depth
  changes, a temporary depth guide shows the card's column of layers converging on the vanishing
  point, with the current layer marked.
- **Moving through the space:** drag empty space to pan (parallax between layers); the wheel flies
  along the ray under the pointer and can pass through layers; new items are placed on the nearest
  layer in front of the camera; Home frames every card at every depth (`computeFitView`).
- **Tilt to look:** Alt + drag or right-drag orbits up to 35° around the layer in view; release eases
  back to the exact front view. Organising always happens front-on, so controls stay simple.
- **Inline note editing** now uses a real text field laid over the note's projected rectangle and
  scaled with it, typeset identically to the card texture.
- **Accessibility:** cards are no longer DOM, so a visually hidden list of buttons mirrors them
  ("Image: courtyard, layer 3"); keyboard shortcuts act on the focused item.

### Architecture decisions

| Decision | Why |
|---|---|
| WebGL cards instead of CSS3D | Only WebGL can interleave cards with the dot lattice (dots in front of / behind a card). With DOM cards the dots could never pass in front of content, so depth would only be a scale effect. |
| Cards `renderOrder` 0, dot planes `renderOrder` 1 | Cards draw first and write depth; dots then pass or fail the depth test. Correct occlusion regardless of how transparent objects are sorted. |
| Depth moves along world Z (the lattice column), not along the view ray | The card stays in the same (x, y) column of the lattice, which keeps "position = organisation" meaningful. |
| Layer planes are a bounded set of extra planes, not new geometry | They share the single lattice geometry; nothing is created or destroyed during navigation. |
| Lattice re-centred per plane where the view axis meets it | Tilting the camera never reveals a plane edge. |
| Saved views are camera positions; flat-draft views are migrated | Old `{x, y, distance}` views from the first draft still open sensibly. |

### Bugs found while building it

- Picking missed cards between a sync and the next render (world matrices not yet updated). *Fix:*
  refresh matrices before raycasting.
- `image.decode()` can stall in a hidden / background tab, which silently blocked adding images.
  *Fix:* `utils/image.js` resolves on decode **or** load, with an error path and a timeout.
- A Shift + press shortly after a click counted as a double-click (opening the focus view instead of
  starting a depth drag). *Fix:* Shift + press never counts as a double-press.
- On far-away cards the depth control and delete button overlapped. *Fix:* compact layout beside the card.
- `setPointerCapture` throws for inactive pointers. *Fix:* guarded.

### Open questions for the next round

- Lattice density inside a project (currently 60 % of the travel-plane opacity) — tune by eye.
- Whether captions should fade sooner with depth, and whether layer numbers should show on hover.

---

## 2026-10-06 — Stage 1: shell stabilised + Workspace V1 (rough draft)

Baseline before this stage is preserved in `05_ITERATIONS/2026-10-06_00_baseline-before-claude/`.

### Milestones completed

- **Shell rebuilt on one persistent scene.** Renderer, camera, scene and dot field are created
  once; there is a single `requestAnimationFrame` loop (`three/SpatialScene.js`) and every UI
  animation is a hook in that loop.
- **Landing intro sequence** (spec §30): blank → dots fade from 400 ms → ambient camera from
  1.7 s → typing from 2.05 s at 75 ms/char → caret blinks four times and rests.
- **Landing ⇄ Projects** (spec §48–62, §72): recentre → settle → Z travel; tiles emerge only from
  60 % of actual travel and land on the same frame the camera stops; the heading is exactly 0
  until 85 %. The return is the exact mirror, and the tagline fades back without retyping.
- **Create form** (spec §73–84): grows from the exact visual centre of the clicked tile; X,
  backdrop and Escape all reverse along the same path back to the tile; CREATE resolves the form
  in place, then the camera travels into the new, empty workspace.
- **Workspace V1 / Milestone 1** (spec §153): add image / PDF / note (+ menu, file picker,
  drag-and-drop, paste), select, move, resize, delete, focus view with title / tags / notes,
  pan / zoom / Home, autosave to IndexedDB. **Verified: refresh restores every card in exactly
  the same position and size.**

### Architecture decisions

| Decision | Why |
|---|---|
| Static shell rendered once; views only change `transform` / `opacity` | The old code re-rendered the whole app with `innerHTML` on modal open/close, which destroyed tile state, focus and caused one-frame flashes. |
| `navigator.js` owns all view transitions; only one runs at a time | Prevents competing animation systems (spec §25). Each transition owns the camera and the DOM it animates. |
| Camera motion is time-based (`CameraRig.js`), no per-frame `lerp(…, 0.05)` smoothing | Frame-rate-dependent smoothing made the recentre land late and differently on 60/120 Hz screens. |
| Recentre uses a Hermite curve that leaves with the camera's current velocity | The ambient sway "winds down" instead of stopping abruptly when scroll intent arrives (spec §50). |
| Dot planes occupy fixed **slots** (z = −10k) and opacity is a function of distance | Planes recycle in both directions with no popping; previously planes only recycled forwards and kept their original brightness. |
| Lattice snapped to whole grid steps under the camera | X/Y panning (and ambient drift) can never reveal a plane edge (spec §37). |
| Custom point shader (solid when small, round when large) | A textured disc made sub-pixel dots lose alpha and the field looked sparse; solid small dots match the original weight, round large dots avoid square "pixels" when a plane passes the camera. |
| Workspace cards are DOM, positioned each frame from the **same Three.js camera** | Pan = camera X/Y, zoom = camera dolly. Cards move 1:1 with the pointer while the dotted planes behind them parallax, so the workspace genuinely sits inside the spatial field (spec §86). DOM keeps text and images crisp and accessible. |
| Card plane at z = −49.5, just in front of the dotted plane at −50 | Cards rest on a dotted "drafting sheet". Planes between the camera and the cards are hidden so dots never float in front of content. |
| Selection controls drawn in a constant-size overlay | Delete X / resize arc stay usable at any zoom; the arc is concentric with the card's rounded corner (spec §98). |
| Asset records in IndexedDB; file blobs in a separate store | Moving a card never rewrites image data. Deleted assets keep their blob until the next load (ready for undo). |
| Camera view per project in localStorage | Small and synchronous, so the entry travel knows its destination immediately. |
| Hash routes (`#/projects`, `#/workspace/<id>`) via `replaceState` | Refresh returns to the same view; useful for testing and for linking reviewers straight to the demo workspace. |

### Bugs found in the baseline (and fixes)

1. **Create form appeared at the viewport centre on the first frame.** The modal was pre-rendered
   with `.is-open`, whose CSS rule hard-coded `scale(1)` at the centre and overrode the origin
   variables. *Fix:* one `presence` value drives the form; the dot-sized starting frame is applied
   synchronously in the click handler before the browser paints.
2. **Tiles lagged the camera.** `.project-card` had `transition: transform 360ms` while JavaScript
   wrote transforms every frame, so CSS interpolated behind the camera. *Fix:* no transitions while
   JS owns the tiles; CSS hover is enabled only once Projects is idle (spec §71).
3. **Hover lift never worked after the first visit.** JS left an inline `transform` that overrode
   `:hover`. *Fix:* inline styles are cleared on arrival.
4. **Projects → Landing hid the tiles before the camera moved.** A 500 ms CSS opacity transition
   on the whole page faded everything during the recentre. *Fix:* tiles now shrink back into the
   vanishing point along the mirrored reveal curve.
5. **Dot planes only recycled forwards and kept their per-layer opacity.** After a round trip the
   nearest Landing planes were missing and recycled far planes appeared at near-plane brightness.
   *Fix:* slot-based recycling + distance-based opacity with near and far fades.
6. **Escape only worked with focus inside the form**, because the key listener sat on `#app`
   and the re-render dropped focus to `<body>`. *Fix:* document-level key handling, focus moves
   into the form on open and back to the Create tile on close; the page behind is `inert`.
7. **Camera kept swaying on Projects and in the Workspace.** Ambient weight was forced back to 1
   whenever no transition ran. *Fix:* ambient only on Landing, ramped in and out explicitly.
8. **Intro was not staged.** Dots faded from 0 ms and typing started at 180 ms. *Fix:* the spec
   timeline above.
9. **Workspace had no way back.** *Fix:* X (top-right) reverses the travel to Projects.
10. **User text was injected into HTML unescaped** (project names / descriptions). *Fix:* all
    user strings are escaped.

### Bugs found during this stage

- **Double-click did not open the focus view.** Pointer capture on the canvas retargets click
  events to the canvas. *Fix:* double-press detection inside the pointer handler.
- **Focus ring stayed on a card after clicking empty space.** *Fix:* pressing the background
  focuses the canvas.
- **Editing the URL hash did not change view** (the app only listened for its own navigation).
  *Fix:* a user-triggered `hashchange` reloads straight into that view.

### Decisions taken where the spec was open (most restrained option)

- **Demo projects:** the three invented placeholders (Atlas of Voids, Signal Garden, Quiet
  Interfaces) were replaced with a single real **Luxury Apartment** record (spec §69, §121).
  Projects created by the user are kept.
- **Wheel in the Workspace:** a mouse wheel zooms around the pointer; trackpad two-finger scroll
  pans; pinch (or Ctrl/⌘ + wheel) zooms; dragging empty space pans.
- **Double-click a note** edits its text inline; images and PDFs open the focus view, which is
  also where title, tags and notes are edited (needed later for search).
- **PDF cards** are typographic for now (no thumbnail rendering dependency). The focus view uses
  the browser's own PDF reader.
- **Projects depth −18 / workspace near −42** kept from the baseline. At −18 the nearest dotted
  plane is only 2 units ahead, so a few large dots are visible around the tiles — unchanged from
  the original look.

### Not done yet (next stages)

- Proximity grouping, connections, Shift + drag depth, search, undo / redo (Stage 2).
- Import path for the ~24 Luxury Apartment items + export of an arranged workspace so the
  GitHub Pages demo can ship it (Stage 3).
- PDF thumbnails (optional), multi-select, project rename / delete.
