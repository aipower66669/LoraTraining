# Advantages

Why use LoraTraining instead of folders + scripts + memory?

---

## What it is (and is not)

**LoraTraining** is a **Krea 2 text-to-image LoRA** desktop UI layered on [AI Toolkit](https://github.com/ostris/ai-toolkit). It is **mostly dataset management**: discover folders, caption, edit, bulk-fix, track lifecycle, materialise job YAML, and queue overnight runs.

**It does not train models.** When you click Start on the Queue, LoraTraining spawns **your** AI Toolkit install (`run.py` + generated YAML). Progress and logs are surfaced in the UI; the training math lives in AI Toolkit.

**It does not install your stack.** You bring working AI Toolkit / ComfyUI / JoyCaption (and their models). LoraTraining wires paths and orchestrates runs — it is for people already comfortable with local LoRA tooling, not general consumers.

**Models:** **Krea 2 only** — set your Krea 2 RAW checkpoint path and arch variant once in **Settings → External tools → Training model**. Comfy workflows ship as working Krea 2 graphs (seeded into the library when missing); other bases are out of scope for now.

---

## vs “just use File Explorer + Notepad”

| Pain | LoraTraining |
| --- | --- |
| No single view of caption coverage | Grid shows captioned vs missing; bulk caption tools |
| Training YAML hand-edited per run | Jobs form + materialised YAML; library-wide model defaults |
| Queue = “remember which folder is next” | Durable FIFO, drag reorder, ETAs, global drawer controls |
| Validation = manual Comfy graph each time | Saved workflows per tool; Run all sets; checkpoint staging |
| Lose track of which datasets are done | Lifecycle badges: Ready → Trained → Validated → Done |
| Delete image → orphan caption | Caption removed with image; stem collision warnings |

Your images still live in normal folders. The app adds structure without a proprietary vault.

---

## vs ad-hoc Python / batch scripts

| Pain | LoraTraining |
| --- | --- |
| Every script re-implements paths, captions, queue state | Typed library layout (`categories.json`, `dataset.json`, `!Jobs`) |
| No live progress | stdout/tqdm parsed to UI metrics + per-job log files |
| Crash mid-queue → unknown state | Jobs + queue restored from disk; a persisted running row returns paused. Failed jobs leave the FIFO and the next job auto-starts by default after cooldown |
| Comfy inject is bespoke each time | LT custom nodes + captured workflows per tool |
| Enqueue 50 jobs = 50 full folder scans | Batch enqueue with fast caption preflight |

You keep JoyCaption and AI Toolkit — LoraTraining orchestrates them with contracts documented in [EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md).

---

## vs generic MLOps / cloud trainers

LoraTraining targets **local Windows + your GPU + your disk layout**:

- No upload step; Z: / NAS / mapped drives work when Windows can read them
- Comfy previews against your local checkpoint folders
- In-app updates from GitHub Releases, or from a local folder of NSIS installers (no electron-updater account)
- Library backup = copy one folder tree

---

## Scale features (v0.3+)

Built for libraries that grow:

- **Discovery progress** — see category sync and dataset counts while the library loads
- **Shallow output scans** — checkpoint lists without walking every nested cache dir
- **Cached validation previews** — avoid re-walking Training trees on every Output tab click
- **Enqueue many** — one IPC round-trip; jobs show **queued** immediately
- **Global training model** — change checkpoint / VRAM policy once in Settings for all jobs
- **Capability-gated UI** — unavailable automatic captions, training screens, and Comfy tools stay hidden until their required Settings path is filled

---

## MyFileExplorer integration

Advanced users can enable **Settings → External tools → Library → NTFS versions**
for datasets on NTFS drives. It defaults off; normal saves overwrite like a
conventional editor. When enabled, **Edit image** and **Upscale** use the same ADS
version streams as MyFileExplorer (D27):

- `$DATA` = pristine bytes
- Tip edits in `VER_1`…`VER_4`
- JoyCaption and training **commit** tips to `$DATA` before running

Edit in one app; train from the committed pixels in the other.

---

## Honest limits

- Windows-first; other OS packaging is out of scope
- One training job at a time (by design — VRAM)
- Pause/resume depends on AI Toolkit checkpoint behaviour
- Comfy previews need a running ComfyUI you maintain yourself: extra node packs via ComfyUI Manager, models downloaded into `models/` by hand (once). LoraTraining only installs the LT inject nodes.
- Not turnkey: you must already run AI Toolkit / Comfy / JoyCaption (or accept limited features when they are unconfigured)
- Very large Krea 2 bases on Windows can hit commit-charge limits — see [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md)
- **Krea 2 only** — no support for other training architectures or non–Krea Comfy graphs yet

For the full feature list see [USER_GUIDE.md](USER_GUIDE.md) and [RELEASE_NOTES.md](../RELEASE_NOTES.md).
