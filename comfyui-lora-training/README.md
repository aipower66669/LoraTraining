# LoraTraining — ComfyUI contract nodes

**Krea 2 workflows.** These LT nodes inject app-driven inputs into a Comfy graph wired for Krea 2 (`models/diffusion_models`). Other checkpoint families are not supported in this release.

**Recommended:** In LoraTraining, open **Settings → ComfyUI**, set **Comfy root**, and click **Install LT Comfy package**. That copies this folder into `{Comfy root}/custom_nodes/comfyui-lora-training/` and seeds the shipped working graphs from `resources/comfy-workflows/` into your library when missing. Restart ComfyUI.

This pack is **only** the LT inject nodes. Full Krea 2 workflow JSON ships separately under `resources/comfy-workflows/`. LoraTraining does not install ComfyUI, other custom-node packages, or model files. When a workflow shows missing nodes, use **ComfyUI Manager**. Download checkpoints / VAE / CLIP / upscalers into the matching `models/` sub-folder yourself. Do that once per Comfy install.

**Manual (dev checkout):** copy or symlink this folder into ComfyUI `custom_nodes/`, then restart ComfyUI.

## Nodes (category: **Lora Training**)

| Class | Display | Role |
|-------|---------|------|
| `LoraTrainingPrompt` | LT · Prompt | Positive prompt from the app (includes `<lora:…:weight> trigger`). Also copies the checkpoint into `{lorasFolder}/{validationSubfolder}/`. |
| `LoraTrainingSeed` | LT · Seed | Seed INT (`value` input — not named `seed`, so no Comfy randomize widget) |
| `LoraTrainingStyleIndex` | LT · Style Index | `0` = realistic, `1` = anime — per validation set |
| `LoraTrainingModel` | LT · Model | Checkpoint filename STRING (from app Settings default or per-dataset override) |
| `LoraTrainingOutputFolder` | LT · Output Folder | Absolute path to `{dataset}/output/Set N` |
| `LoraTrainingOutputFilename` | LT · Output Filename | Preview stem for the LoRA under validation (no extension) |

CLIP, VAE, size, and negative prompt stay in the ComfyUI graph (not driven by the app). Checkpoint is driven via **LT · Model** when the app has a model selected.

## Wiring tips

1. **LT · Prompt** → Dynamic Prompts / CLIP / Load LoRA Tag path (app injects the LoRA tag + stages the file).
2. **LT · Seed** → sampler / Set→Get seed chain (and Dynamic Prompts `seed`).
3. **LT · Style Index** → replace your manual 0/1 text→INT switch; wire into Select Per-Line index inputs for style wildcards + negatives.
4. **LT · Model** → on **Load Diffusion Model**, convert `unet_name` to an input (right‑click the widget), then connect LT · Model’s output into that socket. Same for CheckpointLoader `ckpt_name`. (Output is a wildcard type — plain STRING cannot link to those COMBO inputs.)
5. **LT · Output Folder** + **LT · Output Filename** → save node. Previews land in `output/Set N/`.
6. In LoraTraining: **Settings → ComfyUI** set **LoRA folder**, **Validation LoRA subfolder**, and **Default validation model**, then **Edit Workflow** → Save → Validate → Run.

## Diversify (Context / Expression)

Diversify reuses the same LT contract nodes (**Input Image**, **Prompt**, **Seed**, optional **Model** / **Style Index**, **Output Folder**, **Output Filename**). Capture a separate graph under **Context → Edit Workflow** or **Expression → Edit Workflow**. The app injects the LT inputs and writes `{root}_dNN` siblings into the dataset.

## Dynamic Prompts

The app forces `autorefresh` to **No** on Dynamic Prompts nodes when queueing (their Yes mode can discard the seeded RNG). In the app, seed **≤ 0** means a fresh random seed per job (also avoids Dynamic Prompts ignoring `0`).
