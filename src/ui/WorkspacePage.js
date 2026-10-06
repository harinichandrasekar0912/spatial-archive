import { ICON } from '../utils/dom.js'

// Images, PDFs, 3D models (+ their MTL / BIN / texture companions) and SketchUp files.
export const ACCEPTED_FILE_TYPES = 'image/jpeg,image/png,image/webp,image/svg+xml,application/pdf,.glb,.gltf,.bin,.obj,.mtl,.dae,.stl,.fbx,.skp'

const ARROW_UP = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9.5v-7M3 5l3-3 3 3"/></svg>'
const ARROW_DOWN = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 2.5v7M3 7l3 3 3-3"/></svg>'

/*
 * Workspace chrome (spec §87): + top-left, X top-right, home bottom-left.
 * The cards themselves are Three.js objects inside the dot lattice; this layer only carries
 * pointer input, the constant-size selection controls and temporary depth cues.
 */
export function WorkspacePage() {
  return `
    <section class="view workspace" data-view="workspace" aria-labelledby="workspace-title">
      <div class="workspace-canvas" data-workspace-canvas tabindex="-1" aria-label="Workspace volume">
        <div class="depth-guide" data-depth-guide hidden aria-hidden="true"></div>

        <div class="selection" data-selection hidden>
          <div class="selection__frame" data-selection-frame></div>
          <svg class="selection__outline" data-selection-outline aria-hidden="true" focusable="false"><polygon points="" /></svg>
          <div class="selection__depth" data-selection-depth>
            <button type="button" data-action="layer-back" aria-label="Push back one layer">${ARROW_UP}</button>
            <span data-layer-label>LAYER 0</span>
            <button type="button" data-action="layer-forward" aria-label="Bring forward one layer">${ARROW_DOWN}</button>
          </div>
          <button type="button" class="selection__delete" data-action="delete-selected" aria-label="Delete selected item">${ICON.close}</button>
          <span class="selection__resize" data-resize-handle aria-hidden="true"></span>
        </div>

        <div class="note-layer" data-note-layer></div>
      </div>

      <ul class="sr-only" data-item-list aria-label="Items in this workspace"></ul>

      <div class="workspace-chrome" data-workspace-chrome>
        <h2 class="view-heading workspace-title" id="workspace-title" data-workspace-title></h2>

        <div class="add-control">
          <button type="button" class="chrome-button" data-action="toggle-add-menu" aria-expanded="false" aria-controls="add-menu" aria-label="Add to workspace">${ICON.plusBold}</button>
          <div class="add-menu" id="add-menu" data-add-menu hidden>
            <button type="button" class="add-menu__item" data-action="add-note">NOTE</button>
            <button type="button" class="add-menu__item" data-action="add-file">FILE</button>
          </div>
          <input type="file" data-file-input multiple accept="${ACCEPTED_FILE_TYPES}" hidden />
        </div>

        <button type="button" class="chrome-button workspace-close" data-action="close-workspace" aria-label="Back to projects">${ICON.closeBold}</button>
        <button type="button" class="chrome-button workspace-home" data-action="home" aria-label="Show everything">${ICON.homeSolid}</button>

        <p class="workspace-empty" data-workspace-empty>Add a note, file or 3D model with +, or drop files anywhere.</p>
        <p class="workspace-status" data-workspace-status role="status" hidden></p>
      </div>

      ${FocusView()}
    </section>
  `
}

function FocusView() {
  return `
    <div class="focus-view" data-focus-view role="dialog" aria-modal="true" aria-labelledby="focus-title" inert>
      <div class="focus-view__backdrop" data-focus-close></div>

      <div class="focus-view__panel" data-focus-panel>
        <div class="focus-view__media" data-focus-media></div>

        <form class="focus-view__meta" data-focus-form>
          <div class="focus-view__header">
            <p class="focus-view__type" id="focus-title" data-focus-type></p>
            <button type="button" class="icon-button" data-focus-close aria-label="Close">${ICON.close}</button>
          </div>

          <label class="field">
            <span class="field__label">TITLE</span>
            <input type="text" name="title" autocomplete="off" maxlength="120" />
          </label>

          <label class="field">
            <span class="field__label">TAGS</span>
            <input type="text" name="tags" autocomplete="off" placeholder="facade, water, material" />
          </label>

          <label class="field">
            <span class="field__label">NOTES</span>
            <textarea name="notes" rows="5"></textarea>
          </label>

          <div class="field" data-focus-appearance role="group" aria-labelledby="focus-appearance-label" hidden>
            <span class="field__label" id="focus-appearance-label">APPEARANCE</span>
            <div class="segmented">
              <button type="button" data-appearance="white" aria-pressed="true">White model</button>
              <button type="button" data-appearance="original" aria-pressed="false">Materials</button>
            </div>
          </div>

          <dl class="focus-view__facts" data-focus-facts></dl>
        </form>
      </div>
    </div>
  `
}
