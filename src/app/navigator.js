import { AMBIENT, ENTRY, EXIT, INTRO, LANDING_EXIT, LANDING_RETURN, TRAVEL, VIEW_DEPTH, WORKSPACE } from './constants.js'
import { clamp, easeInOutCubic, easeOutCubic, progressBetween, smoothstep } from '../utils/easing.js'
import { dustFromElement, dustFromFrame } from '../ui/dustSources.js'
import { createAssemble, createBurst, createFall, createFallAway, createSwirl } from './dustEffects.js'

const neutralAt = (z) => ({ x: 0, y: 0, z, yaw: 0, pitch: 0 })
const ALL_KEYS = ['x', 'y', 'z', 'yaw', 'pitch']
// A skipped workspace entry plays its remaining stages this much faster.
const SKIP_SPEED = 5

function parseRoute() {
  const [name, id] = window.location.hash.replace(/^#\/?/, '').split('/')

  if (name === 'workspace' && id) {
    return { view: 'workspace', projectId: decodeURIComponent(id) }
  }

  return { view: name === 'projects' ? 'projects' : 'landing' }
}

/*
 * View state machine and transition choreographer (spec §25).
 * One transition runs at a time and is the sole owner of the camera, the dust layer and the
 * DOM it animates, so separate animation systems never fight over the same element.
 *
 *   landing ──zoom in (scroll up)──▶ projects ──tile / CREATE──▶ workspace
 *      ▲                                │  ▲                         │
 *      └──── zoom out (scroll down) ────┘  └──────────── X ──────────┘
 *
 * Landing → Projects: the phrase crumbles into dust and falls; the camera glides through the
 *   lattice to the plane the project panels sit on (they grow with true perspective).
 * Projects → Landing: the reverse glide; dust rises and settles back into the phrase.
 * Projects → Workspace: everything but the chosen panel fades; the panel becomes dust that
 *   spirals into a point; the point bursts into the workspace lattice; the floor's footprints
 *   are drawn, the drop lines rise, the objects appear.
 * Workspace → Projects: the workspace comes apart into dust that falls away; Projects returns.
 */
export function createNavigator({ scene, brand, landing, projects, modal, workspace, projectStore, dust, reducedMotion }) {
  const { rig, dotField, camera, viewport } = scene
  let view = 'landing'
  let transition = null
  let intro = null
  let landingReturn = null
  let uiFadeIn = null
  let hintTween = null
  let landingOpacity = 1
  let frameNow = performance.now()
  // When the current view last became idle; input streams that began earlier are ignored.
  let idleAt = frameNow

  const setBrandOpacity = (value) => {
    brand.style.opacity = value >= 1 ? '' : value.toFixed(3)
  }

  // Inside a workspace the brand sits in the corner; it only moves while it is invisible.
  const setBrandPlace = (place) => {
    if (place) {
      brand.dataset.place = place
    } else {
      delete brand.dataset.place
    }
  }

  const setLandingOpacity = (value) => {
    landingOpacity = value
    landing.setOpacity(value)
  }

  const setRoute = (hash) => {
    window.history.replaceState(null, '', hash || window.location.pathname + window.location.search)
  }

  function fadeHint(to, durationMs) {
    hintTween = { from: hintTween ? hintTween.value : 0, to, start: frameNow, duration: Math.max(1, durationMs), value: hintTween ? hintTween.value : 0 }
  }

  function updateHint() {
    const t = clamp((frameNow - hintTween.start) / hintTween.duration)
    hintTween.value = hintTween.from + (hintTween.to - hintTween.from) * easeInOutCubic(t)
    landing.setHint(hintTween.value)
  }

  // ── Intro (spec §30) ──────────────────────────────────────────────────────────────

  function updateIntro(elapsed) {
    const onLanding = !intro.deepLink && view === 'landing' && !transition

    if (reducedMotion) {
      dotField.setFade(easeOutCubic(progressBetween(elapsed, 0, 500)))
      setBrandOpacity(easeOutCubic(progressBetween(elapsed, 100, 600)))

      if (onLanding) {
        setLandingOpacity(easeOutCubic(progressBetween(elapsed, 300, 900)))

        if (!intro.hintShown && elapsed >= 900) {
          intro.hintShown = true
          fadeHint(1, 300)
        }
      }

      if (elapsed >= 900) {
        intro = null
      }

      return
    }

    const dotsEnd = INTRO.dotsFadeStartMs + INTRO.dotsFadeMs
    const brandEnd = INTRO.brandFadeStartMs + INTRO.brandFadeMs
    dotField.setFade(easeInOutCubic(progressBetween(elapsed, INTRO.dotsFadeStartMs, dotsEnd)))
    setBrandOpacity(easeOutCubic(progressBetween(elapsed, INTRO.brandFadeStartMs, brandEnd)))

    if (onLanding) {
      if (!intro.ambientStarted && elapsed >= INTRO.ambientStartMs) {
        rig.setAmbient(1, AMBIENT.rampInMs, frameNow)
        intro.ambientStarted = true
      }

      // First the caret alone, blinking; then the phrase is typed onto the screen.
      if (elapsed >= INTRO.caretStartMs) {
        landing.showCaret()
      }

      if (elapsed >= INTRO.typingStartMs) {
        landing.setTyped(Math.floor((elapsed - INTRO.typingStartMs) / INTRO.typingCharMs) + 1)
      }

      if (landing.isFullyTyped() && intro.typedAt === null) {
        intro.typedAt = elapsed
      }

      if (!intro.hintShown && intro.typedAt !== null && elapsed >= intro.typedAt + INTRO.hintDelayMs) {
        intro.hintShown = true
        fadeHint(1, INTRO.hintFadeMs)
      }
    }

    const typingDone = intro.deepLink || view !== 'landing' || intro.hintShown

    if (elapsed >= Math.max(dotsEnd, brandEnd) && typingDone) {
      intro = null
    }
  }

  function boot() {
    const route = parseRoute()
    const start = performance.now()
    intro = { start, deepLink: route.view !== 'landing', ambientStarted: false, typedAt: null, hintShown: false }
    dotField.setFade(0)
    setBrandOpacity(0)
    landing.setHint(0)
    projects.render(projectStore.list())

    const project = route.view === 'workspace' ? projectStore.get(route.projectId) : null

    if (project) {
      view = 'workspace'
      const { ready } = workspace.open(project)
      // A provisional view until the content is in (the dots are still dark by then).
      rig.setBase({ ...neutralAt(WORKSPACE.layer0Z + 9), yaw: 0, pitch: 0 })
      ready.then((target) => target && rig.setBase({ x: target.x, y: target.y, z: target.z, yaw: 0, pitch: 0 }))
      dotField.setVolume(1)
      dotField.setHiddenBand({ top: Infinity, bottom: WORKSPACE.layer0Z, visibility: 0 })
      setBrandPlace('workspace')
      landing.setActive(false)
      setLandingOpacity(0)
      projects.hide()
      workspace.setPresence(0)
      workspace.setChromeOpacity(0)
      uiFadeIn = {
        start,
        apply: (value) => {
          workspace.setPresence(value)
          workspace.setChromeOpacity(value)
        },
        done: () => workspace.setInteractive(true),
      }
      return
    }

    if (route.view !== 'landing') {
      view = 'projects'
      rig.setBase(neutralAt(VIEW_DEPTH.projects))
      landing.setActive(false)
      setLandingOpacity(0)
      projects.beginAnimating()
      projects.applyFade(0)
      uiFadeIn = {
        start,
        apply: (value) => projects.applyFade(value),
        done: () => {
          projects.setIdle()
          setRoute('#/projects')
        },
      }
      return
    }

    setRoute('')
    landing.setActive(true)
    projects.hide()

    if (reducedMotion) {
      landing.showFullText()
      setLandingOpacity(0)
    }
  }

  // ── Landing → Projects: zoom in ──────────────────────────────────────────────────────

  function canLeaveLanding() {
    if (view !== 'landing' || transition || uiFadeIn) {
      return false
    }

    const unlockMs = reducedMotion ? 600 : INTRO.navigationUnlockMs
    return !(intro && !intro.deepLink && frameNow - intro.start < unlockMs)
  }

  function glideTo(z, travelMs, now) {
    // Every key eases together, so the camera leaves the Landing sway and travels in one motion.
    rig.startMove({ to: neutralAt(z), travelMs: reducedMotion ? TRAVEL.reducedMs : travelMs, travelKeys: ALL_KEYS, jump: reducedMotion, now })
  }

  function enterProjects({ viaKeyboard = false } = {}) {
    if (!canLeaveLanding()) {
      return false
    }

    const start = performance.now()
    view = 'projects'
    landingReturn = null
    landing.setActive(false)
    projects.render(projectStore.list())
    projects.resetScroll()
    projects.measure()
    projects.beginAnimating()
    projects.applyDepth(camera.position.z, 0)
    fadeHint(0, LANDING_EXIT.hintFadeMs)

    const finish = () => {
      projects.setIdle()
      setRoute('#/projects')

      if (viaKeyboard) {
        projects.focusFirstTile()
      }
    }

    if (reducedMotion) {
      const taglineStart = landingOpacity
      glideTo(VIEW_DEPTH.projects, 0, start)
      transition = {
        frame(now, status) {
          const t = status ? status.travelT : 1
          dotField.setFade(1 - 0.85 * Math.sin(Math.PI * t))
          setLandingOpacity(taglineStart * (1 - smoothstep(0, 0.5, t)))
          projects.applyFade(smoothstep(0.5, 1, t))
          return !status || status.phase === 'done'
        },
        complete() {
          dotField.setFade(1)
          finish()
        },
      }
      return true
    }

    // The phrase crumbles into dust that falls away, wiped from the left as it goes.
    const set = landingOpacity > 0.05 ? dustFromElement(landing.getTaglineElement(), { step: 1.2, limit: 6000, minContrast: 40 }) : null
    let fall = set?.count
      ? createFall(dust, set, { start, sweepMs: LANDING_EXIT.sweepMs, lifeMs: LANDING_EXIT.dustLifeMs, onSweep: (hidden) => landing.setWipe(hidden) })
      : null
    let travelling = false
    let arrived = false
    let travelT = 0

    if (!fall) {
      setLandingOpacity(0)
    }

    transition = {
      frame(now, status) {
        if (fall && fall.step(now)) {
          fall = null
          dust.end()
        }

        if (!travelling && now - start >= (set?.count ? LANDING_EXIT.travelDelayMs : 0)) {
          // This frame's camera status predates the move; progress is read from the next one.
          travelling = true
          glideTo(VIEW_DEPTH.projects, TRAVEL.landingTravelMs, now)
        } else if (travelling) {
          travelT = status ? status.travelT : 1
          arrived ||= !status || status.phase === 'done'
        }

        projects.applyDepth(camera.position.z, smoothstep(LANDING_EXIT.headingStart, 1, travelT))
        return arrived && !fall
      },
      complete() {
        setLandingOpacity(0)
        landing.setWipe(0)
        finish()
      },
    }

    return true
  }

  // ── Projects → Landing: zoom out ─────────────────────────────────────────────────────

  function returnToLanding() {
    if (view !== 'projects' || transition || uiFadeIn || modal.isActive()) {
      return false
    }

    const start = performance.now()
    view = 'landing'
    projects.measure()
    projects.beginAnimating()
    landing.showFullText()
    glideTo(VIEW_DEPTH.landing, TRAVEL.returnTravelMs, start)

    if (reducedMotion) {
      setLandingOpacity(0)
      transition = {
        frame(now, status) {
          const t = status ? status.travelT : 1
          dotField.setFade(1 - 0.85 * Math.sin(Math.PI * t))
          projects.applyFade(1 - smoothstep(0, 0.5, t))
          setLandingOpacity(smoothstep(0.5, 1, t))
          return !status || status.phase === 'done'
        },
        complete: finishReturn,
      }
      return true
    }

    // The phrase is hidden until its dust has risen back into place.
    setLandingOpacity(1)
    landing.setWipe(1, { fromRight: true })
    let assemble = null
    let assembled = false
    let arrived = false

    transition = {
      frame(now, status) {
        const t = status ? status.travelT : 1
        arrived ||= !status || status.phase === 'done'
        // Exact mirror of the entry: heading first, then the panels recede into the depth.
        projects.applyDepth(camera.position.z, 1 - smoothstep(0, 0.18, t))

        if (!assemble && !assembled && t >= LANDING_RETURN.assembleAt) {
          const set = dustFromElement(landing.getTaglineElement(), { step: 1.2, limit: 6000, minContrast: 40 })

          if (set.count) {
            assemble = createAssemble(dust, set, {
              start: now,
              viewportHeight: viewport.height,
              flightMs: LANDING_RETURN.flightMs,
              sweepMs: LANDING_RETURN.sweepMs,
              onSweep: (shown) => landing.setWipe(1 - shown, { fromRight: true }),
            })
          } else {
            assembled = true
            landing.setWipe(0)
          }
        }

        if (assemble && assemble.step(now)) {
          assemble = null
          assembled = true
          dust.end()
        }

        return arrived && assembled
      },
      complete: finishReturn,
    }

    return true
  }

  function finishReturn() {
    dotField.setFade(1)
    projects.hide()
    landing.setWipe(0)
    setLandingOpacity(1)
    landing.setActive(true)
    setRoute('')
    landingReturn = { start: frameNow, ambientStarted: false }
    fadeHint(1, INTRO.hintFadeMs)
  }

  function updateLandingReturn() {
    const elapsed = frameNow - landingReturn.start

    if (!landingReturn.ambientStarted && elapsed >= LANDING_RETURN.ambientDelayMs) {
      rig.setAmbient(1, AMBIENT.rampInMs, frameNow)
      landingReturn.ambientStarted = true
    }

    if (landingReturn.ambientStarted) {
      landingReturn = null
    }
  }

  // ── Projects → Workspace: the big bang ───────────────────────────────────────────────

  // One burst target per grain; grains beyond the visible dots fade out on the way.
  function burstTargets(entryView, count) {
    const probe = { position: { x: entryView.x, y: entryView.y, z: entryView.z }, fov: camera.fov }
    const dots = dotField.sampleScreenDots(probe, viewport, { count: Math.min(count, ENTRY.burstTargets), floorY: entryView.floorY })
    const targets = { count, x: new Float32Array(count), y: new Float32Array(count), size: new Float32Array(count), alpha: new Float32Array(count) }

    for (let i = 0; i < count; i += 1) {
      const own = i < dots.count
      const j = own ? i : Math.floor(Math.random() * Math.max(1, dots.count))
      targets.x[i] = dots.count ? dots.x[j] : viewport.width * Math.random()
      targets.y[i] = dots.count ? dots.y[j] : viewport.height * Math.random()
      targets.size[i] = dots.count ? dots.size[j] : 1.5
      targets.alpha[i] = own ? dots.alpha[i] : 0
    }

    return targets
  }

  function openWorkspace(projectId, { fromCreate = false } = {}) {
    const project = projectStore.get(projectId)

    if (!project || view !== 'projects' || transition || uiFadeIn || (!fromCreate && modal.isActive())) {
      return false
    }

    const start = performance.now()
    view = 'workspace'
    const tile = fromCreate ? null : projects.getProjectTile(projectId)
    const source = fromCreate ? modal.getForm() : tile
    // The panel becomes dust exactly as it looks now (hover lift included), so sample it and
    // pin that look before the hover state is switched off.
    const set = source && !reducedMotion ? dustFromElement(source, { step: 2.4, limit: ENTRY.maxParticles, minContrast: 6 }) : null

    if (tile) {
      tile.style.transform = getComputedStyle(tile).transform
    }

    projects.measure()
    projects.beginAnimating()

    const { ready, prepared } = workspace.open(project)
    let entryView = null
    let isPrepared = false
    let warming = null
    let isWarm = false
    let targets = null
    ready.then((target) => {
      entryView = target
    })
    prepared.then(() => {
      isPrepared = true
    })
    workspace.setPresence(0)
    workspace.setChromeOpacity(0)

    const finish = () => {
      projects.hide()
      dotField.setFade(1)
      workspace.setStage({})
      workspace.setChromeOpacity(1)
      setBrandOpacity(1)
      workspace.setInteractive(true)
      setRoute(`#/workspace/${encodeURIComponent(project.id)}`)
    }

    const enterWorkspace = (target) => {
      rig.setBase({ x: target.x, y: target.y, z: target.z, yaw: 0, pitch: 0 })
      dotField.setVolume(1)
      dotField.setHiddenBand({ top: Infinity, bottom: WORKSPACE.layer0Z, visibility: 0 })
      setBrandPlace('workspace')
    }

    if (reducedMotion) {
      if (fromCreate) {
        modal.resolve()
      }

      transition = {
        frame(now) {
          const t = now - start
          const out = 1 - smoothstep(0, 300, t)
          projects.applyFade(out)
          setBrandOpacity(out)
          dotField.setFade(out)

          if (t < 320 || !entryView) {
            return false
          }

          if (!transition.entered) {
            transition.entered = now
            enterWorkspace(entryView)
          }

          const v = smoothstep(0, 400, now - transition.entered)
          dotField.setFade(v)
          workspace.setPresence(v)
          workspace.setChromeOpacity(v)
          setBrandOpacity(v)
          return v >= 1
        },
        complete: finish,
      }
      return true
    }

    // The chosen panel (or the form) gives way to its own dust, which starts where it stands.
    if (fromCreate) {
      modal.resolve()
    }

    const centre = { x: viewport.width / 2, y: viewport.height / 2 }
    const swirl = createSwirl(dust, set?.count ? set : { count: 0, x: [], y: [], r: [], g: [], b: [], a: [] }, { start, centre, loosenMs: ENTRY.loosenMs, swirlMs: ENTRY.swirlMs })
    let burst = null
    let burstAt = 0
    let burstDone = false
    // A virtual clock, so a skipped entry can play its remaining stages quickly.
    let clock = start
    let lastNow = start
    let speed = 1

    const gatheredAt = ENTRY.loosenMs + ENTRY.swirlMs + ENTRY.holdMs

    transition = {
      skip() {
        // Not on the second click of a double-click: only once the entry is clearly underway.
        if (clock - start > ENTRY.skipAfterMs) {
          speed = SKIP_SPEED
        }
      },
      frame(now) {
        clock += (now - lastNow) * speed
        lastNow = now
        const elapsed = clock - start
        const fade = 1 - easeOutCubic(clamp(elapsed / ENTRY.fadeMs))

        if (!burst) {
          projects.applyFocus(tile, fade)

          if (tile) {
            tile.style.opacity = (1 - smoothstep(0, ENTRY.handOverMs, elapsed)).toFixed(3)
          }

          setBrandOpacity(fade)
          dotField.setFade(fade)
          swirl.step(clock)

          // Worked out during the swirl, so the moment of the burst does no heavy lifting.
          if (entryView && !targets) {
            targets = burstTargets(entryView, swirl.count)
          }

          // The gathered point waits (still turning) until the workspace is ready to appear:
          // loaded and prepared, then drawn once invisibly (any driver pause hides in the point).
          if (elapsed >= gatheredAt && isPrepared && !warming) {
            warming = workspace.warmUp().then(() => {
              isWarm = true
            })
          }

          const waitedEnough = elapsed >= gatheredAt + ENTRY.maxWaitMs
          const ready = targets && (isWarm || waitedEnough)

          if (elapsed >= gatheredAt && ready) {
            // All is dark: step into the workspace unseen, then let the point burst.
            enterWorkspace(entryView)
            workspace.setStage({ grid: 0, footprints: 0, drops: 0, objects: 0 })
            burst = createBurst(dust, swirl, targets, { start: clock, centre, durationMs: ENTRY.burstMs, handOffMs: ENTRY.burstHandOffMs })
            burstAt = clock
          }

          return false
        }

        const t = clock - burstAt

        if (!burstDone && burst.step(clock)) {
          burstDone = true
          dust.end()
        }

        // The real lattice takes over from the dust as it arrives.
        dotField.setFade(smoothstep(ENTRY.burstMs * 0.7, ENTRY.burstMs + ENTRY.burstHandOffMs, t))
        workspace.setStage({
          grid: easeOutCubic(progressBetween(t, ENTRY.floorAt, ENTRY.floorAt + ENTRY.floorMs)),
          footprints: easeInOutCubic(progressBetween(t, ENTRY.footprintsAt, ENTRY.footprintsAt + ENTRY.footprintsMs)),
          drops: easeInOutCubic(progressBetween(t, ENTRY.dropsAt, ENTRY.dropsAt + ENTRY.dropsMs)),
          objects: easeOutCubic(progressBetween(t, ENTRY.objectsAt, ENTRY.objectsAt + ENTRY.objectsMs)),
        })

        const chrome = easeOutCubic(progressBetween(t, ENTRY.chromeAt, ENTRY.chromeAt + ENTRY.chromeMs))
        workspace.setChromeOpacity(chrome)
        setBrandOpacity(chrome)
        return burstDone && t >= ENTRY.chromeAt + ENTRY.chromeMs
      },
      complete: finish,
    }

    return true
  }

  // ── Workspace → Projects: the workspace falls away as dust ───────────────────────────

  function closeWorkspace() {
    if (view !== 'workspace' || transition || uiFadeIn) {
      return false
    }

    const start = performance.now()
    const projectId = workspace.getProjectId()
    view = 'projects'
    workspace.setInteractive(false)
    workspace.prepareClose()
    projects.render(projectStore.list())
    projects.resetScroll()
    projects.measure()
    projects.beginAnimating()
    projects.applyFade(0)

    const leaveWorkspace = () => {
      workspace.close()
      dotField.setVolume(0)
      dotField.setHiddenBand(null)
      rig.setBase(neutralAt(VIEW_DEPTH.projects))
      setBrandPlace(null)
    }

    const finish = () => {
      dotField.setFade(1)
      setBrandOpacity(1)
      projects.setIdle()
      setRoute('#/projects')
      projects.getProjectTile(projectId)?.focus({ preventScroll: true })
    }

    if (reducedMotion) {
      transition = {
        frame(now) {
          const t = now - start
          const out = 1 - smoothstep(0, 300, t)
          workspace.setPresence(out)
          workspace.setChromeOpacity(out)
          dotField.setFade(out)
          setBrandOpacity(out)

          if (t < 320) {
            return false
          }

          if (!transition.left) {
            transition.left = true
            leaveWorkspace()
          }

          const v = smoothstep(320, 720, t)
          dotField.setFade(v)
          projects.applyFade(v)
          setBrandOpacity(v)
          return v >= 1
        },
        complete: finish,
      }
      return true
    }

    // The 3D view, as it is now, becomes dust; the real scene goes dark underneath it.
    const set = dustFromFrame(scene.captureFrame(), viewport, { step: EXIT.particleStepPx, limit: EXIT.maxParticles, minContrast: 16 })
    workspace.setPresence(0)
    dotField.setFade(0)
    let fall = set.count ? createFallAway(dust, set, { start, viewportHeight: viewport.height, spreadMs: EXIT.spreadMs }) : null
    let left = false

    transition = {
      frame(now) {
        const t = now - start
        const chrome = 1 - easeOutCubic(clamp(t / EXIT.chromeFadeMs))
        workspace.setChromeOpacity(chrome)

        if (!left) {
          setBrandOpacity(chrome)
        }

        if (fall && fall.step(now)) {
          fall = null
          dust.end()
        }

        if (!left && t >= EXIT.chromeFadeMs) {
          left = true
          leaveWorkspace()
        }

        const back = easeOutCubic(progressBetween(t, EXIT.projectsAt, EXIT.projectsAt + EXIT.projectsFadeMs))

        if (left) {
          projects.applyFade(back)
          dotField.setFade(back)
          setBrandOpacity(back)
        }

        return left && !fall && back >= 1
      },
      complete: finish,
    }

    return true
  }

  // ── Frame loop hook ───────────────────────────────────────────────────────────────────

  function frame(now) {
    frameNow = now

    if (intro) {
      updateIntro(now - intro.start)
    }

    const status = rig.update(now)

    if (transition && transition.frame(now, status)) {
      const finished = transition
      transition = null
      idleAt = now
      finished.complete()
    }

    if (landingReturn) {
      updateLandingReturn()
    }

    if (hintTween) {
      updateHint()
    }

    if (uiFadeIn) {
      const value = easeOutCubic(progressBetween(now - uiFadeIn.start, INTRO.deepLinkUiStartMs, INTRO.deepLinkUiStartMs + INTRO.deepLinkUiFadeMs))
      uiFadeIn.apply(value)

      if (value >= 1) {
        const { done } = uiFadeIn
        uiFadeIn = null
        idleAt = now
        done()
      }
    }

    modal.frame(now)
    workspace.frame(now)
  }

  return {
    boot,
    frame,
    canLeaveLanding,
    enterProjects,
    returnToLanding,
    openWorkspace,
    closeWorkspace,
    // A click or key during a long transition hurries it along (where supported).
    skipTransition() {
      transition?.skip?.()
    },
    getView: () => view,
    getIdleAt: () => idleAt,
    isTransitioning: () => transition !== null || uiFadeIn !== null,
    isIdleIn: (name) => view === name && transition === null && uiFadeIn === null,
  }
}
