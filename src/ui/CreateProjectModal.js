export function CreateProjectModal({ state = {} } = {}) {
  if (state.createModalOpen !== true) {
    return ''
  }

  return `
    <div class="create-modal" aria-modal="true" role="dialog" aria-label="Create project">
      <div class="create-modal__backdrop" data-action="close-create-modal" aria-hidden="true"></div>

      <form class="create-form" data-create-form novalidate>
        <div class="create-form__header">
          <p class="eyebrow">CREATE</p>
          <button type="button" class="icon-button" data-action="close-create-modal" aria-label="Close create project form">
            ×
          </button>
        </div>

        <label class="field">
          <span>PROJECT NAME</span>
          <input type="text" name="name" placeholder="Project name" required />
        </label>

        <label class="field">
          <span>PROJECT CATEGORY</span>
          <input type="text" name="category" placeholder="Category" />
        </label>

        <label class="field">
          <span>PROJECT DESCRIPTION</span>
          <textarea name="description" rows="4" placeholder="Short description"></textarea>
        </label>

        <div class="form-actions">
          <button type="submit" class="submit-button">CREATE</button>
        </div>

        <p class="form-error" aria-live="polite"></p>
      </form>
    </div>
  `
}
