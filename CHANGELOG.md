# Changelog

All notable changes to LoraTraining are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Image editor / Upscale NTFS version history is now an advanced opt-in under **Settings → External tools → Library → NTFS versions** and defaults off. Normal saves overwrite the image; version stacks require both the option and an NTFS-hosted dataset.
- Tool-dependent UI now stays hidden until its required path is configured: JoyCaption Work dir for automatic captions, AI Toolkit Work dir for Jobs/Queue/training UI, and ComfyUI LoRAs for validation/Upscale/Diversify.

## [0.3.0] — 2026-09-02

**Public release** under **GPL-3.0-only**. Focus: library scale, batch enqueue, jobs/queue correctness, and Windows safetensors reliability (OSError 1455).

### Added

#### Performance & scale
- Library load progress events (`library-load-progress`) — status bar + explorer empty states during discovery
- Parallel category folder probes with progress reporting
- Sidecar `dataset.json` ⇒ discoverable without full image scan; skip recursion into existing datasets
- Shallow output checkpoint scan (`CHECKPOINT_SCAN_MAX_DEPTH = 1`; skip cache / Set / Stress dirs)
- Cached validation preview paths in `checkpoint-prefs.json` → `validationPreviews`
- `enqueueMany` batch IPC + `queue:enqueueMany`; single `emitQueue`; background validated sync
- `quickCaptionCoverage` for enqueue/training preflight (readdir-only vs full `scanFolder`)
- Global training model in Settings (`defaultTrainingConfig.model`) — D26

#### Windows training
- `resources/python-shims/` — `train_bootstrap.py`, `lora_safetensors_patch.py`, `sitecustomize.py`
- Training spawn uses bootstrap on Windows; safetensors prefers `pread` / streaming seek-read
- Abort immediately on OSError 1455 / commit exhaustion (no heavier fallback)
- Commit/memory snapshot logged once at shim activation

#### Validation & lifecycle
- Default validation set seed **0**; `validationSetFromPrevious` bumps only if previous seed **> 0**
- Pending checkpoint rows in Output for steps planned by open jobs but not on disk yet
- Validated demotes when further training targets steps beyond current checkpoints
- MyFileExplorer-compatible NTFS ADS image versions (D27); JoyCaption/training commit tips before run

#### Documentation & licensing
- First-class public docs: README, ADVANTAGES, BUILD, WINDOWS_TRAINING, CONTRIBUTING, LICENSING, TRADEMARK
- GPLv3 licence (was MIT)

### Fixed

- Jobs list showed **failed** after enqueue — jobs cache write overlay, queue status merge, immediate UI patch
- Slow LoRA/Output tab when selecting checkpoints (deep Training-tree walks)
- Slow **Enqueue many** on failed jobs (sequential full folder scans)
- Dataset discovery opaque “Loading datasets…” with no progress
- App icon white corner fringes (transparent PNG/ICO corners)
- Safetensors shim log spam (log once per path, not every training step)

### Changed

- `package.json` licence → `GPL-3.0-only`
- Product version line → **0.3.x**

### Notes

- If Windows commit was exhausted before upgrade, reboot or kill leftover `python.exe` once
- See [`docs/WINDOWS_TRAINING.md`](docs/WINDOWS_TRAINING.md) for OSError 1455 details

## [0.2.0] — 2026-08-08

Full-featured production release for day-to-day LoRA training: library-backed settings, complete Comfy preview suite, durable overnight queues, in-app image editing, and local installer updates. Bugfixes continue; the feature surface is considered complete for this line.

### Added

#### Library & settings
- Settings, Comfy workflow captures, and tool prefs live under `{libraryRoot}` (AppData holds only the library pointer + window state)
- **App updates** — configure a release folder, check for newer `LoraTraining Setup X.Y.Z.exe`, install (quit + launch NSIS; use finish-page **Run**)
- Wildcard library folder + CodeMirror prompt editor (`__wildcard__` autocomplete) on Validate / Stress / Upscale prompts

#### Datasets & images
- In-app image editor (crop / adjust / tools) with LaMa-assisted remove where configured
- Image scraper (Pinterest / Google) into the active dataset
- Upscale (in-place, non-destructive original sidecar + revert)
- Diversify — Context and Expression sibling generation
- Explorer status filter + Datasets nav badge count; lifecycle through Ready → Trained → Validated → Done
- Mark as Done gated on wildcards LoRA references

#### Comfy preview suite
- Validation Steps, Validation Weight sweeps, Model Stress-Testing (+ Compare continuum)
- Isolated per-tool workflow partitions and library workflow backups on save
- Random caption → prompt (dice) on validation sets

#### Jobs & queue
- Jobs multi-select and shared-field bulk edit (LoRA name / trigger / dataset stay per-job)
- Global queue drawer Start / Stop / Pause / Resume off the Queue screen
- Queue: no auto-advance after failure; ~10s GPU cooldown between successful jobs
- Training wake lock + above-normal process priority while a job runs (and across the cooldown)
- Richer failed-job `lastError` (stderr tail)

### Fixed
- Multi-select on Jobs no longer hits “Maximum update depth exceeded”
- Overnight queue cascades after CUDA/OOM (stop advancing on failure + inter-job settle)
- Assorted queue, category manager, and UI stability fixes from daily training use

### Notes
- Primary target remains Windows 10/11
- JoyCaption, AI Toolkit, and ComfyUI stay external; configure paths in Settings
- Upgrade from 0.1.x: launch once so library settings migration can run if needed

## [0.1.0] — 2026-07-27

First feature-complete desktop release for local LoRA dataset management, training queues, and ComfyUI validation.

### Added

#### Datasets & categories
- Category manager with optional folder roots and auto-discovery of image subfolders
- Dataset library with covers, lifecycle status icons, and status filters
- Image grid with virtualization, 200×200 thumb cache, keyboard navigation
- Caption editor with autosave; bulk caption transforms (prefix/suffix/replace/remove/trigger)
- JoyCaption tool runs with live progress and cancel
- Bulk convert-to-JPG and shrink-to-min-1024 (shortest edge) with progress
- Image delete: Del → Recycle Bin; Shift+Del → permanent; caption removed with image
- Context menus for cover, reveal, Photoshop, trash / permanent delete
- **Delete dataset…** permanently removes the dataset folder (images, captions, output) after confirm
- Folder watch mute + selection-preserving reload after deletes (no jump-to-first)

#### Jobs & queue
- Job create/edit/enqueue from datasets; durable FIFO queue restored across restarts
- Queue Start / Pause / Stop / Resume / Restart-clear-output
- Drag-and-drop queue reorder; icon Edit / Retry / Remove actions
- Per-row **duration** + **finish ETA**; queue total ETA in header
- Idle estimate ~7 s/step; running job uses live s/it (sampled ~every minute); queued jobs use average of 7 s and live rate

#### Validation (ComfyUI)
- Multi-set validation configs (prompt, seed, weight, style) per dataset
- Workflow capture / save for LT custom nodes
- **Run all sets** — walks every set on the current dataset in order, generating missing previews only
- Live Comfy progress and preview pane; clear/remove sets

#### App platform
- Settings for tools, Comfy, default training config
- Typed Electron IPC (preload bridge), Zod validation, Vitest coverage for core helpers
- Windows NSIS packaging via electron-builder

### Fixed
- Duplicate library records for the same folder path (concurrent category sync race)
- Post-delete selection resetting to the first image (dangerous for rapid Shift+Del)
- Queue ETAs missing or identical when only live `progress.totalSteps` was present

### Notes
- Training images remain on disk unless explicitly deleted via image delete or **Delete dataset…**
- JoyCaption and AI Toolkit must be installed and configured by the user
- Primary target: Windows 10/11

## Links

- Release notes: [`RELEASE_NOTES.md`](RELEASE_NOTES.md) · [`docs/RELEASE_NOTES_v0.3.0.md`](docs/RELEASE_NOTES_v0.3.0.md) · [`docs/RELEASE_NOTES_v0.2.0.md`](docs/RELEASE_NOTES_v0.2.0.md) · [`docs/RELEASE_NOTES_v0.1.0.md`](docs/RELEASE_NOTES_v0.1.0.md)
- User guide: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- Licence: [`LICENSING.md`](LICENSING.md)
