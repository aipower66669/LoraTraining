# Bundled ComfyUI workflows (Krea 2)

Working graphs shipped with LoraTraining. On **Install LT Comfy package** / **Seed starter workflows**, each file is copied into `{libraryRoot}/` **only when missing** (never overwrites a user’s saved graph).

| File | Tools |
| --- | --- |
| `comfy-workflow-validation.json` | Validation Steps, Weight, Stress |
| `comfy-workflow-upscale.json` | Upscale |
| `comfy-workflow-context.json` | Diversify · Context |
| `comfy-workflow-expression.json` | Diversify · Expression |

These are full Krea 2–adapted API workflows (LT inject nodes + loaders/samplers). Users still need the matching models and any extra Comfy Manager packs — see [docs/COMFY_MODELS.md](../docs/COMFY_MODELS.md).

## Refreshing from a known-good library

After improving graphs in LoraTraining (**Edit Workflow → Save**), copy from the library root into this folder (no machine-specific absolute paths):

```bash
# PowerShell example
Copy-Item "$env:LIBRARY\comfy-workflow-*.json" .\resources\comfy-workflows\ -Force
```

Then commit the updated JSON so the next installer ships them.
