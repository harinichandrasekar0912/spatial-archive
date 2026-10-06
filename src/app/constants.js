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

// Image / PDF focus view (spec §94–96).
export const FOCUS_VIEW = {
  durationMs: 560,
  maxBlurPx: 4,
  maxDim: 0.55,
}
