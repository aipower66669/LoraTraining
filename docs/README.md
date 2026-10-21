# LoraTraining documentation

**Licence:** [GPL-3.0-only](../LICENSING.md) · **Current release:** see [`package.json`](../package.json) `version` and [GitHub Releases](https://github.com/aipower66669/LoraTraining/releases/latest).

Hub for product and engineering docs. Product entry: [../README.md](../README.md). Locked decisions: [DECISIONS.md](DECISIONS.md). Full history: [../CHANGELOG.md](../CHANGELOG.md). Latest release notes: [../RELEASE_NOTES.md](../RELEASE_NOTES.md).

---

## Start here

| Doc | Who | What |
| --- | --- | --- |
| [all-in-one.md](all-in-one.md) | Anyone asking an AI assistant for help | Sole comprehensive source of truth: complete guide plus full FAQ |
| [FAQ.md](FAQ.md) | Anyone asking an AI assistant for help | Questions and answers only |
| [SETUP.md](SETUP.md) | Experienced local-AI users | Wire **already-working** tools into LoraTraining (not upstream install guides) |
| [USER_GUIDE.md](USER_GUIDE.md) | Everyone using the app | Screens, workflows, shortcuts, troubleshooting |
| [ADVANTAGES.md](ADVANTAGES.md) | Evaluators | Why LoraTraining vs manual / script workflows |
| [../RELEASE_NOTES.md](../RELEASE_NOTES.md) | Upgraders | v0.4.0 product release summary |
| [RELEASE_NOTES_v0.4.0.md](RELEASE_NOTES_v0.4.0.md) | Upgraders | Detailed v0.4.0 notes |
| [RELEASE_NOTES_v0.3.0.md](RELEASE_NOTES_v0.3.0.md) | Upgraders | Detailed v0.3.0 notes |
| [../CHANGELOG.md](../CHANGELOG.md) | Everyone | Version history |
| [../README.md](../README.md) | Everyone | Overview + quick start |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Contributors | Licence + PR workflow |
| [../LICENSING.md](../LICENSING.md) | Redistributors | GPLv3 terms |

---

## Product & domain

| Doc | Topic |
| --- | --- |
| [CATEGORIES.md](CATEGORIES.md) | Categories, folder-backed roots, auto-discovery, dedupe |
| [DATASET_MANAGER.md](DATASET_MANAGER.md) | Datasets, captions, duplicate, upscale/diversify, scraper |
| [VALIDATION.md](VALIDATION.md) | Steps / Weight / Stress, continuum, Compare |
| [COMFY_MODELS.md](COMFY_MODELS.md) | Fixed Comfy weights + Hugging Face links (one-time download) |
| [JOB_QUEUE.md](JOB_QUEUE.md) | Jobs, FIFO queue, drag reorder, ETA rates |
| [TRAINING_CONFIG.md](TRAINING_CONFIG.md) | Default YAML, materialisation, job config |
| [EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md) | JoyCaption, AI Toolkit, Comfy, Photoshop |
| [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md) | OSError 1455, safetensors shim, commit charge |
| [SETTINGS.md](SETTINGS.md) | Settings screen and persisted preferences |
| [UI_DESIGN.md](UI_DESIGN.md) | Screens, tokens, interaction patterns |

---

## Engineering

| Doc | Topic |
| --- | --- |
| [BUILD.md](BUILD.md) | Local build, installer, CI, release tags |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Scripts, layout, tests, release checklist |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Electron processes, media protocol, state ownership |
| [IPC_CONTRACT.md](IPC_CONTRACT.md) | Typed IPC channels and result shape |
| [PROJECT_FORMAT.md](PROJECT_FORMAT.md) | On-disk library + AppData layout |
| [SECURITY.md](SECURITY.md) | Path guards, delete safety, protocol isolation |
| [DECISIONS.md](DECISIONS.md) | Locked product decisions (D1–D28) |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Historical phased plan (pre-v0.1) |

---

## Related packages / specs

| Path | Topic |
| --- | --- |
| [../comfyui-lora-training/README.md](../comfyui-lora-training/README.md) | Comfy custom nodes for validation inject |
| [../reference/config-sample.yaml](../reference/config-sample.yaml) | Sample AI Toolkit YAML template |
| [../specs/Lora_Training_Specification.md](../specs/Lora_Training_Specification.md) | Original master specification |
| [../scripts/README-migrations.md](../scripts/README-migrations.md) | Library schema migrations |

---

## Reading paths

**New user:** [SETUP.md](SETUP.md) → USER_GUIDE → EXTERNAL_TOOLS → VALIDATION / DATASET_MANAGER.

**Windows overnight training issues:** WINDOWS_TRAINING → JOB_QUEUE → EXTERNAL_TOOLS (AI Toolkit).

**Contributor:** CONTRIBUTING → DEVELOPMENT → ARCHITECTURE → IPC_CONTRACT → domain doc for the area you touch. Schema changes: migrations README + `.cursor/rules/library-access-and-migrations.mdc`.

**Release manager:** CHANGELOG → RELEASE_NOTES → BUILD release checklist.

---

## Recent behaviour (v0.4.0)

| Area | Spec |
| ---- | ---- |
| NTFS versions | Advanced opt-in under Settings → Library, off by default — DATASET_MANAGER, SETTINGS |
| Capability gates | Hide JoyCaption, AI Toolkit, and ComfyUI work areas until the required path is set — SETTINGS, EXTERNAL_TOOLS |
| Release build | `npm run dist` bumps the patch; `npm run dist:nobump` keeps it; GitHub publishes the installer on tag `vX.Y.Z` only — BUILD |
| App updates | Empty Release folder checks GitHub; a folder uses local Setup exes; What's new renders the notes — SETTINGS |

## Recent behaviour (v0.3.0)

| Area | Spec |
| ---- | ---- |
| Library discovery (D24+) | Progress events; sidecar-first discovery; parallel category sync — USER_GUIDE, CATEGORIES |
| Enqueue many | Batch IPC, quick caption preflight, jobs show queued — JOB_QUEUE |
| Checkpoint UI | Shallow scan + cached validation previews — VALIDATION, DATASET_MANAGER |
| Windows safetensors (D28) | `train_bootstrap.py`, pread/streaming, abort on 1455 — WINDOWS_TRAINING |
| Further training | Pending output rows; Validated demotion — VALIDATION, USER_GUIDE |
| Image versions (D27) | MyFileExplorer-compatible NTFS ADS history — DATASET_MANAGER, EXTERNAL_TOOLS |
| Licence | GPL-3.0-only — LICENSING |

## Recent behaviour (v0.2.0)

| Area | Spec |
| ---- | ---- |
| Library workspace | Settings + workflows under `{libraryRoot}` — PROJECT_FORMAT, SETTINGS |
| Comfy suite | Steps / Weight / Stress / Upscale / Diversify — VALIDATION |
| Overnight queue | v0.2 introduced cooldown/wake lock; v0.3 continues after failure by default — JOB_QUEUE, DECISIONS D22 |
| In-app updates | Local NSIS folder scan — SETTINGS D23 |
