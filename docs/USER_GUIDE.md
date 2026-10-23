# LoraTraining User Guide

LoraTraining is a local Windows desktop app for **Krea 2 LoRA dataset management** — built on [AI Toolkit](https://github.com/ostris/ai-toolkit), which **runs the actual training**. This app prepares image folders, captions, and job configs; queues AI Toolkit; and optionally drives ComfyUI validation previews (Krea 2 workflows).

**Audience:** Experienced local-AI users with working external tools. LoraTraining is orchestration only — it does not install or repair AI Toolkit, ComfyUI, JoyCaption, CUDA, or model packs.

**Provided AS-IS.** This is free noncommercial software. The author is not paid for it and does not provide direct support. There is no warranty and no commitment to answer questions, fix bugs, or add features.

**Not a trainer:** LoraTraining does not implement LoRA training. It orchestrates external tools you install (JoyCaption, AI Toolkit, ComfyUI).

**Models:** **Krea 2 only** — training and Comfy preview workflows are adapted for Krea 2. Set checkpoint path and architecture in **Settings → External tools → Training model**.

Full documentation index: [README.md](README.md) (this `docs/` folder).

---

## Installation

### From source

```bash
npm ci
npm run dev
```

Use `npm install` instead when intentionally changing dependencies.

### Installer

```bash
npm run build:win
```

Installers are written under `release/`.

---

## First-time setup

**Full walkthrough:** [SETUP.md](SETUP.md) — LoraTraining Settings fields and **Test** buttons only. Confirm each external tool works **outside** LoraTraining first. Upstream: [AI Toolkit](https://github.com/ostris/ai-toolkit), [ComfyUI](https://github.com/comfyanonymous/ComfyUI), caption model [fancyfeast/llama-joycaption-beta-one-hf-llava](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava).

### Quick reference

### 1. External tools (Settings)

Have each tool working on its own first (links in [SETUP.md](SETUP.md)). Then open **Settings** and point LoraTraining at that install:
| Setting | Purpose |
| --- | --- |
| JoyCaption Work dir / Python / Script / Mode | Caption generation |
| AI Toolkit Work dir / Python / Script | **External trainer** — LoraTraining writes YAML and queues `run.py`; it does not train |
| Training model | Global Krea 2 checkpoint, architecture, Low VRAM, Quantize, Layer offloading |
| ComfyUI Host / Port and folders | Validation previews |
| Default training config | Appears after AI Toolkit Work dir is set; future-job rank, steps, LR, resolution, optimizer, and sample prompts |

Use each **Test** button until the tool reports OK.

### 2. Comfy workflows (optional but needed for preview tools)

LoraTraining does **not** ship a working ComfyUI stack. You install ComfyUI, extra node packs, and models yourself — once.

1. **Settings → External tools → ComfyUI** — set **Comfy root** (or infer from **LoRAs**), then click **Install LT Comfy package** (LT inject nodes only). Restart ComfyUI.
2. Open **Edit Workflow** on Validation / Weight / Stress / Upscale / Diversify. Install any **missing node packages** with ComfyUI Manager, and download required models into the correct `ComfyUI/models/…` folder. That is a one-time manual job.
3. Wire the Krea 2 graph (checkpoint / sampler / save + LT · nodes) → **Save workflow** → Run.
4. Optionally set **Settings → External tools → ComfyUI → Wildcards** for `__wildcard__` autocomplete in prompt fields.

### 3. Categories

1. Open **Categories…** from the Datasets toolbar.
2. Create categories (e.g. Concepts, Surfaces). New categories are folder-backed under the library; a blank folder defaults from the name.
3. The relative category path may be nested (`Group\Category`). Its immediate child folders that contain top-level JPG/JPEG/PNG images are **auto-discovered** as datasets and kept in sync.

Folder-backed categories manage membership from disk. Removing a library entry for those datasets is limited; use **Delete dataset…** to remove the folder, or move/rename folders on disk.

---

## Datasets

### Library

- Left: category groups and dataset tiles (cover thumb + status icons), status filters, search.
- Middle: icon tabs for **Images**, **Output**, **Validation Steps**, **Validation Weight**, **Model Stress-Testing**, **Upscale**, **Context**, and **Expression**. Hover/focus for the full labels.
- Right: caption editor, tool details, or output/checkpoints as applicable.

**Status icons** (priority): done → validated → trained → queued/training → ready.

**Validated** means every Validation **Steps** set has previews for every keep-in-Comfy checkpoint (not when the output folder is empty), and no open job plans steps beyond the highest on-disk checkpoint. Weight and Stress previews do not affect this badge. Queuing / drafting further training (or new checkpoints appearing) demotes the dataset back to **Trained** until those new steps exist and are validated. With AI Toolkit Work dir configured, Output shows **Pending** rows for planned steps not written yet; the rows are hidden while training UI is unavailable.

**Done** is set only by **Mark as Done** at the bottom of the Output / Validation Steps / Weight / Stress middle panes (Validated datasets). The app refuses the mark unless **Settings → External tools → ComfyUI → Wildcards** contains at least one `<lora:…>` reference to that dataset’s LoRA stem (step suffixes and Dynamic Prompts brace variants like `<lora:name_000000{250|500}>` count). Demoting Validated also clears Done.

### Add / duplicate a dataset

- **Folder-backed category:** create a subfolder with images under the category root (or use Add when supported for empty folders).
- **Manual category:** **Add dataset** and pick a folder.
- **Duplicate…** (library context menu): copies images + captions into a sibling folder (default `{name} V2`); skips `output/` so you can re-caption cleanly.
- **Create New Dataset…** (image context menu): new one-image dataset from a selected image.

### Library context menu

Rename (F2) · Duplicate… · Reveal in Explorer · Add to caption queue… · Remove from library (non–folder-backed) · Delete dataset…

**Delete dataset…** permanently deletes the dataset **folder** (images, captions, `output/`) and the library record. Confirms first. Blocked for running/paused training and Validation Steps on that dataset; the current guard does not test the other Comfy tools.

### Images tab

| Action | Behavior |
| --- | --- |
| Rescan | Re-read folder contents |
| Open folder | Explorer |
| Bulk caption tools | Prefix / suffix / replace / remove keyword / ensure or strip trigger; preview before applying |
| Convert → JPG | Non-PNG/JPG images |
| Shrink | Downscale only. Shortest edge already ≤1024 is left alone; larger files are scaled with Lanczos so the shortest edge becomes 1024 |
| Set caption | Manual caption text (only missing / append / overwrite) |
| Add identity tag | Unique female name per image as `.photo of a girl named Name.` (**Only missing** / **Redo** / **Remove**). Tracks used names in `identity-names-used.txt` beside `dataset.json`. Never rewrites other caption text. |
| JoyCaption | External caption run with progress / cancel |
| Grid navigation | Arrow keys; **Ctrl+A** selects all images; Del / Shift+Del |

**Delete keys**

| Shortcut | Behavior |
| --- | --- |
| **Del** | Move image + caption to Recycle Bin (no confirm) |
| **Shift+Del** | Permanent delete (no confirm) |

Image context menu includes **Set Dataset Cover**, Reveal in Explorer, **Edit image…**, Photoshop, Upscale, Diversify Context/Expression, Create New Dataset, **Undo last edit** / **Revert to original** when versions exist. **Edit image** also shows **Undo last** in its top bar so one saved version can be dropped without reverting the whole stack, caption clearing, and delete actions. A thumbnail badge marks existing NTFS versions. Multi-select uses **Delete Images**; Shift+click deletes permanently.

**Settings → External tools → Library → NTFS versions** is an advanced option and starts off. Off, Edit image and Upscale overwrite normally. On, datasets hosted on NTFS drives keep up to four reversible versions; other file systems still overwrite.

Header **Image Scraper** opens Pinterest or Google Images and saves into the dataset selected in the library.

### Captions

- Select a thumb → edit caption in the right pane (autosave).
- Set **Trigger**. When JoyCaption Work dir is configured, optional **Description** also appears for JoyCaption context. There is no Notes field on screen.
- Mark **Ready** when the set is prepared for training.

### Validation Steps / Weight / Stress

See [VALIDATION.md](VALIDATION.md) for set fields and preview folders.

- The play-icon **Run all sets** finishes unfinished work on the current dataset, then continues across **trained** datasets (Steps → Weight → Stress continuum).
- **Stop** cancels the current Comfy job and the continuum.
- Header chip always says **Validating · {set label}** and jumps to the active run.
- **Compare models** opens Stress Compare: reorder/collapse model rows and set columns.

### Upscale & Diversify

- **Upscale:** detail/upscale the selected (or dropped) image via its own Comfy workflow; settings are last-used across images.
- **Context / Expression:** generate `{stem}_dNN` siblings. Expression copies the parent caption; Context does not (re-caption after scene changes).

---

## Jobs

The **Jobs** and **Queue** header buttons, dataset Create/Open Job, queue drawer, library Queue filter/queued badge, and Settings **Default training config** tab appear only after AI Toolkit **Work dir** is set. Existing records are preserved while hidden. If the path is cleared while training is actually running, Queue and Stop remain until it ends; a paused row does not keep training UI visible.

1. Select a ready dataset → **Create Job**, or choose **New job** (+) on Jobs. Open the existing non-archived job when one already exists.
2. Edit training fields (paths are filled from the dataset + defaults).
3. Wait for the autosave status **Saved**, then **Enqueue**. Enqueue flushes pending edits and opens Queue; there is no separate Save button.

Only one non-archived job per dataset is allowed. A complete, failed, or cancelled job still blocks another until it is archived or deleted.

After a real `.safetensors` checkpoint exists, LoRA name, dataset, trigger, resolution, dtype, and network fields are locked for that job. Steps and other train settings remain editable until training starts. Pending rows alone do not lock fields.

Archive finished jobs from the Jobs screen when you no longer need them active.

---

## Queue

FIFO list of training jobs.

| Control | Behavior |
| --- | --- |
| Start | Start first runnable row / resume when paused; failed or cancelled rows require Retry |
| Pause | Kill process tree and mark paused; Resume relaunches the same YAML, but toolkit checkpoint continuation is unknown |
| Stop | Cancel; job stays in queue for Retry/Remove; next job does not auto-start |
| Stop after this | Finish the running job; do not auto-start the next |
| Restart / Clear | Delete that job’s output folder and restart from step 0 |
| Drag rows | Reorder (not while that job is running) |
| Edit / Remove | Icon buttons on each row |

Successful jobs auto-advance after a 10-second cooldown. Failed jobs leave the FIFO; `continueOnFailure` defaults true, so the next job also starts after cooldown unless Stop / Stop after this blocked it. There is no Settings → Queue control for that stored key.

### ETA columns

Each row shows:

1. **Duration** — estimate for that job alone  
2. **Finish** — estimate including jobs ahead  

**Rates**

| Situation | Rate used |
| --- | --- |
| Nothing running / no live s/it yet | Conservative **7 s/step** |
| Job **running** | Live toolkit **s/it**, sampled immediately then refreshed **every minute** |
| Queued, paused, or idle after a measured rate exists | Last measured rate; no 7/live blend |

Remaining steps for the running job update as step progress advances. Header shows total queue estimate and live rate when available.

---

## Settings (summary)

- **External tools** is always shown; **Default training config** appears after AI Toolkit Work dir is set
- Library: Library root and optional **NTFS versions** (off by default)
- JoyCaption / AI Toolkit paths and Test buttons; no Extra args controls
- Comfy Host, Port, Comfy root, LoRAs, Val. LoRA, Wildcards, Launch, and Model; no Secure checkbox
- **App updates** — empty Release folder checks GitHub Releases; a folder uses local `LoraTraining Setup *.exe` files. **What's new** shows that version’s release notes after a newer build is found. Install update closes the app and runs the installer (GitHub downloads it first)
- Default training YAML envelope (materialized per job with dataset paths, trigger, steps)
- Queue prefs exist in `settings.json` but have no on-screen section

Tool-dependent UI is hidden until configured: JoyCaption Work dir reveals auto-caption controls and Description; AI Toolkit Work dir reveals Jobs/Queue/training controls; ComfyUI LoRAs reveals Validation, Weight, Stress, Upscale, Context, Expression, and Comfy checkpoint/preview controls. Manual captions, normal dataset management, existing output files, and Settings remain available.

---

## Tips & troubleshooting

| Issue | What to try |
| --- | --- |
| Duplicate dataset tiles | Path dedupe + sync lock; refresh library |
| Validation won’t start | Capture workflow; ensure Comfy is up; custom nodes installed |
| Queue ETA all “—” | Job needs `train.steps` in config; restart app after upgrade |
| Caption tool fails | Check Python/script paths; JoyCaption version for `--context-file` |
| Training won’t start | Dataset folder exists; captions complete; Test AI Toolkit OK; wait for active JoyCaption under the default concurrency setting |
| **OSError 1455** / paging file | Not fixed by endless pagefile growth — mmap commit charge. Reboot or kill leftover `python.exe`; ensure train log shows safetensors shim ACTIVE. See [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md) |
| A queued job turns **failed** when Start begins | Start preflight rejected captions, paths, image commit, or YAML; read the job log |
| Library slow to open | Normal on first load after reboot; watch status bar progress; large libraries cache after first sync |

Logs for a job live under `{libraryRoot}\!Jobs\{id}\logs`. The Queue screen shows a live process log while training.

---

## Data safety

- **Del** on images → Recycle Bin  
- **Shift+Del** → permanent  
- **Delete dataset…** → permanent folder delete (confirmed)  
- **Remove from library** → metadata only; available only for folderless legacy/fallback categories
- Clearing **output/** does not delete training images  

Always keep backups of important dataset folders.

