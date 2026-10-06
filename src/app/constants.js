/*
 * Central tuning values for Spatial Archive.
 * Units: milliseconds for time, Three.js world units for 3D space, CSS pixels for DOM.
 * Values marked "spec" come straight from the master specification.
 */

const DEG = Math.PI / 180

/*
 * Colour theme: black space, white ink. styles.css mirrors these values as CSS tokens;
 * this object is for colours used by WebGL and canvas drawing.
 */
export const THEME = {
  background: '#0a0a0a',
  ink: '#f2f1ed',
  dot: 0xf2f1ed,
  noteSurface: '#151514',
  documentSurface: '#131312',
  placeholder: '#1c1c1b',
  placeholderMissing: '#262624',
  hairline: 'rgba(242, 241, 237, 0.1)',
  inkMuted: 'rgba(242, 241, 237, 0.55)',
  inkFaint: 'rgba(242, 241, 237, 0.4)',
  backdrop: '10, 10, 10',
}

// Camera depth of each application view. Depth is cumulative: the camera never resets to zero.
export const VIEW_DEPTH = {
  landing: 0,
  // Projects: the camera rests 8 units in front of the lattice plane the project panels sit on.
  projects: -32,
  // The workspace has no single fixed depth: each opens framed on its own content, in front of
  // layer 0 (z = -50).
}

/*
 * The project panels live on the lattice plane at z = -40. From Landing they are lost in the
 * depth; flying in, they grow with true perspective and emerge between these camera distances.
 */
export const PROJECTS_PLANE = {
  z: -40,
  emergeFrom: 27,
  clearAt: 12,
}

export const CAMERA = {
  fov: 50,
  near: 0.1,
  far: 220,
  maxPixelRatio: 2,
}

// Landing ambient motion (spec §43–47): slow, clearly perceptible yaw plus a little drift.
export const AMBIENT = {
  maxYaw: 1.0 * DEG,
  maxPitch: 0.08 * DEG,
  maxDriftX: 0.22,
  yawPeriodMs: 14000,
  pitchPeriodMs: 23000,
  driftPeriodMs: 18500,
  rampInMs: 2600,
}

// Landing intro sequence (spec §30).
export const INTRO = {
  dotsFadeStartMs: 400,
  dotsFadeMs: 1200,
  brandFadeStartMs: 600,
  brandFadeMs: 1000,
  ambientStartMs: 1700,
  // The caret appears on its own and blinks before the phrase is typed onto the screen.
  caretStartMs: 1500,
  typingStartMs: 2500,
  typingCharMs: 75,
  // "Zoom in to start" fades in once the phrase is complete.
  hintDelayMs: 500,
  hintFadeMs: 900,
  // Wheel / swipe intent is ignored until the field has been established.
  navigationUnlockMs: 1700,
  // Deep links (#/projects, #/workspace/…) skip the typewriter but keep the dot fade.
  deepLinkUiStartMs: 900,
  deepLinkUiFadeMs: 700,
}

// Camera choreography between views (spec §50–52).
export const TRAVEL = {
  recenterMs: 600,
  settleMs: 80,
  travelMs: 1500,
  // Landing ⇄ Projects: a long, soft glide through the lattice.
  landingTravelMs: 2600,
  returnTravelMs: 2200,
  reducedMs: 480,
}

// Zooming in from Landing: the phrase crumbles into dust that falls, then the camera sets off.
export const LANDING_EXIT = {
  sweepMs: 340,
  dustLifeMs: 1150,
  travelDelayMs: 420,
  hintFadeMs: 260,
  headingStart: 0.82,
}

export const INPUT = {
  wheelThreshold: 110,
  wheelIdleResetMs: 160,
  swipeThresholdPx: 60,
  swipeMinMs: 120,
  // Ignore "back to Landing" wheel intent shortly after the Projects list was scrolled.
  scrollSettleMs: 400,
}

// Project tiles (spec §55–62); their depth comes from PROJECTS_PLANE.
export const PROJECTS_MOTION = {
  headingOffsetPx: 8,
}

// Back to Landing: as the camera arrives, dust rises from below and settles into the phrase.
export const LANDING_RETURN = {
  assembleAt: 0.72,
  flightMs: 900,
  sweepMs: 420,
  taglineFadeMs: 700,
  ambientDelayMs: 300,
}

// Create form (spec §75–83): it swishes out of the plus on an arc, growing from the plus's size.
export const CREATE_MODAL = {
  durationMs: 800,
  closeMs: 540,
  minReverseMs: 260,
  startSizePx: 30,
  // How far the path bows away from the straight line, as a fraction of its length.
  arc: 0.22,
  tiltDeg: 14,
  swayDeg: -5,
  maxFormBlurPx: 7,
  maxBlurPx: 5,
  maxDim: 0.45,
  resolveMs: 380,
}

/*
 * Opening a workspace: everything but the chosen panel fades, the panel comes apart into dust
 * that spirals into a point, the point bursts and the dust becomes the workspace lattice; then
 * the floor's footprints are drawn, the drop lines rise, and the objects appear.
 */
export const ENTRY = {
  fadeMs: 520,
  loosenMs: 260,
  swirlMs: 1150,
  holdMs: 260,
  burstMs: 950,
  burstHandOffMs: 420,
  floorMs: 520,
  footprintsMs: 700,
  dropsMs: 560,
  objectsMs: 700,
  chromeMs: 520,
  maxParticles: 7000,
  burstTargets: 2600,
  // The panel cross-fades into its own dust over this long.
  handOverMs: 240,
  // A click or key only hurries the entry along after this (so a double-click does not).
  skipAfterMs: 650,
  // Longest the gathered point waits for the workspace to finish loading before bursting.
  maxWaitMs: 4000,
  // Gaps between the stages (measured from the burst).
  floorAt: 650,
  footprintsAt: 1050,
  dropsAt: 1650,
  objectsAt: 2050,
  chromeAt: 2350,
}

// Closing a workspace: it comes apart into dust that falls out of the screen; Projects returns.
export const EXIT = {
  spreadMs: 420,
  chromeFadeMs: 260,
  projectsAt: 950,
  projectsFadeMs: 850,
  particleStepPx: 3,
  maxParticles: 24000,
}

// Dotted spatial field (spec §32–42).
export const DOT_FIELD = {
  planeCount: 11,
  planeSpacing: 10,
  // Lattice spacing across a plane. Two steps make one floor cell, as deep as a workspace layer.
  step: 1.25,
  halfExtent: 100,
  // Planes are kept until they are this far behind the camera, so reverse travel never pops.
  windowLead: 5,
  color: THEME.dot,
  baseSize: 0.068,
  sizeGrowthPer10: 0.003,
  // Depth falloff: planes up to fullOpacityDistance away carry nearOpacity; beyond that a plane
  // is half as bright every halfFadeDistance units, so the nearest dots read clearly and the
  // depth behind them is felt rather than counted.
  nearOpacity: 0.46,
  fullOpacityDistance: 10,
  halfFadeDistance: 10,
  minOpacity: 0.02,
  // Dots dissolve just before a plane passes the camera instead of becoming huge discs.
  nearClear: 0.25,
  nearFull: 1.2,
  // Planes fade out with distance and are fully invisible before they leave the slot window.
  farFadeStart: 60,
  farFadeEnd: 92,
}

/*
 * Landing and Projects: dots near the pointer brighten like stars and dim again once it has
 * passed. The pointer leaves a short trail of fading samples; each dot takes the glow of the
 * nearest one (see DotField and three/dotGlow.js).
 */
export const DOT_GLOW = {
  // Radius of the glow around the pointer on a 900 px tall screen (scaled with the screen).
  radiusPx: 150,
  // Opacity a fully lit dot gains: `boost` on the nearest planes, `farBoost` on the deepest,
  // so the depth of the field stays legible inside the glow.
  boost: 0.85,
  farBoost: 0.42,
  // A lit dot grows by sizeGain, and tiny far dots grow to at least minSizePx, like small stars.
  sizeGain: 0.55,
  minSizePx: 2.6,
  // How much each dot's own (hashed) brightness varies its response, and a gentle twinkle.
  starVariance: 0.65,
  twinkle: 0.22,
  trailSamples: 6,
  trailSpacingPx: 18,
  trailDecayMs: 560,
  // The glow follows the pointer with this time constant (a touch of easing, no lag).
  followMs: 40,
  fadeInMs: 320,
  fadeOutMs: 700,
}

/*
 * The workspace is a 3D volume inside the dot field. Layer 0 is the dotted plane at z = -50;
 * layer k sits layerSpacing units further back. Every fourth layer coincides with one of the
 * travel planes (spaced 10 apart), so the volume "fills in" around the existing field.
 */
export const WORKSPACE = {
  layer0Z: -50,
  layerSpacing: 2.5,
  maxLayer: 11,
  // Cards sit this far in front of their layer's dot plane: enough to hide that plane's dots
  // behind them, small enough that a card, its footprint and its floor line read as one layer.
  itemOffset: 0.05,
  // Positions and sizes are stored in "workspace pixels"; this maps them to world units.
  pxPerUnit: 128,
  // Camera limits: never closer than this to the deepest layer, never further back than this
  // from layer 0 (the Projects depth is just beyond).
  minCameraGap: 2,
  maxCameraDistance: 30,
  // Entry choreography, as fractions of travel progress.
  cardsFadeStart: 0.45,
  cardsFadeEnd: 0.85,
  chromeFadeStart: 0.8,
  latticeFadeStart: 0.55,
  dragThresholdPx: 3,
  // Shift + vertical drag: pixels of pointer travel per layer step.
  depthDragPxPerLayer: 34,
  layerChangeMs: 220,
  // Angled panels (experiment): set allowRotation to false to revert to front-facing cards.
  allowRotation: true,
  rotateStepDeg: 15,
  rotateMaxDeg: 90,
  rotateDegPerPx: 0.6,
  rotateChangeMs: 260,
  // "Tilt to look": Alt / right-drag swings the view, release eases back to the front.
  tiltMaxYawDeg: 35,
  tiltMaxPitchDeg: 22,
  tiltDegPerPx: 0.22,
  tiltReturnMs: 480,
  // Atmospheric depth: cards fade towards the background colour with distance.
  fogNear: 9,
  fogFar: 48,
  flySpeed: 0.0012,
  pinchFlySpeed: 0.008,
  fitMarginPx: 72,
  // Camera distance kept between the camera and the floor's front edge in the opening view.
  entryFloorGap: 4.5,
  // Screens narrower than this (width / height) frame the work centred (see computeEntryView).
  portraitBelow: 0.9,
  fitTopPx: 84,
  fitMaxZoom: 1,
  homeMs: 700,
  cardEnterMs: 320,
  cardExitMs: 220,
  minCardSize: 72,
  defaultImageMax: 300,
  noteSize: { width: 240, height: 180 },
  pdfSize: { width: 210, height: 272 },
  saveDebounceMs: 250,
  nudgePx: 8,
  nudgeLargePx: 40,
}

// The workspace floor: a grid receding under the volume, with each item's footprint on it.
export const FLOOR = {
  // The floor sits at least `clearance` below the lowest item (defaultY when the workspace is
  // empty), on a row of the dot lattice, so the lattice rests on it.
  defaultY: -3.2,
  clearance: 0.45,
  snapToLattice: true,
  // Experiment: no dots below the floor, so the floor is the bottom of the space. Set to false
  // to bring them back.
  clipDotsBelow: true,
  // Grid: a line every two lattice steps across, and one line per layer going back.
  halfWidthSteps: 44,
  lineEverySteps: 2,
  depthLayers: 20,
  // How far the grid can reach in front of layer 0 (in layers), towards the camera.
  frontLayers: 12,
  gridOpacity: 0.15,
  footprintOpacity: 0.85,
  footprintThickness: 0.1,
  // 3D models stamp their base rectangle onto the floor: a fine outline over a faint fill.
  modelOutlineThickness: 0.06,
  modelFill: 0.14,
  dropOpacity: 0.34,
  dropDash: 0.14,
  dropGap: 0.18,
  levelChangeMs: 600,
  maxItems: 256,
  // The turn dial lying on the floor in front of the selected item's footprint.
  dialSize: 0.8,
  dialGap: 0.72,
  dialOpacity: 0.55,
}

// 3D models in the workspace.
export const MODEL = {
  // Longest side (width or height) of a newly added model, in workspace pixels.
  defaultMaxPx: 380,
  // Architectural "white model": off-white surfaces with fine dark edges.
  whiteColor: 0xe9e7e2,
  edgeColor: 0x2a2a28,
  edgeOpacity: 0.55,
  edgeThresholdDeg: 28,
  // Dev-server endpoint that converts .skp files with the locally installed SketchUp.
  convertEndpoint: '__spatial-archive/convert-skp',
  convertPollMs: 1500,
  // The light copy kept for the workspace (see models/modelOptimize.js).
  keepOuterShellOnly: true,
  shellViews: 96,
  shellResolution: 1536,
  triangleBudget: 150000,
  textureMaxPx: 1024,
}

// Extra lattice planes that fill the workspace volume between the travel planes.
export const VOLUME = {
  // Number of layer slots (behind layer 0) that receive a plane.
  depthLayers: 20,
  // Close to the travel planes' weight, so every layer of the volume reads as an equal layer.
  opacityScale: 0.85,
}

// Web copies of what is added (spec §123): see workspace/webCopies.js.
export const IMAGE = {
  webMaxPx: 2000,
  webQuality: 0.86,
  jpegQuality: 0.88,
  // Images already this light (and no larger than webMaxPx) are kept exactly as they are.
  lightBytes: 1.2 * 1024 * 1024,
  // A copy is kept only if it is at most this fraction of the original's size.
  keepBelowRatio: 0.9,
  // Long edge of the picture of a PDF's first page.
  pdfPreviewPx: 1200,
}

// Image / PDF focus view (spec §94–96).
export const FOCUS_VIEW = {
  durationMs: 560,
  maxBlurPx: 4,
  maxDim: 0.55,
}

/*
 * Colours, after Apple's system palette (the familiar sticky-note set: yellow, green, blue,
 * pink, purple), made very mild for the black space. Values were chosen in OKLCH so every hue
 * has the same lightness and softness: notes are pale paper tints (L 0.86, C 0.036) written in
 * dark ink; threads use the same hues one step deeper (L 0.72, C 0.075), so a thread never reads
 * as a note. The first entry of each list is the default.
 */
export const NOTE_COLORS = [
  { id: 'graphite', label: 'Graphite', surface: THEME.noteSurface, ink: THEME.ink, muted: 'rgba(242, 241, 237, 0.4)', edge: THEME.hairline, swatch: '#2c2c2a' },
  { id: 'yellow', label: 'Yellow', surface: '#d9d1b7', ink: '#22201b', muted: 'rgba(34, 32, 27, 0.45)', edge: 'rgba(0, 0, 0, 0.06)' },
  { id: 'green', label: 'Green', surface: '#c1d8c5', ink: '#1b211c', muted: 'rgba(27, 33, 28, 0.45)', edge: 'rgba(0, 0, 0, 0.06)' },
  { id: 'blue', label: 'Blue', surface: '#bed4e8', ink: '#1a1f25', muted: 'rgba(26, 31, 37, 0.45)', edge: 'rgba(0, 0, 0, 0.06)' },
  { id: 'pink', label: 'Pink', surface: '#e7c8ce', ink: '#251c1e', muted: 'rgba(37, 28, 30, 0.45)', edge: 'rgba(0, 0, 0, 0.06)' },
  { id: 'purple', label: 'Purple', surface: '#d4cce6', ink: '#1f1c26', muted: 'rgba(31, 28, 38, 0.45)', edge: 'rgba(0, 0, 0, 0.06)' },
]

export const THREAD_COLORS = [
  { id: 'silk', label: 'Silk', color: '#c8c4bc' },
  { id: 'yellow', label: 'Yellow', color: '#b5a46e' },
  { id: 'green', label: 'Green', color: '#83b28c' },
  { id: 'blue', label: 'Blue', color: '#7daad1' },
  { id: 'pink', label: 'Pink', color: '#ce919e' },
  { id: 'purple', label: 'Purple', color: '#ac9acd' },
]

/*
 * Threads (connections, spec §100–102): a slightly loose thread hung between two things, pulled
 * into a shallow curve by gravity (a small rope simulation), with tiny gold specks along it.
 */
export const THREAD = {
  // Points along each thread (the rope simulation's resolution).
  points: 28,
  // How much longer than the straight line a thread is: a little slack, a little more for
  // short threads so they still visibly hang.
  slack: 1.014,
  shortSlack: 0.022,
  shortLength: 6,
  gravity: 9.5,
  damping: 0.982,
  iterations: 18,
  stepMs: 1000 / 120,
  // Thickness in world units, kept between these sizes on screen.
  width: 0.016,
  minWidthPx: 1.1,
  maxWidthPx: 3.2,
  // Where a thread is tied: the top-centre of an item, slightly in front of its face.
  anchorLift: 0.012,
  anchorFront: 0.03,
  // Gold specks: about this many per world unit of thread.
  specksPerUnit: 9,
  maxSpecks: 180,
  speckColor: '#d6a240',
  speckLight: '#ffe9ad',
  // Picking a thread with the pointer, in screen pixels.
  pickPx: 7,
  fadeMs: 320,
  // A thread dropped without a target falls, settles, then fades.
  dropFadeDelayMs: 650,
  dropFadeMs: 450,
}

/*
 * Proximity grouping (spec §103–106). Things placed close together on the same layer form a
 * soft group, drawn as a thin bubble around them (and a matching zone on the floor). Distances
 * are gaps between items' edges in world units (128 workspace px each); leaving takes a wider
 * gap than joining, so a group never flickers at its edge.
 */
export const GROUP = {
  joinGap: 0.45,
  leaveGap: 0.9,
  // The bubble: how far it stands off the items, how softly its joins are rounded, and its
  // corner radius.
  padding: 0.22,
  smoothing: 0.08,
  radius: 0.2,
  outlineOpacity: 0.36,
  fillOpacity: 0.035,
  floorOutlineOpacity: 0.42,
  floorFillOpacity: 0.05,
  // Items per group drawn exactly (beyond this the bubble uses their overall extent).
  maxMembers: 24,
  fadeMs: 360,
}

// Undo / redo (spec §114).
export const HISTORY = {
  limit: 200,
  // Repeated key presses on one item (nudges, layer steps, turns) within this time are one step.
  coalesceMs: 900,
  // How long an undone change takes to glide back into place.
  morphMs: 280,
}

// Search (spec §109–112, redesigned): the camera glides to the match so it takes centre stage.
export const SEARCH = {
  debounceMs: 300,
  // The match fills about this much of the screen's height (or width, whichever is tighter).
  fillHeight: 0.56,
  fillWidth: 0.58,
  minTravelMs: 750,
  maxTravelMs: 1700,
  // On longer journeys the camera eases back a little mid-way to keep its bearings.
  liftPerUnit: 0.32,
  maxLift: 7,
  openMs: 460,
  closeMs: 300,
}
