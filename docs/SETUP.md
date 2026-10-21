# Setup guide

Step-by-step first-time setup for **LoraTraining** on Windows.

**Audience:** Experienced local-AI users. This is **not** a consumer install guide for AI Toolkit, ComfyUI, JoyCaption, CUDA, or Python.

**Before configuring LoraTraining**, confirm that:

1. **AI Toolkit** can complete a **Krea 2** training run independently.
2. **ComfyUI** (and any nodes/models your graphs need) operates correctly outside LoraTraining.
3. **Captioning** (if you want automated captions): a CUDA Python venv that can run the bundled JoyCaption script against the HF model below.

Upstream installation and dependency troubleshooting are **outside this project’s scope**. Failures in CUDA, venvs, model downloads, or Comfy Manager packs are not LoraTraining defects.

**What this guide covers (LoraTraining only):**

| In scope | Out of scope |
| --- | --- |
| Which external tools each feature needs | Installing / repairing those tools |
| Paths, ports, scripts, and Settings fields LoraTraining expects | CUDA, Python, Hugging Face downloads |
| **Test** buttons to verify a connection | Fixing broken upstream installs |
| Wiring an **already-working** install into Settings | Maintaining Comfy custom nodes or model folders |
| What stays usable when a tool is not configured | Turnkey “make Comfy work” packaging |

**Scope (product):** LoraTraining is a **Krea 2 text-to-image LoRA** UI for **dataset management and job orchestration** on top of [AI Toolkit](https://github.com/ostris/ai-toolkit). **It does not train models** — AI Toolkit does when you enqueue and start the queue. Training defaults and Comfy preview workflows target **Krea 2** only.

Upstream docs (install there, not here):

| Tool | Install & usage |
| --- | --- |
| AI Toolkit | [github.com/ostris/ai-toolkit](https://github.com/ostris/ai-toolkit) |
| ComfyUI | [github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI) |
| Caption model | [fancyfeast/llama-joycaption-beta-one-hf-llava](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava) (HF — used by the bundled script; **no** JoyCaption GitHub clone required) |

Once AI Toolkit / Comfy work on their own (and you have a caption venv if you want auto-captions): install LoraTraining → set library root → point Settings at them → dataset → caption → train → (optional) validate.

---

## Overview

| Step | What | Required for |
| --- | --- | --- |
| 1 | Install LoraTraining | Everything |
| 2 | Library root | Datasets, jobs, settings |
| 3 | [AI Toolkit](#3-ai-toolkit-training) | Training LoRAs |
| 4 | [JoyCaption](#4-joycaption-captions) | Automated captions |
| 5 | [ComfyUI](#5-comfyui-validation--preview-tools) | Validation, Upscale, Diversify (Context/Expression) |
| 6 | Categories & datasets | Organising your image folders |
| 7 | First train run | End-to-end proof |
| 8 | Comfy workflows | Preview / validate after training |

Minimum to **train**: steps 1–2, 3, 4, 6–7.  
Minimum to **validate in Comfy**: also 5 and 8.

### Without every tool configured

LoraTraining still opens and manages your library. Unconfigured tools simply stay unavailable (tabs / actions stay hidden or disabled until Settings paths are set):

| Missing | Still available | Unavailable |
| --- | --- | --- |
| JoyCaption | Manual captions and dataset management | Automatic caption controls and dataset Description |
| AI Toolkit | Dataset management, existing outputs, Comfy tools (if set) | Jobs, Queue, job actions/drawer, pending rows, Default training config |
| ComfyUI | Library, captions, training, existing checkpoints | Validation / Weight / Stress / Upscale / Context / Expression and Comfy output controls |

---

## 1. Install LoraTraining

**Option A — GitHub Release (recommended)**

1. Download the latest installer from [GitHub Releases](https://github.com/aipower66669/LoraTraining/releases/latest).
2. Optionally verify SHA-256 against `SHA256SUMS.txt` on the same release ([BUILD.md](BUILD.md#unsigned-installer--smartscreen)).
3. Run `LoraTraining Setup X.Y.Z.exe`. The installer is **unsigned** — SmartScreen may warn; use **More info → Run anyway** if you trust the release.
4. Launch **LoraTraining** from the Start menu.

**Option B — From source**

```bash
git clone https://github.com/aipower66669/LoraTraining.git
cd LoraTraining
npm ci
npm run dev
```

Use `npm install` instead when intentionally changing dependencies.

Build an installer locally: [BUILD.md](BUILD.md).

---

## 2. Library root

On first launch, open **Settings → External tools → Library**. There is no automatic folder picker:

1. Choose a folder for your **library** — e.g. `F:\LoRA-Library`.
2. LoraTraining creates root metadata there (`categories.json`, `settings.json`, `!Jobs`, Comfy workflow captures). Each dataset gets its own `!Thumbnails` cache.
3. New category and dataset folders normally live under this library root. Legacy/fallback label categories can still point at an external dataset folder. Back up the library plus any such external folders.
4. Leave **NTFS versions** off for normal overwrite-on-save behavior. Advanced users may enable it to keep up to four Edit image/Upscale versions, but only for datasets hosted on NTFS drives.

AppData (`%APPDATA%\lora-training\`) only stores a pointer to this folder and window geometry — disposable.

Details: [PROJECT_FORMAT.md](PROJECT_FORMAT.md).

---

## 3. AI Toolkit (training)

**Upstream (install there, not here):** [ostris/ai-toolkit](https://github.com/ostris/ai-toolkit)

Confirm AI Toolkit can complete a **Krea 2** training run on its own (sample YAML + your checkpoint) **before** wiring it here. LoraTraining only materialises YAML and calls your toolkit’s `run.py` — it will not fix a broken toolkit, venv, or CUDA install.

Setting AI Toolkit **Work dir** reveals Jobs, Queue, Create/Open Job, the queue drawer, and Settings **Default training config**. Until then the app stays in dataset-management mode.

**Models:** **Krea 2 only.** Point **Settings → External tools → Training model** at your Krea 2 RAW checkpoint (`krea2`, turbo, or either Edit Training variant). Quantize, Low VRAM, and Layer offloading apply to that base.

### Configure in LoraTraining
**Settings → External tools → AI Toolkit**

| Field | Typical value |
| --- | --- |
| Work dir | `F:\AI\ai-toolkit` (toolkit root) |
| Python | `F:\AI\ai-toolkit\venv\Scripts\python.exe`, or blank for Work dir `venv` / `PATH` resolution |
| Script | `run.py` |

Click **Test AI Toolkit** — expect OK with Python version + script found. The schema can preserve `extraArgs`, but the screen has no Extra args field.

### Training model (global)

**Settings → External tools → Training model** — **Krea 2 only.** Set once for all jobs:

- Krea 2 RAW checkpoint path (`name_or_path`)
- Architecture: raw, turbo, raw Edit Training, or turbo Edit Training
- Low VRAM and Quantize toggles
- Layer offloading: transformer 0–100%, in 5% steps

These overlay every job YAML at run time (D26). Quantization type, text-encoder quantization/offload, and model kwargs have no controls. Per-job settings on the Jobs screen cover steps, LR, dataset paths, LoRA name, etc.

### Windows note

Large **Krea 2** checkpoints on Windows may hit **OSError 1455** (mmap commit charge). LoraTraining wraps training with `train_bootstrap.py` automatically. If commit is exhausted, reboot or kill leftover `python.exe` before retrying. See [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md).

Contract: [EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md#ai-toolkit).

---

## 4. JoyCaption (captions)

Setting JoyCaption **Work dir** reveals automatic-caption controls and dataset **Description**. If it is left blank, manual caption editing and bulk caption tools remain available.

LoraTraining ships `kohya_joycaption_captioner_v5_3.py` under `resources/joycaption/`. That CLI is **self-contained**: it does **not** import or call [fpgaminer/joycaption](https://github.com/fpgaminer/joycaption) (or anything under a JoyCaption Git clone). “JoyCaption” here is the **model name** and Settings label.

**What you need:** a CUDA Python venv with packages that can load a Hugging Face LLaVA checkpoint (typically `torch`, `transformers`, `bitsandbytes`, `accelerate`, `Pillow`, `tqdm`, `colorama`). Point Settings **Work dir** at that venv’s root (or any folder — cwd only). You do **not** need to install the JoyCaption GitHub project.

### Fixed model (one-time)

Hard-coded in the shipped captioner as `MODEL_NAME` — LoraTraining does **not** download it. Loaded via `transformers` `LlavaForConditionalGeneration.from_pretrained` + NF4 (`BitsAndBytesConfig`).

| Model id | Hugging Face |
| --- | --- |
| `fancyfeast/llama-joycaption-beta-one-hf-llava` | [Repo](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava) · [Files](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava/tree/main) |

On first caption run, `from_pretrained(MODEL_NAME)` pulls the snapshot into the Hugging Face cache (typically `%USERPROFILE%\.cache\huggingface\hub\`). You can also download the repo yourself beforehand if you prefer offline first launch. Changing the model means editing `MODEL_NAME` in the script (or a Work-dir override copy).

### Configure in LoraTraining
**Settings → External tools → JoyCaption**

| Field | Typical value |
| --- | --- |
| Work dir | Caption venv root (e.g. a folder that contains `venv\Scripts\python.exe`) |
| Python | `...\venv\Scripts\python.exe` (or blank = Work dir `venv` / `PATH`) |
| Script | `kohya_joycaption_captioner_v5_3.py` (default — bundled; Work-dir copy overrides) |
| Mode | **`direct`** (recommended) — spawns venv python + script args; `cmd` is the activate.bat fallback |

Click **Test JoyCaption** — should report Python OK and the resolved script path.

### In the app

- Open a dataset → select images → **JoyCaption** (or bulk caption).
- Optional: **Caption guidance** / **trigger token** (requires JoyCaption v5.3.1+ for `--context-file`).
- LoraTraining commits any in-app image edits to disk before captioning so JoyCaption sees final pixels.

Contract: [EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md#joycaption).

---

## 5. ComfyUI (validation & preview tools)

Setting ComfyUI **LoRAs** reveals Validation Steps, Validation Weight, Model Stress-Testing, Upscale, Context, Expression, and the related image/checkpoint controls. Existing output checkpoints remain visible without it.

**Upstream (install there, not here):** [ComfyUI](https://github.com/comfyanonymous/ComfyUI)

Confirm ComfyUI runs and can execute a Krea 2 graph **outside** LoraTraining before connecting it. LoraTraining talks over HTTP (default `http://127.0.0.1:8188`) — keep ComfyUI running when you use Validation, Upscale, or Diversify (Context/Expression).

**LoraTraining does not package ComfyUI, extra custom-node packs, or diffusion/VAE/upscale models.** **Install LT Comfy package** only copies the small **LT ·** inject nodes. A working Krea 2 graph still needs:

1. **Missing custom nodes** — open the workflow in ComfyUI; install whatever the red/missing nodes ask for via the **ComfyUI Manager** (package manager).
2. **Models on disk** — download checkpoints, VAEs, CLIP, ControlNets, upscalers, etc. yourself into the correct `ComfyUI/models/…` sub-folder (Krea weights typically under `models/diffusion_models`).

That process is tedious and fully manual. You only have to do it **once** per ComfyUI install (then restart ComfyUI). LoraTraining has no installer, downloader, or Manager UI for those pieces.

**Fixed model checklist:** every hard-coded weight filename in the reference Comfy graphs (with Hugging Face download links) is in **[COMFY_MODELS.md](COMFY_MODELS.md)**. Re-scan your library after editing workflows: `npm run list:comfy-models`.

### LoraTraining custom nodes (in scope)

Validation / Upscale / Diversify need the **LT** node pack shipped with LoraTraining. You do **not** need to copy folders by hand:

1. **Settings → External tools → ComfyUI** — set **Comfy root** (your ComfyUI install folder, the one that contains `custom_nodes/`), or set **LoRAs** to `…/models/loras` and use the infer button.
2. Click **Install LT Comfy package** — copies bundled `comfyui-lora-training` into `{Comfy root}/custom_nodes/` and seeds the shipped **working** `comfy-workflow-*.json` graphs into your library when missing (never overwrites existing saves).
3. **Restart ComfyUI**. You should see **Lora Training** nodes (LT · Prompt, LT · Seed, LT · Model, …).
4. On each preview tab (**Validation Steps**, **Validation Weight**, **Model Stress-Testing**, **Upscale**, **Context**, **Expression**), open **Edit Workflow** and wire checkpoint / sampler / save nodes, then **Save workflow**.

Manual copy (dev checkout only):

```
LoraTraining/comfyui-lora-training/  →  ComfyUI/custom_nodes/comfyui-lora-training/
```

Guide: [comfyui-lora-training/README.md](../comfyui-lora-training/README.md).

### Configure in LoraTraining
**Settings → External tools → ComfyUI**

| Field | Purpose |
| --- | --- |
| Host / Port | Where ComfyUI listens (default `127.0.0.1:8188`) |
| Comfy root | ComfyUI install folder (`custom_nodes/` parent) — used by **Install LT Comfy package** |
| LoRAs | Absolute path to Comfy `models/loras` |
| Val. LoRA | Default subfolder for staged validation copies (e.g. `!Testing`) |
| Model | Checkpoint name when a set uses “Default” |
| Wildcards | (optional) Dynamic Prompts wildcards for prompt autocomplete |
| Launch | (optional) `.bat` / `.exe` to start Comfy when a preview job needs it |

There is no Secure checkbox; the stored `secure` key defaults false. Click **Install LT Comfy package**, then **Test ComfyUI** — Comfy must be running for Test. **Launch ComfyUI** is a separate button and needs the Launch path.

### Keep Comfy running

Validation Steps, Weight, Stress, Upscale, and Diversify (Context/Expression) queue HTTP jobs to Comfy. Start ComfyUI before using those tabs.

Details: [VALIDATION.md](VALIDATION.md) · [EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md#comfyui).

---

## 6. Categories & datasets

1. **Datasets** screen → **Categories…**
2. Create categories (e.g. *Characters*, *Styles*).
3. Each new category gets a relative folder under the library root (blank defaults from the category name). The path may be nested. Its immediate child folders with top-level JPG/JPEG/PNG images become datasets.
4. Or **Add dataset** and pick an existing image folder manually.

Each dataset needs images in the folder root (non-recursive) and eventually `.txt` captions with the same basename. New-folder discovery recognizes JPG/JPEG/PNG. Rescan of an existing dataset also recognizes WebP/BMP, which must be converted to JPG before training.

Details: [CATEGORIES.md](CATEGORIES.md) · [DATASET_MANAGER.md](DATASET_MANAGER.md).

---

## 7. First training run (smoke test)

1. Open a dataset with at least a few captioned images (or caption with JoyCaption first).
2. **Jobs** → create a job for that dataset (or use an existing one).
3. Set **training steps**, **LoRA name**, learning rate, etc. Training **model** comes from Settings.
4. **Enqueue** → switch to **Queue** → **Start**.
5. Watch live log / metrics. Checkpoints should appear under `{dataset}/output/`.

If enqueue fails on captions, finish captioning first. If training fails on Windows with 1455, see [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md).

Details: [JOB_QUEUE.md](JOB_QUEUE.md) · [TRAINING_CONFIG.md](TRAINING_CONFIG.md).

---

## 8. Comfy workflows (validation & previews)

**Install LT Comfy package** (step 5) seeds the shipped working graphs into your library when missing. You should **not** have to rebuild them from empty LT stubs.

Then:

1. Start **ComfyUI**.
2. Install any **missing Manager packs** and download models listed in [COMFY_MODELS.md](COMFY_MODELS.md) (once).
3. Open a dataset → preview tab → confirm **Edit Workflow** loads the seeded graph; tweak if needed → **Save workflow**.
4. Add validation sets → **Run**.

Validation Steps / Validation Weight / Model Stress-Testing share one file; Upscale, Context, and Expression each have their own. Seeds never overwrite; only **Edit Workflow → Save workflow** updates an existing library graph.

Details: [VALIDATION.md](VALIDATION.md) · [resources/comfy-workflows/README.md](../resources/comfy-workflows/README.md).

---

## Checklist

| ✓ | Item |
| --- | --- |
| ☐ | External tools installed & working on their own (see upstream links above) |
| ☐ | LoraTraining installed and library root set |
| ☐ | AI Toolkit: Test OK; training model configured |
| ☐ | JoyCaption: Test OK; HF model `fancyfeast/llama-joycaption-beta-one-hf-llava` available (cache or local) |
| ☐ | ComfyUI running; **Install LT Comfy package** done; missing Manager packs + models installed once; Comfy Test OK |
| ☐ | Category + dataset with captioned images |
| ☐ | Job enqueued and completed; `.safetensors` in `output/` |
| ☐ | (Optional) Validation Run produces preview JPGs |

---

## Next steps

- Full app tour: [USER_GUIDE.md](USER_GUIDE.md)
- Tool contracts & paths: [EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md)
- Troubleshooting: USER_GUIDE → Tips & troubleshooting; [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md)
- Settings reference: [SETTINGS.md](SETTINGS.md)

