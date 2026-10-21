# Validation Steps, Weight & Model Stress-Testing (ComfyUI)

**Scope:** Comfy graphs for these tools are built and tested for **Krea 2** (`models/diffusion_models`). Other checkpoint families are not supported in this release.

All three tools share the **same** captured Validation workflow (`comfy-workflow-validation.json`) and LT inject nodes. What changes is which input is fixed and which varies each job.

| Tab | Fixed per set | Varies each job | Folders |
| --- | --- | --- | --- |
| **Validation Steps** | One Comfy model, prompt, seed, weight | Every keep-in-Comfy LoRA missing a preview | `output/Set N/{loraStem}.jpg` |
| **Validation Weight** | One LoRA checkpoint, model, prompt, seed | Weight = min…max by step | `output/Weight N/{checkpointStem}_{weight}.jpg` |
| **Model Stress-Testing** | One LoRA checkpoint, prompt, seed, weight | Every ticked Comfy model missing a preview | `output/Stress N/{modelStem}_{shortHash}.jpg` |

---

## Prerequisites

The six Comfy-only dataset tabs—Validation Steps, Validation Weight, Model Stress-Testing, Upscale, Context, and Expression—are hidden until **Settings → External tools → ComfyUI → LoRAs** is set. Image-menu Upscale/Diversify commands, Comfy checkpoint controls, and Output validation-preview details use the same gate. Existing output checkpoints remain visible.

1. ComfyUI running; host/port and **LoRAs** set in **Settings**. LoraTraining does **not** install or configure ComfyUI for you.
2. LT custom nodes installed via **Settings → External tools → ComfyUI → Install LT Comfy package** (see [`../comfyui-lora-training/`](../comfyui-lora-training/)).
3. Any other custom nodes the Krea 2 graph needs: install once with **ComfyUI Manager**. Any weights the graph loads: download once into the matching `ComfyUI/models/…` folder.
4. Workflow captured/saved from Validation Steps, Validation Weight, or Model Stress-Testing **Edit Workflow → Save workflow** (same file; LT inject nodes present).
5. Dataset has checkpoints under `output/` (after training).

---

## Validation Steps sets

Stored on the dataset record as `validationSets[]`:

| Field | Meaning |
| --- | --- |
| `prompt` | Injected into LT prompt node |
| `seed` | Sampler seed; ≤0 → random per job. New Steps sets default to 0; new Weight/Stress sets default to fixed seed 1 |
| `loraWeight` | LoRA strength |
| `styleIndex` | UI labels **Real** (0) / **Anime** (1) |
| `validationModel` | Comfy checkpoint (`"Default"` → Settings → External tools → ComfyUI → Model) |
| `existingCopyPolicy` | Stored policy only; there is no preview-panel control. `reuse_if_identical_error_if_different` is the default; `overwrite_if_different` is the other stored value |

Folders: `{dataset}/output/Set 1`, `Set 2`, …

The play-icon **Run all sets** walks Set 1→N and, for each set, queues one Comfy job per missing LoRA preview.

Validation Steps alone has **Clone…**. Choose another Validated dataset, then **Add to current** and confirm **Add sets** to append its Steps sets, or **Overwrite** to replace the current Steps sets. Weight and Stress do not have Clone.

All three preview tools have add-set, remove-set, and **Clear images** actions. Clear images asks first, cancels an active run for that set, and deletes only that set’s preview JPGs—not checkpoints.

Prompt fields on Validation Steps, Weight, Stress, and Upscale highlight Dynamic Prompts syntax and autocomplete from **Settings → External tools → ComfyUI → Wildcards**. Diversify and training sample prompts do not. On Validation Steps, the dice icon **Fill prompt from a random dataset caption** replaces the active set prompt with one randomly selected caption.

Each **Edit Workflow** pane has **Reload** to reload its ComfyUI webview and **Save workflow** to capture the graph.

---

## Validation Weight sets

Stored as `weightSets[]`:

| Field | Meaning |
| --- | --- |
| `prompt` / `seed` / `styleIndex` / `validationModel` / `existingCopyPolicy` | Same as Validation Steps (no single `loraWeight`) |
| `checkpointFileName` | Basename of the chosen LoRA under `output/` |
| `weightMin` / `weightMax` / `weightStep` | Inclusive sweep (defaults `0.6` / `1.4` / `0.2`; last-used in `settings.lastWeightRange`) |

Folders: `{dataset}/output/Weight 1`, `Weight 2`, …  
Preview filename = `{checkpointStem}_{weight}.jpg` (e.g. `MyLora_000500_0.6.jpg`, `…_1.0.jpg`). Whole-number weights keep one decimal place so explorers sort with fractional weights. Same seed for every weight in a set.

**Run** walks Weight 1→N and, for each set, queues one Comfy job per missing weight preview (same checkpoint + model each time). Weight is injected via `<lora:stem:w>` in the shared validation prompt path.

---

## Model Stress-Testing sets

Stored as `stressTestSets[]`:

| Field | Meaning |
| --- | --- |
| `prompt` / `seed` / `loraWeight` / `styleIndex` / `existingCopyPolicy` | Same as Validation Steps |
| `models` | **Select models…** opens **Models to stress-test**. Ticked Comfy model names. **Apply** writes `settings.lastStressModels` (global default until the next Apply). New datasets’ Stress 1 and newly added stress sets use that default |
| `checkpointFileName` | Basename of the chosen LoRA under `output/` |

Folders: `{dataset}/output/Stress 1`, `Stress 2`, …  
Preview filename = sanitized model basename + `_` + short hash of the full Comfy model id (so two `foo.safetensors` in different folders never share a file). Older basename-only JPGs still count as “already done” for that model.

**Run** walks Stress 1→N in model-list order (Apply sorts A→Z) and queues one Comfy job per selected model that still lacks a preview. Before each set, models no longer listed by Comfy (deleted/renamed weights) are **dropped from the selection automatically** — not reported as failures. A model that errors for other reasons is **skipped** (banner shows `FAILED · {model}: …`); the run continues with the rest and ends with a summary of every failure.

Untick models that reliably kill Comfy (especially `int8_convrot` / similar) before long overnight runs.

### Stress Compare

**Compare models** opens the overview grid of Stress previews: models as rows, stress sets as columns. Layout (model order, set order, collapsed model rows) is stored on the dataset (`stressCompareModelOrder`, `stressCompareSetOrder`, `stressCompareCollapsedModels`).

Validation Steps, Weight, and Stress-Test cannot run at the same time (shared Comfy VRAM).

Mutual-exclusion errors name both the blocker and requested action:

- `A model stress-test run is in progress — stop it before validating.`
- `A validation-weight run is in progress — stop it before validating.`
- `A LoRA validation run is in progress — stop it before weight validation.`
- `A model stress-test run is in progress — stop it before weight validation.`
- `A LoRA validation run is in progress — stop it before stress-testing.`
- `A validation-weight run is in progress — stop it before stress-testing.`

## Cross-dataset Run (overnight continuum)

Clicking the play-icon **Run all sets** on Validation Steps, Validation Weight, or Model Stress-Testing:

1. Finishes unfinished work on the current dataset (that tool’s sets).
2. Then automatically continues to the next unfinished job on **trained** datasets — all three tools share the same continuum (no separate queue UI).
3. Per dataset order: **Validation Steps → Validation Weight → Stress Test**, then the next trained dataset.
4. Skips datasets/sets that aren’t configured (e.g. weight set with no checkpoint, stress set with no LoRA/models).
5. **Stop** cancels the current Comfy job and stops the continuum.

The header always uses **Validating · {set label}** and jumps to whichever run is active. The in-pane status uses **Validation Steps · Set N**, **Validation Weight · Set N**, or **Stress Test · …**.

Preview JPGs can be rated 0–5 stars. Zero is an explicit rating; unrated is separate. Clear rating returns to unrated. **Delete image** opens **Delete preview image?** and removes that JPG only.

## Dataset “Validated” badge

`validated` is **not** sticky from the first preview. It is true only when **every** Validation Steps set has a preview for **every keep-in-Comfy** checkpoint under `output/`, **and** no open job (draft / queued / running / paused) plans steps beyond the highest on-disk checkpoint. Datasets with **no** keep-in-Comfy checkpoints are **not** Validated (empty output is not vacuously complete).

- Library load (`listDatasets`) retests every dataset still marked Validated and demotes incomplete ones; a successful output scan with no checkpoints also clears a false sticky **Trained** badge.
- Creating / updating / enqueueing a job with a higher step target demotes Validated immediately (further training).
- Resume training / each `save_every` checkpoint (and job complete) re-syncs and broadcasts library tile flags immediately.
- Unticking a checkpoint (Keep in Comfy off) can make an incomplete set complete again only when at least one checkpoint remains included.
- Validation Weight and Stress-Testing previews do **not** affect this badge.
- With AI Toolkit Work dir configured, the Output tab lists **Pending** rows for planned further steps (not on disk yet). Those rows are hidden while training UI is unavailable.

## Dataset “Done” badge

`done` is set **only** by the user via **Mark as Done** at the bottom of the Output / Validation Steps / Weight / Stress middle panes (requires Validated). The main process refuses the mark unless **Settings → External tools → ComfyUI → Wildcards** contains a `<lora:…>` reference whose root name (before a digit/brace step suffix) matches the dataset’s LoRA stem. Demoting Validated clears Done.

---

## Workflow

Edit Workflow on any of the three tabs opens the same Validation graph. **Save workflow** writes `comfy-workflow-validation.json` under the library root only after the graph loads, opens a named confirmation such as **Save Validation**, and first writes `!WorkflowBackups`. Save is refused if the backup cannot be written.

