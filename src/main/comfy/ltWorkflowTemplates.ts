/** Library workflow JSON filenames shipped under `resources/comfy-workflows/`. */
export const LT_BUNDLED_WORKFLOW_DIR = 'comfy-workflows'

export const LT_LIBRARY_WORKFLOW_FILES: Array<{
  basename: string
  /** Short label for docs / status UI. */
  hint: string
}> = [
  {
    basename: 'comfy-workflow-validation.json',
    hint: 'Validation Steps, Weight, and Model Stress-Testing'
  },
  {
    basename: 'comfy-workflow-upscale.json',
    hint: 'Upscale / Detail'
  },
  {
    basename: 'comfy-workflow-context.json',
    hint: 'Diversify · Context'
  },
  {
    basename: 'comfy-workflow-expression.json',
    hint: 'Diversify · Expression'
  }
]

/** @deprecated Use LT_LIBRARY_WORKFLOW_FILES — kept for call-site renames. */
export const LT_LIBRARY_WORKFLOW_TEMPLATES = LT_LIBRARY_WORKFLOW_FILES
