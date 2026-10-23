# External tools

LoraTraining shells out to **user-installed** tools. This doc is the **contract** once a tool already works: invocation shape, Settings fields, and what the app does with each connection.

**Documentation boundary:** LoraTraining does **not** install, repair, or maintain JoyCaption, AI Toolkit, ComfyUI, their Python/CUDA environments, model files, or third-party Comfy custom nodes. Upstream failure modes are not LoraTraining bugs.

**LoraTraining is not a trainer.** For Krea 2 text-to-image LoRA, it manages datasets and queues jobs; [AI Toolkit](https://github.com/ostris/ai-toolkit) executes training. **Krea 2 only** in v0.4.0.

**First-time LoraTraining wiring:** [SETUP.md](SETUP.md).

| Tool | Upstream | LoraTraining section |
| --- | --- | --- |
| AI Toolkit | [github.com/ostris/ai-toolkit](https://github.com/ostris/ai-toolkit) | [below](#ai-toolkit) |
| JoyCaption (captions) | Bundled script + [HF model](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava) (no GitHub JoyCaption install) | [below](#joycaption) |
| ComfyUI | [github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI) | [below](#comfyui) |

## Capability-gated UI

Settings remains available so each tool can be configured. Elsewhere, a tool is considered configured when its required path is non-empty:

| Tool | UI gate | Hidden until set |
| --- | --- | --- |
| JoyCaption | **Work dir** | JoyCaption button/dialog, Add to caption queue, and dataset Description; manual caption controls stay visible |
| AI Toolkit | **Work dir** | Jobs, Queue, Create/Open Job, queue drawer, library Queue filter/badge, pending Further training rows, and Default training config |
| ComfyUI | **LoRAs** | Validation Steps/Weight/Stress, Upscale, Context, Expression, image-menu Comfy actions, checkpoint keep/move controls, and Output validation details |

This is a visibility gate, not a successful health check. A filled but invalid path can still fail **Test** or the run preflight. If training or captioning is already active, its progress and stop controls stay available even if configuration changes.

---

## JoyCaption

LoraTraining ships `kohya_joycaption_captioner_v5_3.py` in `resources/joycaption/`. It is a **standalone** PyTorch / `transformers` batch captioner. It does **not** import [fpgaminer/joycaption](https://github.com/fpgaminer/joycaption) source, nor does it need that repo on disk. The Settings name “JoyCaption” refers to the **model family** (`fancyfeast/…-joycaption-…`).

**You provide:** a CUDA Python venv (`torch`, `transformers`, `bitsandbytes`, …) and the HF weights (auto-cached on first run or downloaded manually).

**Fixed model** (hard-coded `MODEL_NAME` — not downloaded by LoraTraining):

| Model id | Hugging Face |
| --- | --- |
| `fancyfeast/llama-joycaption-beta-one-hf-llava` | [Repo](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava) · [Files](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava/tree/main) |

Setup: [SETUP.md § JoyCaption](SETUP.md#4-joycaption-captions).

Visible Settings fields are **Work dir**, **Python**, **Script**, and **Mode** (`direct` or `cmd`), plus **Test JoyCaption**. There is no Extra args box; a stored `extraArgs` array is still appended.

### Preferred invocation

```
cwd:  <joyCaption.workingDirectory>
exe:  <joyCaption.pythonExecutable>
args: [<resolvedScript>, <datasetFolder>, ...flags, ...extraArgs]
```

Script resolution: absolute path as-is; bare filename prefers `{workDir}/name` if present, else the bundled copy.

Optional app-added flags (when enabled in UI):

- `--context-file` — caption guidance / description (script v5.3.1+)
- `--trigger-token` — prepend dataset trigger (opt-in)

### Contract

| | |
| --- | --- |
| Input | Absolute dataset folder (after permanently committing tip ADS edits into `$DATA`) |
| Output | `.txt` beside images |
| Success | Exit code 0 |
| Cancel | Kill process tree + tool-run cancel IPC |

**Preflight:** if optional NTFS version tips exist, `commitDatasetImageVersions` runs before the caption process so JoyCaption captions final tip pixels. The same Commit runs before AI Toolkit training — whichever the user runs first. With **NTFS versions** off (the default), editor saves already overwrite the image body.

Progress: `caption-progress` / `tool-run-updated` events. User-visible run logs are under `{libraryRoot}/!Jobs/_caption-runs/{runId}/caption-*.log`.

---

## AI Toolkit

Visible Settings fields are **Work dir**, **Python**, and **Script**, plus **Test AI Toolkit**. There is no Extra args box; a stored `extraArgs` array is still appended after the YAML path.

### Preferred invocation

```
cwd:  <aiToolkit.workingDirectory>
exe:  <aiToolkit.pythonExecutable>
args: [<runScript>, <absoluteYamlPath>, ...extraArgs]
```

### Contract

| | |
| --- | --- |
| Input | Absolute materialised YAML (dataset tips committed to `$DATA` first — same preflight as JoyCaption) |
| Output | Checkpoints under dataset `output/` / training_folder |
| Logs | stdout/stderr → queue live log + job log files |
| Pause/Stop | Kill process tree (Windows) |

Progress: tqdm / step / loss / LR / `s/it` parsed in `src/main/progress/parser.ts`.

### Windows: safetensors / OSError 1455

On Windows, training does **not** call AI Toolkit’s `run.py` directly. LoraTraining spawns:

```
exe:  <aiToolkit.pythonExecutable>
args: [<shim>/train_bootstrap.py>, <runScript>, <absoluteYamlPath>, ...]
```

`train_bootstrap.py` applies `lora_safetensors_patch.py` before importing the toolkit so large `.safetensors` loads prefer **`pread`** or streaming seek/read instead of mmap (which reserves full-file commit charge and triggers OSError 1455).

| | |
| --- | --- |
| Shims | Shipped in `resources/python-shims/`; packaged via electron-builder `extraResources` |
| Logs | Job log under `!Jobs/{id}/logs/` — look for `[LoraTraining] safetensors Windows shim ACTIVE` |
| Opt out | Env `LORA_TRAINING_ALLOW_SAFETENSORS_MMAP=1` (debug only) |
| If commit exhausted | Kill leftover `python.exe` or reboot before retrying — see [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md) |

Preflight: `commitDatasetImageVersions` runs before training (same as JoyCaption) so any existing optional NTFS ADS tips are flattened to `$DATA`.

---

## ComfyUI

| | |
| --- | --- |
| Connection | **Settings → External tools → ComfyUI → Host / Port**. Stored `secure` defaults false; there is no Secure checkbox |
| Nodes | Bundled `comfyui-lora-training/` — **Settings → External tools → ComfyUI → Install LT Comfy package** (LT inject nodes only; **not** a full Comfy stack) |
| Extra node packs | **Not provided.** Install missing packages with **ComfyUI Manager** when a workflow shows red/missing nodes |
| Models | **Not provided.** Download checkpoints / VAE / CLIP / upscalers / etc. into the correct `ComfyUI/models/…` sub-folder yourself (once). Checklist: [COMFY_MODELS.md](COMFY_MODELS.md) |
| Workflows | Shipped in `resources/comfy-workflows/`; seeded to library `comfy-workflow-*.json` when missing (Krea 2) |
| Edit Workflow | Isolated webview partition per tool; **Save workflow** confirms the named tool; backups under `!WorkflowBackups/` (D18) |
| Validation / Weight / Stress | See [VALIDATION.md](VALIDATION.md) |
| Upscale | Dedicated graph; last-used fields in `lastUpscaleConfig`; default result overwrites the image. With NTFS versions enabled on an NTFS dataset, result is tip ADS `VER_n` (source = pristine `$DATA`) |
| Diversify | Context + Expression Comfy graphs |
| Wildcards | Optional folder in Settings for `__wildcard__` autocomplete (D21) |

LoRAs may be staged into the Comfy `loras` folder (subfolder preferences + keep-in-Comfy flags on checkpoints).

**Launch** is a `.bat`/`.exe` path; **Launch ComfyUI** is the separate button. If a preview cannot reach Comfy, **Launch ComfyUI?** offers a **Launch** confirmation and waits for the server.

---

## Photoshop (optional)

Opens the selected dataset image in the configured editor for external retouch; thumbs refresh on return when possible. Photoshop reads the file body. When **NTFS versions** is on and that image has saved versions, the app asks whether to open the original or commit the newest edit into the file first. Commit removes the version history. With the option off, or with no versions, the file opens directly.

---

## Environment notes

- Working directory matters for tool imports.
- Store absolute paths via Node `path` APIs.
- Kill process trees on cancel/pause/stop.
- Field defaults: [DECISIONS.md](DECISIONS.md).

See [SETTINGS.md](SETTINGS.md).

