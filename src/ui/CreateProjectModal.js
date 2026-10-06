import { ICON } from '../utils/dom.js'

// Always in the DOM (hidden + inert when closed) so opening never mounts anything mid-animation.
export function CreateProjectModal() {
  return `
    <div class="create-modal" data-create-modal role="dialog" aria-modal="true" aria-labelledby="create-title" inert>
      <div class="create-modal__backdrop" data-create-backdrop></div>

      <form class="create-form" data-create-form novalidate>
        <div class="create-form__header">
          <h2 class="create-form__title" id="create-title">CREATE</h2>
          <button type="button" class="icon-button" data-create-close aria-label="Close">${ICON.close}</button>
        </div>

        <label class="field">
          <span class="field__label">PROJECT NAME</span>
          <input type="text" name="name" required aria-required="true" autocomplete="off" maxlength="80" />
        </label>

        <label class="field">
          <span class="field__label">PROJECT CATEGORY</span>
          <input type="text" name="category" autocomplete="off" maxlength="60" />
        </label>

        <label class="field">
          <span class="field__label">PROJECT DESCRIPTION</span>
          <textarea name="description" rows="3" maxlength="400"></textarea>
        </label>

        <div class="form-footer">
          <p class="form-error" data-create-error aria-live="polite"></p>
          <button type="submit" class="submit-button">CREATE</button>
        </div>
      </form>
    </div>
  `
}
