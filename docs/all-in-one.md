# LoraTraining — Complete All-in-One Documentation

**Product:** LoraTraining  
**Publisher:** AIPower  
**Repository:** https://github.com/aipower66669/LoraTraining  
**Licence:** GPL-3.0-only ([LICENSE](../LICENSE))  
**Platform:** Windows 10 / 11  
**Audience for this file:** an AI assistant helping a user of this app

This file is the **sole comprehensive support source of truth** and is the file to upload whole to an AI assistant. It contains the complete guide followed by the full FAQ; nothing is shortened. Every relevant user-facing fact from the other files in `docs/` (setup, settings, datasets, jobs, queue, validation, Comfy models, Windows training, on-disk format, and locked decisions that change what the user sees) belongs here. If another document disagrees with this one, follow this file and fix the other document. This file does not replace upstream manuals for AI Toolkit, ComfyUI, CUDA, or Python, and does not include internal process or IPC notes.

---

## Instructions for the AI assistant

Follow these rules for every answer. They override general knowledge of other LoRA tools.

1. Answer only from this document. If a screen, setting, file, shortcut, model, default, or behaviour is not written here, say **“That is not documented.”** Do not guess. Do not fill gaps from Kohya, OneTrainer, Flux Gym, Automatic1111, Forge, or a generic ComfyUI tutorial. Do not invent menu labels, YAML keys, or buttons.
2. LoraTraining **does not train**. It does not contain a trainer. [AI Toolkit](https://github.com/ostris/ai-toolkit) runs training. LoraTraining writes a job YAML and starts that external `run.py`.
3. **Krea 2 text-to-image only** for training defaults and Comfy preview workflows. Do not give setup steps for Flux, SDXL, SD1.5, Wan, or any other base. Say they are unsupported in this release.
4. LoraTraining **does not install or repair** AI Toolkit, ComfyUI, the caption Python stack, CUDA, Hugging Face weights, or third-party Comfy node packs. Those failures are upstream. Point at the upstream project. Do not invent `pip` recipes, driver versions, or an “Install environment” button.
5. LoraTraining **does not download** the caption model or the Comfy weights listed in this file. The user downloads them. There is no in-app model downloader.
6. Name the real header destination and field from this file when you tell the user where to click: **Datasets**, **Image Scraper**, and **Settings**, plus **Jobs** and **Queue** after AI Toolkit Work dir is set. There is no Face tab and no troubleshooting wizard.
7. Training fields (rank, save-every, resolution, learning rate, and the rest of the job form) are the groups in **Training configuration**. Do not add controls that section does not list. The global checkpoint, architecture, quantize toggle, Low VRAM toggle, and offloading slider live under **Settings → External tools → Training model**, not on each job.
8. Validation, Weight, and Stress fields are the ones in **Comfy preview tools**. Seed `0` or below means random. Style is **Real** or **Anime**. Do not invent extra set types.
9. The image editor writes to disk only on **Save** and composites on the CPU. **Settings → External tools → Library → NTFS versions** is off by default. Off means Save overwrites the image normally. When enabled for datasets on NTFS drives, it keeps at most four versions. Do not promise version history on another file system, a GPU crop preview, or more than four versions.
10. When this file says a fact is **unknown**, leave it unknown. Do not invent toolkit log regexes. Do not promise that Resume continues from the last checkpoint inside AI Toolkit.
11. Distinguish an app defect from an external-tool failure. A crash inside AI Toolkit, a red Comfy node, or a CUDA error is not fixed by reinstalling LoraTraining.
12. Do not ask the user to paste dataset images, captions, or private prompts into a public GitHub issue.
13. If you cannot resolve the issue from this file, tell the user to open https://github.com/aipower66669/LoraTraining/issues with the app version (installer name or the running app), Windows 10 or 11, which external tool is involved (AI Toolkit, JoyCaption, ComfyUI, or none), expected versus actual behaviour, and the error text or the relevant lines from `!Jobs\{id}\logs`.

These answers fail the rules: recommending Flux or another base, telling the user the app will download models, describing a Face diversify tab, telling them to grow the Windows pagefile as the fix for OSError 1455, or claiming a failure always freezes the rest of the queue.

---

## What the application is

LoraTraining is a Windows desktop app (Electron, React, TypeScript) for **dataset management and job orchestration** around a Krea 2 LoRA workflow.

### Screens

| Screen | What it is |
| --- | --- |
| **Datasets** | Three panes: library (categories and dataset tiles), middle (Images, Output, Validation Steps, Validation Weight, Model Stress-Testing, Upscale, Context, Expression), and details (caption, set fields, or checkpoints). The middle tab buttons are icons; hover or focus them for these full names. The six Comfy tools stay unavailable until ComfyUI is configured |
| **Jobs** | Job list and the training form for the selected job. Filters: New, Completed, Archived. Hidden until AI Toolkit Work dir is set |
| **Queue** | FIFO cards. Drag to reorder. Progress and the live log sit beside the list. Hidden until AI Toolkit Work dir is set |
| **Image Scraper** | Header button. An embedded browser (Pinterest or Google Images). Clicking an image copies it into the dataset selected in the library |
| **Settings** | Header button. **External tools** is always present and contains Library, App updates, JoyCaption, AI Toolkit, Training model, and ComfyUI. **Default training config** appears after AI Toolkit Work dir is set. Queue preferences exist in `settings.json` but have no controls |

### What it does

- Track categories and image folders on disk
- Edit captions, run the bundled JoyCaption script, and bulk-edit caption text
- Edit images in the app; optional NTFS version history is available for advanced workflows
- Materialise an AI Toolkit YAML and run a FIFO training queue
- Drive ComfyUI for Validation Steps, Weight sweeps, Stress, Upscale, and Diversify (Context and Expression)
- Keep workspace state (settings, jobs, workflow graphs, thumbnails) in a library folder the user chooses

### What it does not do

- Perform the training loop or ship diffusion weights
- Replace JoyCaption, AI Toolkit, or ComfyUI
- Install, update, or diagnose CUDA, Python venvs, model downloads, or Comfy Manager packs
- Treat an upstream CUDA, Python, or model failure as a LoraTraining defect
- Support any diffusion base other than **Krea 2** for training defaults and Comfy previews
- Sync to the cloud, host multiple users, or target macOS or Linux
- Store training images in a database. Images stay in the folders the user already has

### Hard limits

- One training process at a time. That is deliberate, because of VRAM.
- Pause and resume kill the process tree and start it again with the same YAML. Whether AI Toolkit then continues from the last checkpoint is **unknown**. Do not promise it.
- Queue duration and finish times are estimates (7 seconds per step until a measured rate exists, then the live or last measured rate). They are not a guarantee.
- Comfy previews and training share the GPU if both are running. Close one when VRAM is tight.
- This window does not use the GPU. Hardware acceleration is off so VRAM stays available for Python and Comfy. Crop preview in the image editor is therefore a CPU preview, not a GPU blur.
- There is no cloud account, login, or telemetry control for the user to configure.

Intended user: someone who already has AI Toolkit working on its own, and ComfyUI working on its own if they want previews, before they point LoraTraining at those installs.

---

## Install LoraTraining

### Installer (usual path)

1. Open https://github.com/aipower66669/LoraTraining/releases/latest
2. Download `LoraTraining Setup X.Y.Z.exe`.
3. Optionally compare its SHA-256 to `SHA256SUMS.txt` on the same release. In PowerShell, from the folder that contains the installer:

```powershell
Get-FileHash -Algorithm SHA256 ".\LoraTraining Setup X.Y.Z.exe"
```

The hash must match the line for that file in `SHA256SUMS.txt`.

4. Run the installer. It is **unsigned**. SmartScreen may say “Windows protected your PC”. If the user trusts this GitHub release: **More info**, then **Run anyway**.
5. Launch **LoraTraining** and set a **library root**.

A SmartScreen warning on first run is expected. It is not evidence the file is corrupt. Code signing is not available yet. A local build from source is unsigned in the same way.

### From source

For people building the app, not for training a LoRA:

```bash
git clone https://github.com/aipower66669/LoraTraining.git
cd LoraTraining
npm ci
npm run dev
```

`npm ci` installs the lockfile versions (`npm install` is acceptable while actively changing dependencies). `npm run dev` opens the app with hot reload. It uses the same `%APPDATA%\lora-training` pointer as an installed build. `npm run check` runs typecheck, lint, and Vitest. Run it locally before a release. GitHub Actions does not run on a branch push or a pull request. Pushing a tag `vX.Y.Z` that matches `package.json` (this release: `v0.4.0`) is the only workflow: it runs that check, then builds and attaches the installer. A short tag such as `v0.4` does not run that build. `npm run dist` bumps the patch version, clears `release\`, and writes `release\LoraTraining Setup X.Y.Z.exe`. `npm run dist:nobump` clears `release\` and writes that installer without changing the version. `SKIP_RELEASE_CLEAN=1` keeps files already in `release\`. `npm run build:win` writes an installer and leaves both the version and existing `release\` files unchanged. If `app.asar` is locked (`EBUSY`), quit LoraTraining and any `electron.exe` still running, then build again. The window icon is `build\icon.ico`. The installer sidebar is `build\installerSidebar.bmp`.

### In-app updates

**Settings → External tools → App updates** leaves **Release folder** empty to check GitHub Releases and download `LoraTraining Setup X.Y.Z.exe` from there. A folder (often a local `release\` directory) overrides that and uses the installers already in it. **Check for update** compares the newest version to the running app. When a newer version is found, **What's new** opens its release notes as rendered markdown. A folder reads `RELEASE_NOTES.md` from that folder or the folder above it and does not contact GitHub. An empty folder uses the GitHub release body for that version. **Install update** quits the app and runs the installer. A GitHub update downloads the installer first. The finish page of the installer can start the new build.

This is not a download from GitHub inside the app. If the folder is empty or older than the running build, there is nothing to install.

### What still works if a tool is not configured

The library UI opens without any external tool.

| Not configured | Still available | Unavailable |
| --- | --- | --- |
| JoyCaption | Manual captions and dataset management | Automated caption controls, Add to caption queue, and dataset Description |
| AI Toolkit | Dataset management, manual captions, existing outputs, and Comfy tools if configured | Jobs, Queue, Create/Open Job, queue drawer, library Queue filter/badge, pending Further training rows, and Default training config |
| ComfyUI | Dataset management, captions, training, and existing output checkpoints | Validation Steps, Weight, Stress, Upscale, Context, Expression, image-menu Comfy actions, checkpoint keep/move controls, and Output validation details |

These visibility gates use required paths: JoyCaption **Work dir**, AI Toolkit **Work dir**, and ComfyUI **LoRAs**. A non-empty but wrong path may still fail **Test** or run preflight. Settings always remains available. Caption progress/Stop stays visible during an active caption run. If AI Toolkit Work dir is cleared while training is actually running, Queue/Stop stays visible until that process ends.

---

## First-time configuration

Confirm the external tools **before** filling Settings. Upstream installation is out of scope.

1. **AI Toolkit** can finish a Krea 2 training run by itself.
2. **ComfyUI** can run a Krea 2 graph by itself, if previews are wanted.
3. For auto-captions, a CUDA Python environment can load the Hugging Face model named below. No JoyCaption GitHub clone is required.

Then, inside LoraTraining:

1. Install LoraTraining (installer or `npm run dev`).
2. Open **Settings → External tools → Library**, choose **Library root**, and wait for **Settings saved**. A fresh install does not open an automatic folder picker; until this is set, library loading may report `Library root is not configured`.
3. **Settings → External tools → AI Toolkit** — **Work dir**, **Python**, and **Script** (`run.py`). Press **Test AI Toolkit** until it reports OK.
4. **Settings → External tools → Training model** — Krea 2 checkpoint path, architecture, Low VRAM, Quantize, and Layer offloading. This applies to every job.
5. **Settings → External tools → JoyCaption** — **Work dir**, **Python**, **Script**, and **Mode**. Press **Test JoyCaption** until it reports OK. Skip this step if captions will be written by hand.
6. **Settings → External tools → ComfyUI** — host and port (default `127.0.0.1:8188`), Comfy root (the folder that contains `custom_nodes`), and LoRAs folder. Click **Install LT Comfy package**, then restart ComfyUI. **Test ComfyUI** requires ComfyUI to be running. Install any missing node packs with ComfyUI Manager and download models once (see the download table). Skip this step if previews are not wanted yet.
7. **Datasets → Categories…** — create a category; its folder is under the library root and defaults from its name. **Add dataset** creates a child folder there. A legacy/fallback category without a folder instead asks you to pick an existing dataset folder. Caption the images.
8. **Jobs** — choose **New job** (+), set steps and the LoRA name, wait for **Saved**, then **Enqueue**. **Queue → Start**. Checkpoints appear under `{dataset}\output\`.
9. For previews: start ComfyUI, open the dataset’s preview tab, **Edit Workflow** if the seeded graph needs a tweak, **Save workflow**, add a set, then use the play-icon **Run all sets**.

**Minimum to train:** steps 1–4 and 7–8, plus captions (manual or step 5).  
**Minimum to validate in Comfy:** also steps 6 and 9.

Example paths in this file (`F:\AI\...`) are illustrations. The user substitutes their own absolute paths.

### Checklist

- External tools already work on their own
- LoraTraining installed and library root set
- AI Toolkit **Test** OK, training model set
- JoyCaption **Test** OK, and the Hugging Face model is available or will cache on first run
- ComfyUI running, **Install LT Comfy package** done, missing packs and models installed once, Comfy **Test** OK
- A category and a dataset with captioned images
- A job enqueued and completed, with `.safetensors` in `output\`
- Optional: Validation **Run** writes preview JPGs

### Library root

**Settings → External tools → Library**. A fresh install does not prompt with a folder picker. Set **Library root** here; until then, loading may show `Library root is not configured`.

- The folder holds `categories.json`, `settings.json`, `!Jobs`, `!Temp`, Comfy workflow JSON, workflow backups, and the normal category/dataset tree. Each dataset has its own `!Thumbnails` cache.
- Dataset **images stay where the user put them**. They are not copied into the library unless the user creates the dataset folder there.
- Back up the library folder to restore the workspace. There is no automatic backup.
- `%APPDATA%\lora-training\` holds only `app-config.json` (`version` and `libraryRoot`) and `window-state.json` (window position and size). Wiping AppData does not delete the library. Point Settings at the same library folder again.

**Settings → External tools → Library → Export settings… / Import settings…** writes a small JSON file (`format: lora-training-settings-export`) containing the editable settings subset: library root, **NTFS versions**, tools, Comfy, the two queue keys, default training config, and update folder. It does **not** include datasets, jobs, workflow graphs, recent dataset/job IDs, or last-used prompts and tool values. Import asks **Import settings?**, then replaces the Settings-page values. It does not rewrite paths for a different drive. Fix absolute paths after importing onto another machine. Import uses the normal Settings save path, so non-default queue values from the file are reset to `continueOnFailure: true` and `allowConcurrentCaptioning: false`.

A full library-folder copy already contains `settings.json`. Use Export when moving prefs onto a new empty library without copying datasets.

---

## Settings reference

**Settings** is a header button. **External tools** is always shown. **Default training config** appears after AI Toolkit **Work dir** is set; clearing that path returns Settings to External tools. Edits autosave after about 400 ms and flush when you leave Settings. The status line says `Settings saved`. Values live in `{libraryRoot}\settings.json`.

The running version is the **Installed** line on **External tools → App updates**. Before **Check for update**, that line also says whether the next check uses the release folder or GitHub Releases. After the check it includes the newest version found. **What's new** is available when that version is newer.

### Image editor

**Settings → External tools → Library → NTFS versions** is an optional advanced image-history checkbox. It defaults **off**.

| State | Edit image / Upscale save behavior |
| --- | --- |
| Off (default) | Overwrite the image body, like Paint or Photoshop. No history is created. If the file already has an app version stack, the next overwrite saves the current result as the main image and clears that stack |
| On + dataset on NTFS | Keep the pristine image body plus up to four edit/Upscale tips in NTFS alternate data streams; enable **Undo last edit** and **Revert to original** |
| On + any non-NTFS file system | Overwrite normally. The checkbox cannot add version history where NTFS alternate data streams are unavailable |

This option is not required for normal use. It is intended for users who explicitly want reversible in-place edits and understand that copying files through tools or file systems that do not preserve NTFS alternate data streams can flatten or discard the history. Existing version stacks remain readable after the option is turned off; the next Edit image or Upscale overwrite clears the stack.

### JoyCaption

| Field | Meaning |
| --- | --- |
| Work dir | Process cwd. Usually the caption venv root |
| Python | Optional. Blank uses the working directory’s `venv\Scripts\python.exe` when present, otherwise Python on `PATH` |
| Script | Defaults to the bundled `kohya_joycaption_captioner_v5_3.py`. A copy of that filename in the working directory overrides the bundled file |
| Mode | `direct` (recommended) or `cmd` (activate.bat style) |

`extraArgs` can exist in `settings.json` and is appended to the command. There is no Extra args box on the Settings screen.

**Test JoyCaption** checks that Python runs and the script path resolves.

JoyCaption is considered configured for UI visibility when **Work dir** is non-empty. Until then the JoyCaption toolbar/dialog, **Add to caption queue…**, and dataset **Description** are hidden. Manual caption editing, **Set caption**, identity tags, and bulk caption tools remain available.

The script ships inside LoraTraining. It does **not** import the [fpgaminer/joycaption](https://github.com/fpgaminer/joycaption) repository. The user does not clone that repo.

Fixed model id, hard-coded as `MODEL_NAME` in the script: `fancyfeast/llama-joycaption-beta-one-hf-llava`  
https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava

LoraTraining does not download it. The first caption run loads it with Hugging Face `transformers` (NF4 / bitsandbytes), which fills the Hugging Face cache, typically under `%USERPROFILE%\.cache\huggingface\hub\`. The user can download the repo first if they want the first run to be offline. Changing the model means editing `MODEL_NAME` or using a work-dir copy of the script. There is no model dropdown.

The venv must be able to import a LLaVA checkpoint. Packages setups of this script use: `torch`, `transformers`, `bitsandbytes`, `accelerate`, `Pillow`, `tqdm`, `colorama`. If **Test** fails on a missing module, that is the user’s Python env.

When the JoyCaption dialog enables them, the app adds:

- `--context-file` — caption guidance. Needs the bundled script line (v5.3.1 or newer). An older copy in the working directory can reject the flag.
- `--trigger-token` — prepends the dataset trigger. The dialog checkbox is **Prepend trigger**, and it stays disabled until the dataset has a trigger.

The dialog’s existing-caption choice is **Only missing** (skip images that already have a `.txt`; this is the safe default), **Append to existing**, or **Overwrite (redo)**.

### AI Toolkit

| Field | Meaning |
| --- | --- |
| Work dir | AI Toolkit repository root and process cwd |
| Python | Optional. Blank uses the working directory’s `venv\Scripts\python.exe` when present, otherwise Python on `PATH` |
| Script | Usually `run.py` |

`extraArgs` in `settings.json` is appended after the YAML path. There is no Extra args box on the Settings screen.

**Test AI Toolkit** checks `python -V` and that the script exists.

AI Toolkit is considered configured for UI visibility when **Work dir** is non-empty. Until then **Jobs**, **Queue**, dataset Create/Open Job, the queue drawer, library **Queue** status filter/queued badge, pending **Further training** rows, and **Default training config** are hidden. A selected Queue filter resets to All, and tiles fall back to their applicable Ready/Trained/etc. lifecycle badge. Existing job records and output files are not deleted. If a training process is actually running when the path is cleared, Queue and drawer Stop controls remain visible until it ends; Jobs stays hidden. A merely paused row does not keep training UI visible.

Upstream: https://github.com/ostris/ai-toolkit

On Windows the app does not launch `run.py` as the first process. It starts `train_bootstrap.py`, which then runs the toolkit script. See OSError 1455 below.

### Training model

**Settings → External tools → Training model** is global for every job. It is stored on the default training config and stamped onto each job when YAML is written. The Jobs form does not edit these.

| Field | Meaning |
| --- | --- |
| Checkpoint path | `name_or_path` — browse to the user’s Krea 2 weights |
| Architecture | **Krea 2 (raw)** (`krea2`), **Krea 2 Turbo (w/ Training Adapter)** (`krea2:turbo`), **Krea 2 (raw) [Edit Training]** (`krea2:o_edit`), or **Krea 2 Turbo (w/ Training Adapter) [Edit Training]** (`krea2:o_edit_turbo`) |
| Low VRAM | Enable AI Toolkit’s low-VRAM mode |
| Quantize | Enable model quantization. The screen has no quantization-type selector |
| Layer offloading | Transformer layers offloaded to CPU/RAM, from 0% to 100% in 5% steps. 0% disables offloading |

The saved model schema also carries text-encoder quantization, quantization-type, text-encoder offload, and `model_kwargs` values inherited from the default config. They have **no controls on this screen**. Do not tell the user to click them.

### Default training config

After AI Toolkit **Work dir** is set, **Settings** shows **Default training config**. Every new job starts as a copy of it, then fills in that dataset’s folder, trigger, LoRA name, and steps. It is not a second trainer. The field groups are listed under **Training configuration**. Editing the default changes future jobs. It does not rewrite jobs that already exist.

### ComfyUI

| Field | Meaning |
| --- | --- |
| Host | Default `127.0.0.1` |
| Port | Default `8188` |
| Comfy root | Folder that contains `custom_nodes`. The arrow button can infer it from the LoRAs path |
| LoRAs | Absolute path to Comfy `models\loras` |
| Val. LoRA | Default subfolder used when staging a dataset’s LoRAs. Example name `!Testing`. There is no per-dataset override field. The Output tab’s **Keep in Comfy** checkbox uses this default when the dataset does not already have sibling copies elsewhere under `models\loras` |
| Model | Default validation checkpoint used when a set says **Default**. It is the filename Comfy shows in Load Diffusion Model. Krea 2 files often live in `models\diffusion_models` |
| Wildcards | Optional folder of Dynamic Prompts wildcard files. Prompt fields on Validation Steps, Weight, Stress, and Upscale autocomplete `__name__` from it. Diversify prompts and training sample prompts are plain text |
| Launch | The field is the path of a `.bat` or `.exe` (often `run_nvidia_gpu.bat`). **Launch ComfyUI** starts that command and leaves it running after LoraTraining quits |

`secure` can be stored in `settings.json`. There is no Secure checkbox. The default is off, so the app talks to `http://` not `https://`.

If a preview run finds Comfy down and Launch is set, the app asks **Launch ComfyUI?**; the confirm button is **Launch**. It then waits up to about four minutes for port 8188. If Launch is empty, the error tells you to set that path and may call it **Launch command**, although the Settings field is labelled **Launch**. If Comfy was started but never answers, the message is that it did not become reachable. Check the ComfyUI window. The live line on a preview tab may say `Waiting for ComfyUI…` until the first progress line arrives.

**Install LT Comfy package** copies the bundled `comfyui-lora-training` nodes into `{Comfy root}\custom_nodes` and, when a library graph is missing, seeds the shipped workflow files. It does **not** overwrite a graph the user already saved. Restart ComfyUI afterwards. Nodes appear under **Lora Training** (LT · Prompt, LT · Seed, LT · Model, and the other LT inject nodes).

**Seed bundled workflows** performs only the missing-workflow seeding. It skips every graph already present.

**Test ComfyUI** needs ComfyUI already running. **Launch ComfyUI** is a separate button and is disabled until **Launch** has a value.

ComfyUI is considered configured for UI visibility when **LoRAs** is non-empty. Until then all six Comfy dataset tabs, image-menu Upscale/Diversify, checkpoint keep/move controls, and Output validation-preview details are hidden. Existing output checkpoints still appear in Output.

**Install LT Comfy package does not install** ComfyUI, ComfyUI Manager packs, or model files.

**Keep in Comfy** (Output tab, per checkpoint): on copies the file into the dataset’s Comfy LoRA folder when that basename is missing anywhere under `models\loras`. Off deletes the staged copy if one is found. Training images are not involved.

### Queue preferences

There is **no Queue section** on the Settings screen. Two values exist under `queue` in `settings.json`:

| Key | Default | Effect |
| --- | --- | --- |
| `continueOnFailure` | `true` | After a failed training job, drop it from the FIFO and start the next one after the 10-second cooldown. `false` stops the queue on a crash. **Stop** and **Stop after this** also refuse to start the next job, regardless of this flag |
| `allowConcurrentCaptioning` | `false` | When `false`, **Queue → Start** refuses while JoyCaption is active (`Captioning is running; training is blocked`). When `true`, training may start concurrently with that caption process. It does not add another training slot. Enqueue itself only adds jobs and does not perform this check |

Do not tell the user to open Settings → Queue. That screen is not there, and the app has no supported on-screen way to change these values. Current `saveSettings` behavior also rewrites the queue object to the defaults (`continueOnFailure: true`, `allowConcurrentCaptioning: false`) whenever Settings saves or imports. A hand edit is therefore not durable across a later Settings save.

### App updates

**Release folder** is optional. Empty checks GitHub Releases for `LoraTraining Setup *.exe` and can download that installer. A path scans that directory instead. **Installed** is the version that is running. **What's new**, Check, and Install behave as described under Install.

### Remembered values

These prefill the next time the user opens the tool. They are not separate screens.

| Value | Prefills |
| --- | --- |
| Last validation prompt | A new Validation Steps set |
| Last weight range | Weight min, max, and step on a new Weight set |
| Last upscale config | Upscale fields across images |
| Last diversify context / expression config | Those two tools |
| Last stress models | **Apply** in Stress → Select models, and new Stress sets |
| Last image scraper source | Pinterest or Google |

---

## On-disk layout

```
%APPDATA%\lora-training\
  app-config.json          { version, libraryRoot }
  window-state.json        window geometry only

{libraryRoot}\
  categories.json          category catalog
  settings.json            tools, Comfy, queue, defaults, last-used values
  comfy-workflow-validation.json    Validation Steps, Weight, and Stress (one graph)
  comfy-workflow-upscale.json
  comfy-workflow-context.json       Diversify · Context
  comfy-workflow-expression.json    Diversify · Expression
  !WorkflowBackups\        per-tool last.bak plus timestamped history
  !Temp\                   shared transient Comfy scratch
    upscale\
    diversify\
  !Jobs\
    {jobId}\
      job.json             status, dataset id, config, errors, queue order
      config.yaml          regenerated from job.json on save and before run
      logs\                train log lives here
  {category folder}\
    category.json
    {dataset folder}\
      dataset.json
      identity-names-used.txt       only if Add identity tag was used
      !Thumbnails\                  thumbnail cache for this dataset
      image001.jpg
      image001.txt                  caption, same basename as the image
      output\                       checkpoints and preview images
```

Folders whose names start with `!` are skipped by dataset discovery. So are names that start with `.`.

`!Temp` is scratch space for in-flight Upscale and Diversify work. Older builds may leave per-dataset `!UpscaleTmp` or `!DiversifyTmp` folders; current runs use the library-level `!Temp`.

Older names `comfy-workflow.json`, `validation-comfy-workflow.json`, and `upscale-comfy-workflow.json` are still read as fallbacks.

Sidecar JSON and captions are written by writing a temp file and renaming it. A crash mid-save does not leave a half-written sidecar.

Normal installer users do not run migrations by hand. On the first launch after an upgrade, the app moves a legacy AppData settings file into the library layout when needed. Legacy `{image}.original` edit sidecars are moved into NTFS version streams only when **NTFS versions** is enabled; if the user enables it after launch, that migration runs on the next launch. Developers can preview/run the matching `npm run migrate:*` scripts. Legacy `{stem}.upscale.json` sidecars may also remain; live Upscale values now come from library settings, and deleting an image cleans up its old upscale sidecar.

**Edit Workflow → Save workflow** refuses to overwrite a graph if `!WorkflowBackups\{stem}\last.bak` cannot be written. Each tool has its own backup folder. The confirmation names the tool, for example **Save Validation**, **Save Upscale**, or **Save Diversify · Context**, so one tool cannot silently store another tool’s graph.

### What a dataset record holds

`dataset.json` beside the images stores the id, name, folder path, category, trigger, caption extension (default `txt`), legacy notes, Description/caption guidance, ready / trained / validated / done flags, cover file name, images spawned into other datasets, the Validation / Weight / Stress sets, and the Stress Compare layout. Normally this is under the library’s category tree; a legacy/fallback label category can point at an external dataset folder. Image bytes are not inside this file.

### What a job record holds

`!Jobs\{id}\job.json` stores the id, name, dataset id, status, archived flag, the training **config** (source of truth), timestamps, the yaml path, progress, the last error, and queue order. `config.yaml` is always regenerated from that config. Hand-editing the YAML and expecting the form to keep those edits will fail on the next save or run.

### Dataset folder

Images that training and the grid see are in the **dataset folder root**, not in subfolders. Category discovery counts `.jpg`, `.jpeg`, and `.png`. A rescan of an existing dataset also accepts `.webp` and `.bmp`.

```
MyConcept\
  image001.jpg
  image001.txt
  output\
    *.safetensors
    Set 1\
    Weight 1\
    Stress 1\
```

### Which delete hits what

| Action | What is removed |
| --- | --- |
| **Del** on an image | That image and its caption go to the Recycle Bin. No confirm |
| **Shift+Del** | Permanent delete of that image and caption. No confirm |
| **Remove from library** | The catalog entry only, and only for a category that is not folder-backed. Files stay |
| **Delete dataset…** | The dataset folder (images, captions, `output`) after confirmation. Blocked while that dataset has running/paused training or a Validation Steps run. The current guard does not test Weight, Stress, Upscale, or Diversify. Cannot target the category root |
| **Clear output** | **Clear output / reset training?** confirms with **Clear output**. Removes checkpoints, training caches, preview JPGs, ratings, and staged Comfy LoRAs. Keeps training images, captions, and Validation/Weight/Stress set definitions. It uses the same running/paused-training and Validation Steps guard and refuses an unsafe target |
| **Restart / Clear** on a queue row | After confirmation, delete that job’s output folder, then train from step 0. Refused if the configured output is the dataset root, outside the dataset, or not a conventional `output` path |

Back up the **library folder** and any dataset folders that live outside it. AppData does not need a backup.

---

## Features

### Categories and datasets

New categories are folder-backed. Their folder is a relative path under the library root and defaults to a sanitized form of the category name. Legacy or synthetic categories can still have no folder; those behave as label-only categories.

When there are no real categories, Add dataset can show a temporary **General** fallback. In the Add dataset dialog, **+ New category…** creates a folder-backed category and then its dataset child.

| Mode | Behaviour |
| --- | --- |
| Label only (legacy / fallback) | **Add dataset** asks for an existing folder. **Remove from library** is available and leaves files on disk |
| Folder-backed (normal) | The category folder is inside the library root and may be nested (`Group\Category`). **Add dataset** creates a child folder. Immediate child folders that qualify become datasets. Membership follows the disk |

**Categories…** can add, rename, change the folder, reorder, and delete. The folder field is optional only because blank defaults from the name; it does not create a folderless category. A selected absolute folder must be inside the library root and cannot be the library root itself. Category names must be unique (`Category "…" already exists`). Two categories cannot use the same relative folder (`Another category already uses folder "…"`). Changing a category folder moves its old folder when the destination does not already exist; if the destination exists, the category is retargeted there and the old directory is left alone. **Delete category has no confirmation and removes the catalog/sidecar entry, not the folder or images.** It moves dataset records to the first remaining category. If there is no remaining category, they display as **Uncategorized** until reassigned. The explorer groups tiles under collapsible category headers.

Folder-backed discovery:

1. The category stores a relative folder under the library root; the derived absolute folder must exist. Nested category paths are allowed.
2. Only **immediate** child directories count. The app does not walk grandchildren. A child that already has `dataset.json` is a dataset. The app does not look inside it for more datasets.
3. Names starting with `.` or `!` are ignored.
4. A folder qualifies when it has `dataset.json` **or** at least one top-level `.jpg`, `.jpeg`, or `.png`.
5. Empty folders are not auto-discovered. Creating a dataset in the app can still mkdir and register one.
6. Refresh shows live progress (category and folder counts, then badges) so a slow disk is not a frozen “Loading datasets…”.

Sync runs when the library refreshes, when a category folder is set or changed, and on a debounced watch of category roots. Sync is one-at-a-time. It collapses library records that share the same path (keeps the oldest), creates records for new folders, and drops records in that category whose folders are gone or are no longer immediate children. On Windows the path comparison ignores trailing slashes and letter case.

Large-library work is deliberately shallow where possible: checkpoint lists do not recursively walk every nested cache directory, validation preview lists are cached, discovery reports live progress, and multi-job enqueue uses one batch call so rows show queued together.

Library tiles: cover thumbnail, status icons, status filters (**All**, **Not ready**, **Ready**, **Trained**, **Validated**, **Done**), and a category/dataset name search. **Queue** joins the filters and queued/training badge after AI Toolkit Work dir is set. A quoted search (`"word"`) is a whole word. The selected filter and collapsed category headers are remembered locally; hiding Queue resets that selected filter to All.

Status icons, highest priority first: **Done → Validated → Trained → queued/training → Ready.**

When AI Toolkit is configured and Queue status is visible, a draft job does not activate the library **Queue** filter or queued/training icon. Only `queued`, `running`, and `paused` count there.

**Duplicate…** (library context menu) copies images, captions, and image sidecars into a sibling folder. The default name is `{name} V2`, or the next `Vn`. It skips `output`, so checkpoints and previews are not copied. It keeps the trigger, caption guidance, notes, and Steps / Weight / Stress set configs. It clears stress and weight checkpoint picks, and clears ready, trained, validated, and done. The new dataset has a new id.

**Create New Dataset…** (image menu) makes a one-image dataset from the selected image and records that source.

**Rename** (F2) can rename the on-disk folder and remap linked jobs when the sanitized folder name changes.

Library context menu: Rename, Duplicate, Reveal in Explorer, Remove from library (not folder-backed), and Delete dataset. **Add to caption queue…** appears when JoyCaption Work dir is configured.

Why two tiles for one folder: sync had two records for the same path; the next sync keeps the oldest. Refresh the library after sync finishes.  
Why a folder was skipped: it is nested deeper than one level, its name starts with `.` or `!`, it has no top-level jpg/jpeg/png and no `dataset.json`, or it is empty.

### Images and captions

The image grid is virtualized. Thumbnails are a 200×200 center crop. **Double-click** opens a full-size preview. Escape or Enter closes it. Arrow keys move in the grid and in that preview. With focus in the grid, **Ctrl+A** selects every image. Multi-select follows grid order. After a delete, selection moves to the next or previous image, not back to the first. The folder watch is quiet for a few seconds after a delete so a rescan does not stomp that selection. A thumbnail badge appears when the file has NTFS edit versions.

The details pane for the open dataset has **Filename** (or `N images selected`, with Reveal for a single image), **Name**, **Category**, **Trigger**, **Ready**, and **Caption**. When JoyCaption Work dir is configured it also shows **Description**, the short context sent to JoyCaption as caption guidance (subject, domain, what to avoid). Ready is the checkbox create-job requires. There is no Notes box. `notes` can still sit in `dataset.json` from older data. **Delete image** / **Delete Images** sends the selection to the Recycle Bin. Shift+click on that button, or Shift+Del, deletes permanently.

| Action | Behaviour |
| --- | --- |
| Rescan | Re-read the folder |
| Open folder | Explorer |
| Bulk caption tools | The dialog shows a before/after preview, then apply. Buttons: Add prefix, Add suffix, Replace, Remove keyword, Ensure trigger (`trigger, ` only where it is missing), Strip trigger |
| Convert non-PNG/JPG → JPG | Leaves PNG and JPG alone. Skips a name when that JPG already exists |
| Shrink to min 1024px | Downscale only. If the shortest edge is already 1024 px or less, the file is left alone. Larger images are scaled with Lanczos so the shortest edge becomes 1024 px. The original file is replaced |
| Set caption | Only missing, append, or overwrite |
| Add identity tag | Inserts `.photo of a girl named Name.` with a unique name. Modes: **Only missing**, **Redo**, or **Remove**. Does not rewrite the rest of the caption. Used names are stored in `identity-names-used.txt` next to `dataset.json` |
| JoyCaption | Shown only after JoyCaption Work dir is set. Opens the caption dialog, then an external process with progress and cancel |
| Set Dataset Cover | Use this image as the library tile cover |
| Reveal in Explorer | Show the file in Explorer. The app will not reveal a path that escapes the dataset folder |
| Edit image… | Opens the editor. From the dataset screen, **E** is the same command |
| Edit in Photoshop… | Opens the image in Photoshop. The first time, the app asks for `Photoshop.exe` and remembers that path in library settings. There is no Photoshop field in Settings and no supported in-app control to change a still-valid saved path. If the saved file is missing, the app asks again; `Selected Photoshop executable was not found.` means the chosen file could not be used. Optional. Training and Comfy do not need it |
| Upscale / Diversify Context / Diversify Expression | Shown only after Comfy is configured. They jump to that middle tab |
| Create New Dataset… | One-image dataset from this file |
| Undo last edit / Revert to original | Shown when the file already has a version stack |
| Clear caption / Clear captions | Delete the selected `.txt` caption sidecars so those images are uncaptioned again |
| Del | Image and caption to the Recycle Bin. No confirm |
| Shift+Del | Permanent delete. No confirm |

If both `a.jpg` and `a.png` exist, they share one `a.txt`. The dataset stats surface that stem collision so the UI can warn.

For a multi-selection, the context menu is deliberately shorter: **Reveal in Explorer** (the first selected image), **Clear captions** when any exists, **Move to Recycle Bin**, and **Delete permanently**.

Select a thumbnail to edit its caption in the details pane. Several selected images edit together. Writes are debounced and flushed when you leave the image. Trigger is always available; Description appears only with JoyCaption configured. Tick **Ready** when every image is captioned. **Create Job** appears after AI Toolkit Work dir is configured.

**Add to caption queue…** on a library tile opens JoyCaption for that dataset.

Shift+click the **JoyCaption** icon in the Images toolbar skips the dialog and captions only missing files with **Prepend trigger** enabled. The dataset must have a trigger for that fast path to prepend one.

JoyCaption jobs run in a serial caption queue. While captioning is active, the status-bar progress strip is clickable (or focus it and press Enter/Space). The **Caption queue** popover shows completed/total, the current category/dataset and file, remaining files, and waiting dataset jobs with their image count, mode, and prepend-trigger choice. Escape or clicking outside closes the popover; it closes automatically when captioning stops. The button beside the progress strip cancels the active caption work and clears the pending caption queue. Run logs are under `{libraryRoot}\!Jobs\_caption-runs\{runId}\caption-*.log`.

**Image scraper** is the **Image Scraper** button in the header. It opens an embedded browser for Pinterest or Google Images with Back, Forward, Reload, source selector, destination/last-saved status, and Close. A click downloads a copy into the dataset selected in the library. Without a selection it reports `Select a dataset in the library first — downloads go there.` and does not save. The last source is remembered. Popups are disabled. This file does not document site login, cookies, or rate limits. If the user asks how the scraper authenticates, say that is not documented.

Dropping files onto the image grid **copies** them into the dataset folder. It does not move the originals. Accepted images are `.png`, `.jpg`, `.jpeg`, `.webp`, and `.bmp`, plus `.txt` captions. Other files and names that start with `.` are skipped. The status line reports how many were imported and how many were skipped. If the paths cannot be read, the error is `Could not read dropped file paths`.

Dragging selected thumbnails from the grid onto a **different dataset tile** moves the images and paired captions there. Hold Shift while dropping to copy instead. Source and target must be idle. Existing destination image names are skipped. The current NTFS tip is preserved (flattened when the destination cannot receive ADS), and legacy `.original` / upscale sidecars travel when present. Moving a cover image chooses a new source cover. Dropping back on the source dataset does nothing and reports `Drop on a different dataset to move or copy`. The status reports transferred and skipped counts.

The spell-check button in the library toolbar opens **Caption validation**. **Validate** scans every Ready, queued, Trained, Validated, or Done dataset; not-ready datasets are skipped. Tabs group **Missing caption**, **Missing trigger**, **No trigger word**, and **Unsupported image type** issues. Click an issue to open its dataset/image. Unsupported `.webp`/`.bmp` training images have **Fix** and **Fix all**, which convert them to JPG and update the shown report. Validation considers JPG/JPEG/PNG training-safe.

Before JoyCaption or training, in-app image edits are committed to the main file bytes so the external tool sees the final pixels.

### Image editor and optional NTFS versions

**Edit image** loads the current tip into memory once. Rotate, filter, annotate, and the other in-session edits stay in memory. **Disk changes only when the user Saves.** Before **Crop** or **Remove**, the app bakes the current edits into the working image so those operations chain without a Save in between. Save uses up to a 2× pixel ratio.

By default, **NTFS versions is off**. Save overwrites the image body in place, which is the normal behavior users expect from Paint or Photoshop. Upscale also overwrites its selected image. No setup is required for this mode.

Advanced users can enable **Settings → External tools → Library → NTFS versions**. The feature works only when that dataset is hosted on an NTFS drive. It then keeps a short version stack in alternate data streams:

- `$DATA` is the pristine bytes
- The tip edits sit in `VER_1` through `VER_4`, with `VER_COUNT`
- **Undo last** drops the tip
- **Revert to original** deletes all `VER_*` streams
- At most four stacked versions

With the option enabled on NTFS, Upscale reads `$DATA` and writes a new tip. Diversify resolves the tip and does not commit it. JoyCaption and training **commit** an existing tip into `$DATA` before they run, whichever the user runs first. A legacy `{file}.original` sibling from an older build is migrated into `VER_1` on a launch where the option is enabled.

When the option is off, or the dataset is not on NTFS, Edit image and Upscale overwrite the image in place and do not create a stack. If an old stack already exists when the option is turned off, it remains readable until the next editor/Upscale save; that overwrite makes the saved result the main image and clears the old stack.

These ADS names are interoperable with **MyFileExplorer**: either app can read the same pristine body and four-slot tip stack.

The crop box is free-form. It stays live until the pointer goes up. Resize lock uses the current cropped aspect. The outside-crop dim is opacity, not a blur: this window composites on the CPU, and a full-window blur would be a few frames per second. Do not tell the user the crop preview is GPU-smooth.

On the dataset screen, **E** opens **Edit image**. Inside the editor, with Alt not held: **E** or **Ctrl+S** saves and closes, **C** crop, **R** rotate, **F** flip horizontal, **Shift+F** flip vertical, **O** remove, **Z** resize, **A** annotate, **T** filters, **U** finetune. Escape closes menus and the full-image preview. Save writes only after a real edit. With NTFS versions enabled on NTFS, that save adds a version; otherwise it overwrites the image. Undo back to the image that was loaded does not count as an edit. A baked crop or remove does.

**Remove** (the O tool) is an in-editor erase. It is not the same as deleting the file. Disk still changes only on Save.

Image menu, when Comfy is configured: **Upscale**, **Diversify Context**, **Diversify Expression**. **Undo last edit** and **Revert to original** appear when a version stack exists.

### Jobs

This entire work area is capability-gated. Until AI Toolkit **Work dir** is set, the **Jobs** and **Queue** header buttons, dataset Create/Edit/Open Job, queue drawer, library Queue filter/badge, pending Further training rows, and Settings **Default training config** are not shown. Existing job records and outputs stay on disk and reappear when configured. If the path is cleared while training is actually running, Queue and Stop remain visible until the process ends; a paused row does not keep the UI visible.

1. The dataset must be marked **Ready**, and every image in the folder root must already have a caption. If captions are missing, create is refused with `Cannot create a job: N images still missing captions`. If there are no images, create is refused. The app scans the folder at create time. Sidecar stats that are behind the files do not count.
   If the dataset has a trigger and some captions do not contain it, the renderer first opens **Missing trigger in captions**. **Fix missing** prepends `trigger, ` only where absent and then creates the job. **Create** continues without changing captions. Cancel returns without creating.
2. From Datasets choose **Create Job**, or use **New job** (+) on Jobs, or open the existing job. Shift+click **Create Job** creates and enqueues it without leaving Datasets (`Created and enqueued`). Only one **non-archived** job is allowed per dataset, including complete, failed, and cancelled jobs. A second create returns `This dataset already has a job`. Changing another job onto an occupied dataset returns `That dataset already has a job`. Archive or delete the existing job before creating another.
3. If the dataset folder is gone, create returns `Dataset folder missing` plus the path. Restore the folder or fix the path, then rescan.
4. Edit the training fields below. The base model comes from **Settings → External tools → Training model**.
5. The form autosaves after about 450 ms and shows **Saving…** / **Saved**; there is no separate Save button. **Enqueue** flushes pending edits, adds the job, and opens Queue. Selecting several jobs shows **Enqueue (N)** and puts those jobs on the FIFO together. **Duplicate** is one job at a time. Enqueue validates folders and captions but does not start training. Its caption error begins `Cannot enqueue: …`; a repeated Start preflight uses `Cannot start training: …`. With the default `allowConcurrentCaptioning: false`, **Queue → Start** is what refuses while JoyCaption is active: `Captioning is running; training is blocked`.

The Jobs filters are **New** (every non-archived status except complete), **Completed** (complete and non-archived), and **Archived**. Archiving does not delete checkpoints. Any non-archived job blocks a second job for that dataset.

Multi-select jobs to edit shared settings, **Enqueue (N)**, Archive/Unarchive, or Delete together. LoRA name, trigger, and dataset stay per-job and are locked in multi-edit; changing any other visible field applies it to every selected job, while mixed values are left alone until that field is edited. Duplicate is disabled because it is one job at a time. If any selection is running, the multi-edit is read-only. **Delete (N)** asks first and removes job records while keeping datasets and LoRA outputs.

After the selected dataset has a real on-disk `.safetensors` checkpoint, the single-job form locks LoRA name, dataset, trigger, resolution, dtype, and network fields. Steps and other train settings remain editable until training starts. Synthetic **Pending** output rows do not trigger this identity lock.

Jobs-list keys, when focus is not in an editor: Up/Down cycles rows, Home/End selects first/last, Enter opens the linked dataset, and Escape clears selection (or closes the context menu). Shift/Ctrl selection works for multi-edit. The row context menu has **Open Queue** and **Open Dataset**.

Job statuses: `draft`, `queued`, `running`, `paused`, `complete`, `failed`, `cancelled`.

Checkpoints land under that dataset’s `output` folder. The materialised YAML is `{libraryRoot}\!Jobs\{jobId}\config.yaml`.

### Training configuration

The Jobs form and **Settings → Default training config** are the same groups. A new job is a deep copy of the defaults, then specialized for that dataset. **Steps** and **Save every** are special: if the live queue already has jobs, a newly created job inherits those two values from the last queued job; otherwise it uses Settings (falling back to 2000 and 250). Do not invent fields that are not on the form.

**On the form.** These are six collapsible sections.

| Group | Controls |
| --- | --- |
| Job / process | LoRA name, Device, Trigger word. The sparkle button sets the default name: latest checkpoint stem in `output`, otherwise `Category_Dataset` (`Uncategorized` if there is no category). Saving does not force the name back. Duplicated jobs keep the copied stem. Letters, numbers, `_`, and `-` |
| Network | Rank (linear), Alpha. Type stays `lora` |
| Save | Save every, Data Type. Choices: BF16, FP16, FP32. The same dtype is written onto `train.dtype` |
| Dataset | Dataset (or Folder path on the defaults form), Resolution (comma), Caption dropout, Cache latents to disk, Shuffle tokens |
| Train | Steps, Learning rate, Batch size, Optimizer, Cache text embeddings, Gradient checkpointing, Disable sampling, Skip first sample |
| Sample | Prompts, one per line |

Optimizer choices, exactly as shown: **AdamW 8-bit (bitsandbytes) — recommended low VRAM**, **Adam 8-bit (bitsandbytes)**, **AdEMAMix 8-bit (bitsandbytes)**, **Lion 8-bit (bitsandbytes)**, **AdamW 8-bit (toolkit)**, **Adam 8-bit (toolkit)**, **Prodigy 8-bit**, **Prodigy**, **AdamW**, **Adam**, **Lion**, **Adafactor**, **Adagrad**, **Automagic**, **Automagic 2**, **Automagic 3**, and **DAdaptation (legacy)**. An unknown saved value still appears as a custom option. There are no SGD or RMSprop options.

Fresh-library form defaults are Device `cuda:0`; Rank 32; Alpha 32; Save every 250; BF16; Resolution 512; Caption dropout 0; Cache latents on; Shuffle tokens off; Steps 2000; Learning rate 0.0001; Batch size 1; AdamW 8-bit (bitsandbytes); Cache text embeddings on; Gradient checkpointing on; Disable sampling on; Skip first sample on. Resolution 512 is the dataset-training resolution; it does not enlarge source images (use Shrink separately for oversized files). Stored sample width/height default to 1024 and are not controls on the Jobs form. A new job’s sample placeholder resolves to `photo of {trigger}` (or its generated LoRA name when the trigger is blank).

Checkpoint files are `{LoRA name}_NNNNNNNNN.safetensors`. The training output folder defaults to `{dataset folder}\output`.

`train.steps` is what the queue uses for ETA. It must be saved on the job or Duration and Finish stay “—”. With **Cache text embeddings** on, put the trigger in the caption files. Do not rely on trigger-word injection.

**Stored in the job config, not their own controls**

These keys are part of the AI Toolkit config the app writes. They are not rows on the form. Do not tell the user where to click them.

| Area | Keys |
| --- | --- |
| Process | `perf_log_every_n_steps` |
| Save | `max_step_saves_to_keep`, save format, push to hub |
| Dataset | caption extension `txt`, default caption, `is_reg`, network weight, flip X, flip Y, recursive (default off, so the toolkit stays on the flat dataset root and does not pick up `output`) |
| Train | gradient accumulation, train UNet, train text encoder, unload text encoder, noise scheduler, timestep type, content or style, loss type, weight decay, EMA and EMA decay, diff-output preservation |
| Sample | sampler, sample every, width, height, negative prompt, seed, walk seed, guidance scale, sample steps |
| Logging | log interval and the toolkit UI logger. There is no Logging section on the form |

**Materialisation, in user terms:**

- The job config starts as a copy of the Settings defaults.
- The LoRA name, trigger, dataset folder, and output folder are filled in as above.
- The queue and progress updates never replace that saved config. A failed step or a tqdm total does not rewrite steps.
- At start, the YAML is rewritten from the saved config, and the **Settings → External tools → Training model** block is stamped on top. Changing the training model once changes every job’s next run.
- `config.yaml` is not the source of truth. The job record is.

The sample file shipped with the repo uses placeholder tokens such as `CONCEPT_STEPS`. Those are template text. A real job stores resolved numbers and paths.

### Queue

FIFO. At most one training process runs.

| Control | Behaviour |
| --- | --- |
| Start | Start the first runnable job, or restart the paused process with the same YAML. When paused, both **Start** and **Resume** are visible. Cancelled or failed rows left by Stop are skipped; use Retry to queue one again |
| Pause | **Pause training?** confirms; tooltip: `Pause (keeps checkpoints; Start/Resume continues)`. The dialog says Resume or Start continues from the last checkpoint when the toolkit supports it. The app kills the process tree and marks paused, then relaunches the same YAML. Checkpoint resume inside AI Toolkit remains **unknown**, not guaranteed |
| Stop | **Stop training?** confirms. Cancel the process; the job stays in the queue so you can Retry or Remove. The next job does **not** start |
| Stop after this | Let the running job finish. The next job does not start. With no running job, the operation returns `Nothing is training — stop-after-current only applies while running` |
| Restart / Clear | **Restart / clear output?** confirms. Delete that job’s output folder and start from step 0. Refused if the path is the dataset root, outside the dataset, or not a conventional output folder |
| Drag rows | Reorder. Not while that row is the running job |
| Retry | Re-queue a failed or cancelled job |
| Remove | Drop from the FIFO. Not while running |
| Edit | Open the job |

Queue rows support Ctrl-click additive selection and Shift-click ranges. Drag reorders a row; the context menu can **Move to Top** or **Move to Bottom**, and applies that move to selected non-running rows when the clicked row is selected. The running row always remains first. Other context actions are **Edit Job**, **Open Dataset**, **Reveal in Explorer** (opens `output` when checkpoints exist, otherwise the dataset), and **Remove from Queue**. Up/Down cycles rows, Home/End selects first/last, Enter edits the selected job, and Escape closes the menu or clears selection.

Before JoyCaption or training starts, any existing optional NTFS version tips in that dataset are committed to `$DATA`.

After an app crash or restart, a persisted `running` row is hydrated as **paused**. No child process is silently relaunched; use Start or Resume.

After a **successful** job the queue waits **10 seconds** (GPU cooldown), then starts the next job.

After a **failed** job, the failed row leaves the FIFO regardless of `continueOnFailure`. When `continueOnFailure` is true (the default), the next job starts after the same 10-second cooldown. When it is false, the remaining queue stays stopped. **Stop** and **Stop after this** also prevent automatic advance. Preflight errors (missing captions, image commit, YAML) likewise mark the job failed and remove it; the flag decides whether Start proceeds to the next queued job. The job log gets the message.

With `allowConcurrentCaptioning: false` (the default), Start refuses while JoyCaption is already active. With it set to `true`, Start may run training concurrently with that caption process. This check is one-way: starting JoyCaption does not check whether training is already running, so avoid launching captioning during training unless the machine can carry both. The setting does not add another training slot.

When you are not on the Queue screen, a bottom queue drawer appears whenever at least one job is queued, running, or paused. It shows the queue count and the active category/dataset/status. Its actions are **Start** when idle, **Stop** while running, **Pause** while running, **Resume** when paused, and **Open** to go to Queue. Running or paused work also shows the progress bar and **Progress**, **Step**, **Elapsed**, **ETA**, and **Rate** metrics.

While a job is training, and across the cooldown before the next job, the app holds a wake lock (app suspension and display sleep), raises the priority of the toolkit process tree and of LoraTraining itself, turns EcoQoS off, and refreshes that boost every **5 seconds** and again when the window blurs or focuses. The training process does not open its own console window. This is so Windows 11 does not throttle the dataloader when the window is in the background.

ETA columns:

| Column | Meaning |
| --- | --- |
| Duration | That job alone |
| Finish | That job plus everything ahead of it |

| Situation | Seconds per step |
| --- | --- |
| Nothing running, or no live rate yet | 7 |
| The running job | Live toolkit `s/it`, sampled immediately and refreshed about every 60 seconds |
| A queued or idle job after a rate has been measured | The last measured rate; there is no 7/live blend |

The last measured seconds-per-step value is retained in this window’s local storage (`lora-training:queue-last-seconds-per-step`), not in library settings. Planned step count is the job’s `train.steps`. It is not taken from a tqdm total (that figure is often two steps short). If Duration and Finish stay “—”, the job config is missing `train.steps`.

The Queue screen header shows total queue ETA and the live `s/it` rate. The live process log sits beside the same five metrics and follows the bottom while the viewer remains near the bottom. **Clear** clears the displayed log buffer; the file log remains under `!Jobs\{jobId}\logs`. Training logs are named `train-{timestamp}.log`; Start-preflight failures write `preflight-{timestamp}.log` and a `Preflight failed: …` live line.

### Comfy preview tools

ComfyUI must be running, or startable from the optional Launch path. Graphs are for **Krea 2**. Other checkpoint families are unsupported.

**Output tab.** Before any checkpoint exists it says **Training not started** and shows the expected training folder. On-disk rows show the checkpoint filename, size/date, and its average preview-star rating/count. Right-click a row to reveal the file. Up/Down changes the selected checkpoint; Left/Right changes the selected validation set in the details pane.

When Comfy is configured, each row also has an icon-only **Keep in Comfy** checkbox (its tooltip explains staging/exclusion), its current Comfy LoRA subfolder, and **Move**:

- Keep on copies or reuses the staged Comfy LoRA and includes the checkpoint in Validation Steps.
- Keep off removes the staged copy if found and excludes it from Validation Steps. It never deletes the source checkpoint in `output`.
- **Move** relocates an existing staged copy under `models\loras`, or records the chosen subfolder so the next validation stages it there. It does not move the source checkpoint.
- **Refresh Comfy LoRA locations** rescans `models\loras` after files were moved outside the app.
- With AI Toolkit Work dir configured, planned checkpoints appear as disabled **Pending** rows with **Further training**. They are job-plan entries, not files on disk.

Validation Steps, Weight, and Stress share one saved graph, `comfy-workflow-validation.json`. They cannot run at the same time. They share Comfy VRAM.

| Tab | Fixed for a set | What changes each job | Output |
| --- | --- | --- | --- |
| Validation Steps | One Comfy model, prompt, seed, LoRA weight | Each keep-in-Comfy checkpoint that has no preview yet | `output\Set N\{loraStem}.jpg` |
| Validation Weight | One checkpoint, model, prompt, seed | Weight from min to max by step | `output\Weight N\{checkpointStem}_{weight}.jpg` |
| Model Stress-Testing | One checkpoint, prompt, seed, weight | Each ticked Comfy model that has no preview yet | `output\Stress N\{modelStem}_{shortHash}.jpg` |
| Upscale | The selected image and last-used upscale fields | — | A new version tip on that file |
| Diversify · Context | Prompt, seed, and count | New sibling images | `{stem}_dNN`. Does **not** copy the parent caption |
| Diversify · Expression | Count only | New sibling images | `{stem}_dNN`. Copies the parent caption |

**Validation Steps set fields:** prompt (wildcard autocomplete), seed, LoRA weight, style (**Real** = 0, **Anime** = 1), validation model (`Default` uses Settings), and a stored existing-copy policy. Seed **0 or below** means a random seed per job; a new Steps set defaults to **0**. New Weight and Stress sets instead default to seed **1**, which is fixed. The default policy is `reuse_if_identical_error_if_different`; the other stored value is `overwrite_if_different`. The preview panels do not show a control for that policy. Do not invent a dropdown for it. The dice icon **Fill prompt from a random dataset caption** replaces the active Steps-set prompt with a randomly selected caption.

Validation Steps, Validation Weight, and Model Stress-Testing each have an add-set button, a remove-set button, and **Clear images**. Clear images asks for confirmation, deletes only the active set’s preview JPGs, and cancels the current preview run for that set if needed. It never deletes a checkpoint. The add buttons are labelled by tooltip as **Add set**, **Add weight set**, and **Add stress set**.

Only Validation Steps has **Clone…**. It copies Steps sets from another dataset that is already Validated. The mode **Add to current** keeps the current Steps sets and the confirm button says **Add sets**; **Overwrite** replaces the current Steps sets. If none exists, the dialog says **No other validated datasets available to clone from.** and only offers **OK**. Do not claim that Weight or Stress can be cloned.

The play-icon action is **Run all sets**. It walks Set 1 through N and queues one Comfy job per missing LoRA preview.

**Weight set fields:** the same prompt, seed, style, model, and copy policy, plus the checkpoint file name under `output`, and weight min / max / step. Defaults are **0.6 / 1.4 / 0.2**. The last range the user used prefills the next set. The same seed is used for every weight in a set. Whole-number weights are written with one decimal place (`1.0`) so they sort with fractional weights. Weight is injected as `<lora:stem:w>`.

**Stress set fields:** prompt, seed, LoRA weight, style, copy policy, the checkpoint file name, and the ticked model list. **Select models…** opens **Models to stress-test**; **Apply** stores that list as the global default for new Stress sets and sorts it A→Z. Preview names add a short hash of the full Comfy model id so two files that share a basename in different folders do not collide. Older basename-only JPGs still count as already done for that model.

**Run** walks Stress sets in model-list order and queues one job per selected model that still lacks a preview. Models Comfy no longer lists (deleted or renamed) are **dropped from the selection** and are not reported as failures. A model that errors for another reason is **skipped**. The banner shows `FAILED · {model}: …`. The run continues and ends with a summary of every failure. It does not abort the whole alphabet on the first error. Untick models that reliably kill Comfy (especially `int8` / `convrot` weights) before a long run.

**Compare models** on Model Stress-Testing opens **Stress Compare**, an overview grid with models as rows and stress sets as columns. Model order, set order, and which model rows are collapsed are stored on the dataset.

**Cross-dataset Run.** **Run** on Steps, Weight, or Stress:

1. Finishes unfinished work for that tool on the current dataset.
2. Continues to the next unfinished work on other **trained** datasets. There is no separate queue screen for this.
3. Per dataset the order is Validation Steps, then Weight, then Stress, then the next trained dataset.
4. Skips a set that is not configured (weight set with no checkpoint, stress set with no LoRA or no models).
5. **Stop** cancels the current Comfy job and stops the continuum.

The header chip always says **Validating · {set label}** and jumps to the active run, even for Weight or Stress. Inside a preview pane, the cross-run status is more specific: **Validation Steps · Set N**, **Validation Weight · Set N**, or **Stress Test · …**.

Preview images can be rated **0–5 stars**. Unrated is not zero. Zero is an explicit score. The rating is stored for that preview. Clearing the rating sets it back to unrated. This does not delete the preview JPG.

**Delete image** on a preview opens **Delete preview image?** and removes that JPG after confirmation. It does not delete the checkpoint.

**Upscale** uses `comfy-workflow-upscale.json`. Fields: prompt (empty falls back to the image caption), model (`Default` or a Comfy model), seed, **Denoise** (0 to 1), style **Real** or **Anime**, and **Max Size** (64 to 8192, step 64). With no stored config, the normalization fallbacks are Denoise **0.5** and Max Size **1600**. Last-used values then prefill the next image. **Run all** continues through images not yet upscaled, with the same settings. By default the result overwrites the image. With **NTFS versions** enabled and the dataset on NTFS, it becomes a new version tip instead. Upscale sources the pristine `$DATA`, not a previous tip. When an image has a version stack and Upscale is idle, its own **Revert to original** button discards all tip edits while keeping the pristine file body. The image context menu separately offers **Undo last edit** and **Revert to original**.

**Diversify** has Context and Expression icon tabs. Each has a **Run** / **Edit Workflow** toggle and its own graph. There is **no Face tab**.

- **Context:** prompt, seed, and count. Count is 1 to 64. Seed 0 or below is random. The prompt is not filled from the caption. New siblings do not get the parent caption, because the scene changed. Re-caption them.
- **Expression:** **count** only (1 to 64). Each run uses a random seed. The parent `.txt` is copied onto the new siblings. There is no model field on this form.
- **Run all** runs root images only (not siblings that are already `_dNN` variants), times the count.

Sibling names are `{stem}_dNN` so they sort next to the parent.

**Edit Workflow** opens that tool’s graph in its own isolated session. **Reload** reloads the ComfyUI webview. **Save workflow** is what updates the library copy, after the graph for that tool has loaded; the confirmation is **Save Validation**, **Save Upscale**, **Save Diversify · Context**, or the matching tool name. Seeding from **Install LT Comfy package** never overwrites an existing save. Backups go to `!WorkflowBackups`. If the backup cannot be written, Save is refused.

Prompt fields on Validation Steps, Weight, Stress, and Upscale highlight Dynamic Prompts syntax and autocomplete `__wildcard__` names from **Settings → External tools → ComfyUI → Wildcards**. Diversify and training sample prompts do not.

### Validated and Done

**Validated** is not sticky from the first preview. It is true only when **every** Validation Steps set has a preview for **every** checkpoint that is still **Keep in Comfy**, and no open job (draft, queued, running, or paused) plans steps beyond the highest checkpoint on disk. A dataset with **no** keep-in-Comfy checkpoints is **not** Validated. An empty `output` folder is not “done.”

- Loading the library rechecks datasets marked Validated and demotes incomplete ones.
- A successful output scan with no checkpoints also clears a stale **Trained** badge.
- Creating, updating, or enqueueing a job with a higher step target demotes Validated immediately.
- New checkpoints from training re-sync the badge.
- Turning **Keep in Comfy** off can make a set complete again only when at least one checkpoint remains included.
- Weight previews and Stress previews do **not** set this badge.
- With AI Toolkit configured, Output says **Training not started** when it has no real or pending checkpoint rows; an in-flight job can add **Pending** rows labelled **Further training**. Without AI Toolkit Work dir, pending plans are hidden and an empty Output says **No training output found**, while real `.safetensors` files still appear.

**Done** is only **Mark as Done**, at the bottom of the Output, Validation Steps, Weight, or Stress pane, and only when the dataset is Validated. While it checks, the button says **Checking…**. Refusals are explicit: `Further training is planned through step … (output is at …).`, `Dataset must be Validated before it can be marked Done.`, `No wildcards library folder is configured.`, or `No wildcard file references this LoRA (“…”).` The successful path requires **Settings → External tools → ComfyUI → Wildcards** to contain at least one `<lora:…>` whose name, before a digit or brace step suffix, matches that dataset’s LoRA stem. Forms such as `<lora:name_000000{250|500}>` count. If Validated is cleared, Done is cleared too.

### One-time Comfy downloads

LoraTraining does not download these. Place each file in the ComfyUI folder shown, then restart ComfyUI. Missing **custom nodes** are separate: open the workflow, install what Comfy marks red with **ComfyUI Manager**, restart once.

| File | Folder | Used by |
| --- | --- | --- |
| `qwen3vl_4b_fp8_scaled.safetensors` | `models\text_encoders` | Validation, Weight, Stress, Upscale |
| `Wan2_1_VAE_fp32.safetensors` | `models\vae` | Validation, Weight, Stress, Upscale |
| `4x_foolhardy_Remacri.pth` | `models\upscale_models` | Upscale |
| `Qwen-Image-Edit-2509-Q5_0.gguf` | `models\unet` | Diversify · Context |
| `qwen_image_vae.safetensors` | `models\vae` | Diversify · Context |
| `qwen_2.5_vl_7b_nvfp4.safetensors` | `models\text_encoders` | Diversify · Context |
| `Edit\Qwen-Image-Lightning-4steps-V1.0-bf16.safetensors` | `models\loras\Edit` | Diversify · Context |

The Krea 2 diffusion UNET is **not** one of these fixed files. It is injected from **Settings → External tools → ComfyUI → Model** or the set’s validation model (LT · Model). A common file is `krea2_raw_fp8_scaled.safetensors` in `models\diffusion_models`, from https://huggingface.co/Comfy-Org/Krea-2. The user points **Model** at the filename Comfy shows.

Download sources for the fixed files (the user downloads them; the app does not):

| File | Source |
| --- | --- |
| `qwen3vl_4b_fp8_scaled.safetensors` | https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors |
| `Wan2_1_VAE_fp32.safetensors` | https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_fp32.safetensors |
| `4x_foolhardy_Remacri.pth` | https://huggingface.co/FacehugmanIII/4x_foolhardy_Remacri/resolve/main/4x_foolhardy_Remacri.pth |
| `Qwen-Image-Edit-2509-Q5_0.gguf` | https://huggingface.co/QuantStack/Qwen-Image-Edit-2509-GGUF/resolve/main/Qwen-Image-Edit-2509-Q5_0.gguf |
| `qwen_image_vae.safetensors` | https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors |
| `qwen_2.5_vl_7b_nvfp4.safetensors` | https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_nvfp4.safetensors |
| Lightning LoRA under `models\loras\Edit` | https://huggingface.co/ModelTC/Qwen-Image-Lightning/tree/main |

Developers can re-scan the bundled graphs with `npm run list:comfy-models`, or a saved library with `npm run list:comfy-models -- --library "D:\Your-Library"`. Installer users do not need this command for normal runs.

Node packs the shipped graphs expect, by the names in the project docs:

| Workflow | What is often missing |
| --- | --- |
| Validation and Upscale | Dynamic Prompts (`LoraTagLoader` and wildcards) and the save nodes the graph uses |
| Context | ComfyUI-GGUF (`LoaderGGUF`) and the Qwen-Image-Edit loaders. Create `models\loras\Edit` if needed. The Lightning file in the Hugging Face repo may be named `Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors`; rename it or adjust the graph so the name matches |
| Expression | ComfyUI-AdvancedLivePortrait, ComfyUI-LivePortraitKJ, and SaveImageToFolder |

Expression does not store checkpoint filenames in the graph. Those portrait weights usually download into `models\liveportrait` on first run from https://huggingface.co/Kijai/LivePortrait_safetensors/tree/main. Do not invent extra checkpoint filenames for Expression.

---

## Troubleshooting

| What the user sees | What to say |
| --- | --- |
| SmartScreen on the installer | Unsigned build. **More info → Run anyway**, only if they trust the GitHub release. Compare SHA-256 to `SHA256SUMS.txt` |
| Tool **Test** fails | The path, the venv Python, or the external program is wrong. LoraTraining will not repair the venv. Use the Settings tables in this file |
| `AI Toolkit is not configured` | Open **Settings → External tools → AI Toolkit**, set Work dir/Python/Script, and use **Test AI Toolkit** |
| JoyCaption fails immediately | Python and script paths. A missing `torch`, `transformers`, or `bitsandbytes` import is the caption venv. An error that mentions `--context-file` means the work-dir script is older than the bundled one |
| JoyCaption replaced captions they wanted to keep | The dialog was set to **Overwrite (redo)** or **Append**. **Only missing** skips images that already have a `.txt` |
| JoyCaption or training “doesn’t see” an edit | With optional NTFS versions enabled, edits can live in `VER_*` until committed. The app commits before those runs. A tool started outside the app reads `$DATA` only. With the default setting off, editor saves already overwrite `$DATA` |
| Training will not start | The dataset folder exists, images have captions, **Test AI Toolkit** is OK, and JoyCaption is not already active under the default `allowConcurrentCaptioning: false`. Enqueue caption errors begin `Cannot enqueue: …`; Start-preflight caption errors begin `Cannot start training: …` |
| `Dataset is not marked Ready` | Check the dataset, captions, and validation issues, then tick **Ready** in the details pane |
| **OSError 1455**, “paging file is too small” | Windows commit charge from memory-mapping a multi-GB `.safetensors`. See the next section. Do not tell them to grow the pagefile forever |
| Queue ETA is “—” | The job needs `train.steps` saved in its config. After upgrading old records, restart the app if the refreshed value has not appeared |
| A queued job changes to **failed** as Start begins | Start preflight failed (captions, paths, image commit, or YAML). Read `!Jobs\{id}\logs\preflight-{timestamp}.log`. Enqueue itself should set **queued** |
| `Only failed or cancelled jobs can be retried` | Retry is not a restart for complete/queued work. Use **Restart / Clear** only when output should be deleted and training restarted at step 0 |
| `Cannot remove a running job from the queue` / `Cannot delete a running job` | Stop or pause it first |
| `Stop or pause the running job before reordering it.` | The running row remains first; reorder only non-running rows |
| `Refusing to clear dataset folder as training output` / `Refusing to delete training folder outside dataset output: …` | The output path is unsafe. It must be the dataset’s dedicated `output` folder |
| The rest of the queue started after a failure | `continueOnFailure` is true, which is the stored default, and **Stop** was not used. There is no Settings → Queue toggle |
| The queue stopped after a failure | `continueOnFailure` is false, or **Stop** / **Stop after this** was used |
| Duplicate dataset tiles | Two records shared one path. Refresh after category sync. The next sync keeps the oldest |
| A folder never became a dataset | It is nested, empty, named with `.` or `!`, or has no top-level jpg/jpeg/png |
| Two images share one caption | `a.jpg` and `a.png` share `a.txt` by design. The UI warns on that stem collision |
| Validated disappeared | A new or higher step target, a new checkpoint, or a Steps preview that does not cover every keep-in-Comfy file. Weight and Stress do not create the badge. Empty output is not Validated |
| **Mark as Done** is refused | The dataset is not Validated, or the wildcards folder has no `<lora:…>` matching that dataset’s LoRA stem |
| Validation will not start | ComfyUI is running, **Test ComfyUI** succeeded, LT nodes were installed and Comfy was restarted, **Edit Workflow → Save workflow** was used on that tool, `output` has `.safetensors`, at least one set exists, and another shared preview run is not active. Errors include `Capture a ComfyUI workflow first (Save workflow from the … tab).`, `No validation sets defined for this dataset`, and `No .safetensors snapshots under:`. Depending on the tool, the error may name the **Validate**, **Validation Steps**, **LoRA Validation**, **Upscale**, **Context**, or **Expression** tab |
| A preview tool says another run is in progress | Steps, Weight, and Stress share one graph and are mutually exclusive. Messages name the blocker and end with `before validating`, `before weight validation`, or `before stress-testing`, depending on the pair |
| **Run** continued into other datasets | That is the continuum: unfinished Steps, then Weight, then Stress, on trained datasets. **Stop** ends it |
| Stress continued after one model failed | By design. The banner lists `FAILED · {model}`. Untick models that crash Comfy |
| A stress model vanished from the set | Comfy no longer lists it. It was dropped, not failed |
| Red nodes in Comfy | A Manager pack is missing. LoraTraining does not install it. Use the pack table in this file only for the names it lists |
| Missing model file in Comfy | The user downloads the file in the table above into the listed folder. LoraTraining does not fetch it |
| Workflow **Save** is refused | `!WorkflowBackups` could not write `last.bak`, or the graph for that tool had not loaded. Fix the folder and save again. Do not force another tool’s graph into this file |
| Library slow on first open | The first sync walks the folders. Progress is on the status bar. Later opens use the cache |
| Update check finds nothing | With a Release folder set, that folder has no newer `LoraTraining Setup *.exe`. With the folder empty, GitHub has no newer release, or the latest release has no Setup exe. **What's new** appears only after a newer version is found |
| Delete dataset or Clear output is blocked | The current guard blocks running/paused training and Validation Steps for that dataset. The exact error starts `Cannot {action} while …`. It does not currently test Weight, Stress, Upscale, or Diversify |

Shared-preview busy errors are searchable as: `A model stress-test run is in progress — stop it before validating.`, `A validation-weight run is in progress — stop it before validating.`, `A LoRA validation run is in progress — stop it before weight validation.`, `A model stress-test run is in progress — stop it before weight validation.`, `A LoRA validation run is in progress — stop it before stress-testing.`, and `A validation-weight run is in progress — stop it before stress-testing.`

### OSError 1455 (Windows, large Krea 2 checkpoints)

This is usually not “install more RAM” or “grow the pagefile forever.”

On Windows, safetensors’ default mmap backend reserves commit charge (RAM plus pagefile reservation) for the whole weight file up front. A multi-gigabyte checkpoint can exhaust **system commit** while physical RAM still looks free. After several failed loads, other apps can fail to allocate until leftover processes are killed or the PC is rebooted.

LoraTraining does not launch `run.py` directly. It starts `train_bootstrap.py`, which patches safetensors to prefer `pread` or streaming reads instead of mmap. On OSError 1455 it **aborts immediately**. It does not fall through to a heavier loader.

The job log (`!Jobs\{id}\logs`) should contain, once near the start:

```
[LoraTraining] training via train_bootstrap.py (safetensors 1455 workaround)
[LoraTraining] safetensors Windows shim ACTIVE (safetensors X.Y.Z; ...)
```

A memory line may show physical RAM free and commit (pagefile) free. If commit remaining is under about 8 GB, a Krea 2 load is likely to fail until commit is freed.

If it still fails:

1. Do not retry in a tight loop. Each failed mmap can make the session worse.
2. End leftover `python.exe` from a crashed train or from Comfy (Task Manager). Reboot if commit is already exhausted.
3. Close ComfyUI and other GPU apps before the next load.
4. Update `safetensors` inside the **AI Toolkit** venv if that package is very old (`pip install -U safetensors` there). That is the toolkit environment, not an LoraTraining installer step.
5. Debug opt-out only: environment variable `LORA_TRAINING_ALLOW_SAFETENSORS_MMAP=1` restores mmap. Do not recommend this as a fix.

A failed job that leaves Python running holds commit. Comfy previews at the same time as training compete for VRAM and RAM. The 10-second gap is between jobs. It does not repair an exhausted commit limit. The installer does not clear commit that is already exhausted. Reboot once if that was the state before upgrading.

The exact text AI Toolkit prints for step, loss, learning rate, and seconds per iteration is **unknown** beyond “the queue parses tqdm-style progress.” Do not invent a log regex.

---

## Technical behaviour assistants must not invent past

- One training process at a time. By default, Start refuses if captioning is already active. `allowConcurrentCaptioning: true` permits that overlap, and JoyCaption itself has no reciprocal training-busy guard. It is a `settings.json` key, not a Settings control; the next Settings save resets it to false.
- `continueOnFailure` defaults to true in `settings.json`. There is no Settings → Queue screen, and the next Settings save resets it to true. **Stop** does not start the next job.
- Pause, Stop, and cancel kill the Windows process tree. Pause is not a cooperative pause inside AI Toolkit.
- Resume uses the same YAML. Whether the toolkit resumes the last checkpoint is **unknown**.
- Queue runtime updates do not rewrite the saved training config. Step totals come from `train.steps`, never from a tqdm total.
- The global Krea 2 model (path, arch, quantize, low VRAM, layer offloading) is Settings-wide and is applied when YAML is written.
- There is no supported switch for Flux, SDXL, Wan, or any other architecture. Do not describe hidden flags for them.
- There is no Face diversify tool. Context and Expression only.
- There is no in-app downloader for the caption model or the Comfy weights.
- There is no Extra args box and no Comfy Secure checkbox. Those keys, if present, live only in `settings.json`.
- The training form does not include a Logging section, max saves, push to hub, flips, or the sample size fields. Those keys can exist in the saved config. Do not invent clicks for them.
- Workflow **Save** is explicit. Installing the LT package does not replace a graph that is already in the library. Save is refused if the backup cannot be written.
- **Mark as Done** is manual and requires a `<lora:…>` hit in the wildcards folder. Finishing a validation run does not mark Done.
- Dataset discovery is one folder level under the category, even when the category path itself is nested. The dataset image scan is non-recursive. Category discovery counts jpg, jpeg, and png. Rescan also counts webp and bmp.
- **NTFS versions** defaults off. Off, or on a non-NTFS dataset, Edit image/Upscale overwrite the image. Enabled on NTFS, history stops at four slots (`VER_1`…`VER_4`). Disk writes for the editor happen on Save. On the dataset screen **E** opens the editor. Inside the editor **E** saves.
- File actions stay inside the dataset folder. The app refuses a reveal or delete path that escapes it.
- This shell does not use the GPU. Do not suggest turning hardware acceleration on as a supported fix.
- AppData is not the library. Do not tell the user to back up `%APPDATA%\lora-training` as their datasets. Jobs are under `{libraryRoot}\!Jobs`.
- **Continue on failure** defaults to on. A failure does not always stop the queue.
- GPU cooldown between jobs is 10 seconds. The training priority boost refreshes every 5 seconds.
- There is no cloud account and no documented telemetry switch.
- Do not invent how AI Toolkit formats its progress lines. That detail is **unknown**.
- Do not invent JoyCaption behaviour beyond the dialog: **Only missing**, **Append to existing**, or **Overwrite (redo)**.

---

## If this file is not enough

Tell the user to open https://github.com/aipower66669/LoraTraining/issues and include:

- LoraTraining version (installer file name or the running app)
- Windows 10 or 11
- Whether the failure is in LoraTraining, AI Toolkit, JoyCaption, or ComfyUI
- What they expected and what happened
- The error text, or the relevant lines from `!Jobs\{id}\logs`

Do not attach dataset images, captions, or private prompts.

Do not tell them the assistant can fix an undocumented feature. Say it is not documented and the issue tracker is the next step.

Before opening an issue, the project asks the user to upload `docs/all-in-one.md` (this guide plus the FAQ) to their assistant and ask there first. If that did not resolve it, the issue should say what the assistant got wrong or could not answer.

---

# LoraTraining FAQ

Answers a user or an assistant can use without opening another file. Each answer names the screen, what must already be true, what should happen, and what to check when it does not.

LoraTraining does not train models and does not install AI Toolkit, ComfyUI, CUDA, or model files. Those tools have their own manuals. This FAQ covers only how LoraTraining calls them.

Platform: Windows 10 / 11. Training and Comfy previews are **Krea 2** only.

---

## What the app is

### What is LoraTraining?

A Windows desktop app that manages image folders, captions, and training jobs. [AI Toolkit](https://github.com/ostris/ai-toolkit) runs the training. ComfyUI makes preview images when you ask it to. The header always has **Datasets**, **Image Scraper**, and **Settings**; **Jobs** and **Queue** appear after AI Toolkit Work dir is set.

### Does LoraTraining train the LoRA itself?

No. It writes a YAML file and starts AI Toolkit’s `run.py` (on Windows, through `train_bootstrap.py`). If the loss, the optimizer, or a Python traceback comes from the toolkit, that failure belongs to the toolkit environment, not to a missing LoraTraining installer step.

### Which models are supported?

Krea 2 text-to-image only, for the training defaults and the Comfy preview graphs. Flux, SDXL, SD1.5, Wan, and other bases are not supported. There is no hidden switch for them.

### What are the four work areas?

**Datasets** is the library, image grid, and icon-only middle tabs. **Image Scraper** and **Settings** are always in the header. **Jobs** and **Queue** appear after AI Toolkit Work dir is set. Settings always has **External tools**; **Default training config** appears after the same AI Toolkit field is set. Queue keys exist in `settings.json` but have no Settings controls.

### What is intentionally not in the app?

No built-in trainer, no CUDA installer, no model downloader, no cloud account, no multi-user mode, and no macOS or Linux build. Images stay as normal files on disk. They are not stored in a database inside the app.

---

## Install and first launch

### How do I install LoraTraining?

1. Open https://github.com/aipower66669/LoraTraining/releases/latest
2. Download `LoraTraining Setup X.Y.Z.exe`.
3. Optional: in PowerShell, `Get-FileHash -Algorithm SHA256 ".\LoraTraining Setup X.Y.Z.exe"` and compare it to `SHA256SUMS.txt` on that release.
4. Run the installer.

Expected result: a Start menu entry named LoraTraining. On first launch, open **Settings → External tools → Library**, set **Library root**, and wait for **Settings saved**. There is no automatic folder picker.

### Why does SmartScreen say Windows protected your PC?

The installer is unsigned. That warning is expected. If you trust this GitHub release, choose **More info**, then **Run anyway**. A hash mismatch against `SHA256SUMS.txt` means do not run it. Reinstalling CUDA does not clear SmartScreen.

### How do I run it from source instead?

```bash
git clone https://github.com/aipower66669/LoraTraining.git
cd LoraTraining
npm ci
npm run dev
```

`npm ci` installs the lockfile versions; use `npm install` instead when intentionally changing dependencies. `npm run dev` is the app with hot reload. `npm run check` runs typecheck, lint, and Vitest. Run it locally before a release. GitHub Actions does not run on a branch push or a pull request. Pushing a tag `vX.Y.Z` that matches `package.json` (this release: `v0.4.0`) is the only workflow: it runs that check, then builds and attaches the installer. A short tag such as `v0.4` does not run that build. `npm run dist` bumps the patch version, clears `release\`, and writes `release\LoraTraining Setup X.Y.Z.exe`. `npm run dist:nobump` clears `release\` and writes that installer without changing the version. `SKIP_RELEASE_CLEAN=1` keeps files already in `release\`. Source checkout is for people changing the app. Training does not require it.

### Where do I set the library folder?

**Settings → External tools → Library**. Pick a folder you can back up. Until it is set, the app may report `Library root is not configured`. New category and dataset folders normally live there. Legacy/fallback label categories can point at external dataset folders, which must be backed up separately.

### What if I skip AI Toolkit, JoyCaption, or ComfyUI?

The library still opens.

| Missing | You can still | You cannot |
| --- | --- | --- |
| JoyCaption | Write captions by hand and manage datasets | Automatic caption controls, Add to caption queue, and dataset Description |
| AI Toolkit | Manage datasets and captions, view existing outputs, and use configured Comfy tools | Jobs, Queue, Create/Open Job, queue drawer, library Queue filter/badge, pending Further training rows, and Default training config |
| ComfyUI | Manage datasets, caption, train, and view existing checkpoints | Validation, Weight, Stress, Upscale, Context, Expression, image-menu Comfy actions, checkpoint keep/move, and Output validation details |

### Why are tool buttons or whole work areas missing?

The app hides features that cannot work yet. JoyCaption UI appears when **Settings → External tools → JoyCaption → Work dir** is non-empty. Jobs/Queue/training UI appears when **AI Toolkit → Work dir** is non-empty. Comfy tools appear when **ComfyUI → LoRAs** is non-empty. Settings stays visible so those paths can be configured.

This only tests whether the required field is filled, not whether the path works. Use the matching **Test** button. A running caption/training process keeps its progress and stop controls if configuration changes, and hidden jobs/outputs are not deleted.

### How do I know setup is finished?

**Test AI Toolkit** says OK, **Settings → External tools → Training model** points at a Krea 2 checkpoint, a dataset has a caption on every image and is marked Ready, and **Queue → Start** produces `.safetensors` files in that dataset’s `output` folder. Previews additionally need **Test ComfyUI** OK and a saved workflow.

### How do I update the app?

**Settings → External tools → App updates.** Leave **Release folder** empty to check GitHub Releases for a newer `LoraTraining Setup X.Y.Z.exe` and download it from there. A folder overrides that and uses the installers already in it. **Check for update** compares the newest version with the running app. Before the check, **Installed** shows the running version and whether the next check uses the folder or GitHub Releases. After the check it also shows the newest version found. When that version is newer, **What's new** opens its release notes as rendered markdown. With a folder set, those notes are `RELEASE_NOTES.md` in that folder or the folder above it, and the app does not contact GitHub. With the folder empty, the notes are the GitHub release for that version. **Install update** quits the app and runs the installer. A GitHub update downloads the installer first. Leave **Run** ticked on the installer finish page.

If Check finds nothing in a folder, that folder has no Setup exe. If GitHub has no newer release, the app is already on the latest published version.

### Does a dev build and an installed build share settings?

They share the pointer in `%APPDATA%\lora-training\app-config.json`. Both open the same library if that pointer is unchanged.

---

## Settings, defaults, and where state lives

### Where are my settings stored?

`{library folder}\settings.json`. That file holds tool paths, Comfy, queue preferences, the default training config, and last-used tool values.

`%APPDATA%\lora-training\` holds only `app-config.json` (the library path) and `window-state.json` (window position and size). Wiping AppData does not delete datasets. You point **Settings** at the library folder again.

### What is the difference between Export settings and copying the library?

**Settings → External tools → Library → Export settings…** writes a small JSON file (`format: lora-training-settings-export`) with the Settings-page fields only: library root, tools, Comfy, queue prefs, default training config, and the update folder. It does not include datasets, jobs, workflow graphs, recent dataset/job IDs, or last-used prompts and tool values.

Copying the library folder copies all of that, including `settings.json` and the Comfy graphs. Use Export when moving prefs onto an empty library. After import, fix absolute paths if the drive letters differ. Import asks **Import settings?** because it replaces the current Settings-page values.

### What does Settings → External tools → Training model change?

Under **Settings → External tools → Training model**, the visible controls are Checkpoint path, Architecture, Low VRAM, Quantize, and one Layer offloading slider (0–100% in 5% steps; 0% disables it). Architectures are Krea 2 raw, Krea 2 Turbo, and the Edit Training variant of each. It applies to **every** job the next time YAML is written. The Jobs form does not have its own copy.

The screen has no quantization-type, text-encoder quantization, text-encoder offload, or model-kwargs controls. Those values may exist in the stored default config; do not look for clickable fields.

### What is Default training config?

This Settings tab appears after AI Toolkit **Work dir** is set. It is the template copied when a job is created: rank, steps, learning rate, resolution, and the other training fields. It is not a second trainer. Changing it does not rewrite jobs that already exist.

Steps and Save every have one additional convenience rule: if jobs are already in the live FIFO, a new job takes those two values from the last queued job. With no live queue value, it uses Settings (or 2000 steps / save every 250 as the fallback).

### What does NTFS versions do?

**Settings → External tools → Library → NTFS versions** is an optional advanced image-history feature. It defaults **off**.

- **Off:** Edit image and Upscale overwrite the image on save, like Paint or Photoshop. No version history is created.
- **On, with the dataset on an NTFS drive:** the pristine image and up to four edit/Upscale tips are stored in NTFS alternate data streams. **Undo last edit** and **Revert to original** can use that history.
- **On, on a non-NTFS drive:** saves still overwrite because the required alternate data streams are unavailable.

Normal and first-time users can leave it off. If an existing stack is present when the option is turned off, it remains readable until the next Edit image or Upscale save; that overwrite makes the saved result the main image and clears the stack.

### What is the difference between Continue on failure and Allow concurrent captioning?

Both are keys in `{libraryRoot}\settings.json` under `queue`. There is **no Queue page** in Settings.

**`continueOnFailure`** (default `true`): the failed job leaves the FIFO. True starts the next job after a 10-second cooldown; false leaves the remaining queue stopped. **Stop** and **Stop after this** also refuse to auto-start the next job.

**`allowConcurrentCaptioning`** (default `false`): **Queue → Start** refuses while JoyCaption is active, with `Captioning is running; training is blocked`. When true, training may start while that caption process is active. Training itself remains single-flight. Enqueue only adds jobs; it is Start that performs this check.

There is no supported on-screen control for either key. Current Settings saves/imports also reset this object to the defaults (`continueOnFailure: true`, `allowConcurrentCaptioning: false`), so a hand edit is not durable across the next Settings save.

### Where is the Comfy address set?

**Settings → External tools → ComfyUI.** Host and port. The default is `127.0.0.1` port `8188`. There is no Secure checkbox; `secure` in `settings.json` defaults off, so the app uses `http://`. **Test ComfyUI** works only while ComfyUI is already running. **Launch** is the path of a `.bat` or `.exe`. **Launch ComfyUI** starts it. If a preview finds Comfy down, the app can ask **Launch ComfyUI?** and wait up to about four minutes. If the path is blank, the error may call this field **Launch command**; the on-screen label is **Launch**.

There is no Extra args box for JoyCaption or AI Toolkit. If `extraArgs` is in `settings.json`, it is still appended to the command.

### What does Install LT Comfy package do?

It copies this app’s small LT node pack into `{Comfy root}\custom_nodes` and, if you do not already have them, seeds the shipped workflow files into the library. It does not install ComfyUI, other node packs, or model files. Restart ComfyUI afterward. Nodes show up as **Lora Training** (LT · Prompt, LT · Seed, LT · Model, and the others).

### What is the validation LoRA subfolder?

**Settings → External tools → ComfyUI → Val. LoRA** is the default folder under Comfy `models\loras` used when a checkpoint is staged. There is no per-dataset override field. The Output tab’s **Keep in Comfy** checkbox is what actually copies or removes a file.

### What does the wildcards folder do?

**Settings → External tools → ComfyUI → Wildcards** points at a folder of Dynamic Prompts wildcard files. Prompt boxes on Validation Steps, Weight, Stress, and Upscale autocomplete `__name__` from it. Diversify prompts and training sample prompts are plain text and do not autocomplete.

**Mark as Done** also reads this folder. It looks for a `<lora:…>` tag whose name matches the dataset’s LoRA stem.

### Where do “last used” values go?

They are remembered in `settings.json` and prefill the next set or tool. They are not separate screens: last validation prompt, last weight range, last upscale fields, last Context and Expression fields, last stress model list, and last scraper source (Pinterest or Google).

---

## Categories and datasets

### How do I add a category?

**Datasets → Categories…**. You can add, rename, change the folder, reorder, and delete. The category must have a name. A duplicate name is rejected (`Category "…" already exists`). A folder collision says `Another category already uses folder "…"`. The folder is relative under the library and may be nested, such as `Group\Category`; blank defaults from the category name.

With no real categories, Add dataset may show a temporary **General** fallback. **+ New category…** in that dialog creates a normal folder-backed category before creating the dataset.

### What is the difference between a label category and a folder-backed category?

A legacy/fallback label category holds datasets you add yourself. **Remove from library** drops the catalog entry and leaves the files.

A normal, newly created category is folder-backed inside the library root. Immediate child folders become datasets. Membership follows the disk. **Remove from library** is not the way to drop those. Move the folder, or use **Delete dataset…**.

Changing a category folder moves the old directory when the destination is absent; when the destination exists, it retargets the category and leaves the old directory. Deleting a category has no confirmation and does not delete its folder or images. Dataset records move to the first remaining category, or display as **Uncategorized** if none remains.

### Why was this folder not discovered?

Discovery requires all of the following:

- The category’s relative folder resolves to an existing path inside the library root.
- The candidate is an **immediate** child, not a nested grandchild.
- The name does not start with `.` or `!`.
- The folder has `dataset.json` **or** at least one top-level `.jpg`, `.jpeg`, or `.png`.
- The folder is not empty.

`.webp` and `.bmp` count when you rescan a dataset that already exists. They do not, by themselves, make a new folder appear as a dataset.

### Why do I see two tiles for one folder?

Sync found two library records with the same path. The next sync keeps the oldest and drops the duplicate. Refresh the library and wait until the status bar finishes.

### How do I add a dataset?

Choose **Add dataset**, enter Name and Category, then **Add**. For a normal folder-backed category, the app creates a new subfolder under that category. For a legacy/fallback label category, it asks you to pick an existing folder. You can also choose **+ New category…**; that creates a category folder under the library and then its dataset child. Images the grid trains on live in the dataset root, not in subfolders.

### What does Duplicate dataset do?

Library context menu → **Duplicate…**. Default name `{name} V2` (or the next `Vn`). It copies images and captions into a sibling folder, keeps trigger, caption guidance, notes, and Steps / Weight / Stress set configs, and **skips** `output`. Ready, trained, validated, and done are cleared. Checkpoints and previews are not copied, so you can re-caption without inheriting old results.

### What is the difference between Remove from library and Delete dataset?

**Remove from library** deletes the catalog entry only, and only when the category is not folder-backed. Files stay on disk.

**Delete dataset…** deletes the folder on disk (images, captions, and `output`) after you confirm. It is blocked for running/paused training and Validation Steps on that dataset. The current guard does not test Weight, Stress, Upscale, or Diversify. It will not delete the category root itself.

### What does Rename do?

**F2** or the context menu. If the sanitized folder name changes, the folder on disk can be renamed and linked jobs are remapped.

### How do status icons work?

Highest priority first: **Done**, **Validated**, **Trained**, queued or training, **Ready**. Filters in the library are icon chips. A search in quotes (`"word"`) matches a whole word.

When AI Toolkit is configured and Queue status is visible, a draft job does not activate the **Queue** filter or queued/training icon. Those require `queued`, `running`, or `paused`.

### Why is Validated gone after I queued more training?

Validated means every Validation **Steps** set has a preview for every checkpoint that is still **Keep in Comfy**, and no open job plans steps past the highest file on disk. A higher step target, or a new checkpoint, clears it. Weight and Stress previews do not create the badge. An empty `output` folder is not Validated.

A successful output scan with no checkpoints also clears a stale **Trained** badge.

### Why can’t I mark the dataset Done?

**Mark as Done** sits at the bottom of Output, Validation Steps, Weight, or Stress, and only when the dataset is already Validated. **Settings → External tools → ComfyUI → Wildcards** must contain a `<lora:…>` whose name, before a step suffix, matches that dataset’s LoRA stem. `<lora:name_000000{250|500}>` counts. Clearing Validated also clears Done.

While checking, the button says **Checking…**. Refusals include `Further training is planned through step … (output is at …).`, `Dataset must be Validated before it can be marked Done.`, `No wildcards library folder is configured.`, and `No wildcard file references this LoRA (“…”).`

### How do I know a dataset scan succeeded?

**Rescan** re-reads the folder. The details show image and caption counts. A stem collision (`a.jpg` and `a.png` sharing `a.txt`) is reported in those stats. The status line is the confirmation. There is no separate “scan complete” dialog.

### What does Caption validation check?

The spell-check button in the library toolbar opens the last result. **Validate** scans Ready, queued, Trained, Validated, and Done datasets, skipping Not ready. Tabs show Missing caption, Missing trigger, No trigger word, and Unsupported image type. Click a row to open it. Unsupported `.webp`/`.bmp` files can be converted to JPG with **Fix** or **Fix all**; JPG/JPEG/PNG are training-safe.

### Can I move or copy selected images to another dataset?

Drag the selected thumbnails onto a different dataset tile. Drop normally to move; hold Shift to copy. Both datasets must be idle. The paired caption and current edited pixels travel too; existing destination names are skipped. The status reports transferred and skipped counts.

---

## Images, captions, and the editor

### How do I edit one caption?

Select the thumbnail. The details pane shows **Filename** (or the multi-select count), **Name**, **Category**, **Trigger**, **Ready**, and **Caption**. When JoyCaption Work dir is configured it also shows **Description**, the short context JoyCaption uses. A single Filename has a Reveal button. There is no Notes box. The write is debounced, then saved as UTF-8 `.txt` next to the image (same basename). Leaving the image flushes the pending edit. Several selected images share the caption edit.

With several selected, the button is **Delete Images**. A normal click uses the Recycle Bin; Shift+click deletes permanently, the same as Shift+Del.

Image menu **Clear caption** / multi-select **Clear captions** deletes the selected `.txt` files without deleting images, leaving those images uncaptioned again.

### What does double-click do? What does E do?

Double-click opens a full-size preview. Escape or Enter closes it. Arrow keys move. With focus in the image grid, **Ctrl+A** selects every image. On the dataset screen, **E** opens **Edit image**. Inside the editor, **E** or **Ctrl+S** saves and closes. The other editor keys are C crop, R rotate, F flip horizontal, Shift+F flip vertical, O remove (erase, not file delete), Z resize, A annotate, T filters, U finetune.

### What do the bulk caption buttons do?

On the dataset’s image tools:

| Button | Effect |
| --- | --- |
| Add prefix | Text at the start of every caption |
| Add suffix | Text at the end of every caption |
| Replace | Search and replace in every caption |
| Remove keyword | Deletes that phrase from every caption |
| Ensure trigger | Prepends `trigger, ` only on captions that do not already contain the dataset trigger |
| Strip trigger | Removes the dataset trigger where it appears |
| Convert non-PNG/JPG → JPG | Leaves PNG and JPG alone. Skips a conversion when the JPG name already exists |
| Shrink to min 1024px | Downscales only. If the shortest edge is already 1024 or less, the file is unchanged. Larger images are scaled so the shortest edge becomes 1024. The file is replaced |

Bulk caption tools can preview a dry run before writing. Confirm the count before you apply one.

### Where can I see queued JoyCaption work?

While captioning runs, click the progress strip in the bottom status bar, or focus it and press Enter/Space. **Caption queue** shows the current category, dataset and file, all remaining files, and later dataset jobs with their mode and image count. Escape or clicking outside closes it. **Stop** beside the strip stops captioning and clears the waiting caption queue.

### What does Add identity tag do?

It inserts `.photo of a girl named Name.` using a name not already used in this dataset. Modes are **Only missing**, **Redo**, and **Remove**. The rest of the caption is not rewritten. Used names are listed in `identity-names-used.txt` beside `dataset.json`.

### How do I caption with JoyCaption?

Configure **Settings → External tools → JoyCaption** and press **Test JoyCaption** first. Then select images and run **JoyCaption**, or use **Add to caption queue…** on a library tile. Shift+click the Images-toolbar JoyCaption icon skips the dialog and runs **Only missing** with **Prepend trigger**.

Until Work dir is set, those automatic-caption controls and Description are hidden. Manual caption editing, **Set caption**, identity tags, clear-caption actions, and bulk caption tools remain available.

The dialog has **Prepend trigger** (disabled until the dataset has a trigger) and three modes:

- **Only missing** — skip images that already have a `.txt`. This is the safe default.
- **Append to existing** — generate for every image and add the new text after the old caption.
- **Overwrite (redo)** — replace every `.txt`.

Optional caption guidance is sent as `--context-file` when the script is new enough (the bundled line is). An older copy of the script sitting in the working directory can reject that flag.

Success is exit code 0 and a `.txt` beside each image you asked it to write. Progress is the caption bar at the bottom of the window. Click that bar while it is running to open the **Caption queue** popover (remaining files, then later datasets). Escape closes the popover.

### Is JoyCaption the GitHub project fpgaminer/joycaption?

No. LoraTraining ships `kohya_joycaption_captioner_v5_3.py`. You do not clone that GitHub repo. You do provide a CUDA Python environment and the model `fancyfeast/llama-joycaption-beta-one-hf-llava`, which the script loads from Hugging Face on first run (typically into `%USERPROFILE%\.cache\huggingface\hub\`). The app does not download it for you ahead of time. There is no model dropdown.

### What is the difference between Del and Shift+Del?

**Del** sends the image and its caption to the Recycle Bin. No confirm.  
**Shift+Del** deletes them permanently. No confirm.  
Selection moves to the neighbor, not back to the first image.

**Delete dataset…** is the operation that asks first, and it deletes the whole folder.

### Can I undo a deleted image?

**Del** can be undone from the Windows Recycle Bin, outside this app. **Shift+Del** and **Delete dataset…** cannot. The app has no trash of its own.

### How do I edit an image inside the app?

On the dataset screen, **E** opens **Edit image…**. Inside the editor, changes stay in memory until Save; **E** or **Ctrl+S** saves and closes. Other keys, with Alt not held: **C** crop, **R** rotate, **F** flip horizontal, **Shift+F** flip vertical, **O** remove (erase, not file delete), **Z** resize, **A** annotate, **T** filters, **U** finetune.

Before Crop or Remove, the current edits are baked in so they chain without a Save in between. Save writes only if something actually changed. With NTFS versions enabled on an NTFS drive, it adds a version; otherwise it overwrites the image. Undo back to the image you opened does not count.

When **NTFS versions** is enabled and the dataset is on NTFS, the file keeps at most four version slots (`VER_1`…`VER_4`). `$DATA` is the pristine bytes. **Undo last** drops the tip. **Revert to original** deletes every `VER_*` stream. MyFileExplorer uses the same streams. With the option off or on another file system, Save overwrites the file and there is no new stack.

JoyCaption and training commit the tip into `$DATA` before they run, so they see the edited pixels. A program you start yourself reads `$DATA` only, which may still be the pristine file.

The crop dim is opacity, not a GPU blur. This window does not use the GPU.

### How do I import images without the scraper?

Drop files onto the image grid. The app **copies** them into the dataset folder. Originals stay where they were. It accepts `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, and `.txt`. Other types and names starting with `.` are skipped. The status line reports `Imported N` and, when needed, how many were skipped. `Could not read dropped file paths` means the drop did not yield paths the app could copy.

### How does the image scraper work?

Header → **Image Scraper**. Choose Pinterest or Google Images. Select a dataset in the library first. Clicking an image saves a copy into that dataset. If no dataset is selected, the error is `Select a dataset in the library first — downloads go there.` The app does not document how those websites log in.

### What does Edit in Photoshop do?

Image menu → **Edit in Photoshop…**. The first time, you locate `Photoshop.exe`. That path is remembered in library settings. There is no Photoshop field in Settings and no supported in-app control to replace a still-valid saved path. If the saved or chosen file is missing, the app asks again or reports `Selected Photoshop executable was not found.` Photoshop is optional. Training and Comfy do not need it. This app does not document Photoshop’s own tools.

### How do I set the cover image?

Image menu → **Set Dataset Cover**. The library tile uses that file’s thumbnail. The name is stored on the dataset record as the cover file.

---

## Jobs and the training form

### How do I create a job?

First set AI Toolkit **Work dir**. Until it is set, Jobs, Queue, Create/Open Job, the queue drawer, library Queue filter/badge, pending Further training rows, and Default training config are hidden. Existing records and output files are preserved.

All of these must be true:

1. **Settings → External tools → AI Toolkit → Test AI Toolkit** is OK, and **Settings → External tools → Training model** points at your Krea 2 weights.
2. The dataset folder exists.
3. The dataset is marked **Ready**.
4. Every image in the folder root has a caption. The app scans the disk at create time. A stale count in `dataset.json` does not override that.
5. The dataset has no other non-archived job. Complete, failed, and cancelled jobs still count until archived or deleted.

Then use **Create Job** from Datasets or **New job** (+) from Jobs. Edit fields and wait for **Saved**, or press **Enqueue**, which flushes the ~450 ms autosave and opens Queue. There is no separate Save button. Shift+click **Create Job** creates and enqueues without leaving Datasets.

If the dataset trigger is missing from some captions, **Missing trigger in captions** appears before creation. **Fix missing** prepends `trigger, ` only to those captions and then creates the job. **Create** continues without altering them. Cancel creates nothing.

Refusals you may see:

- `Dataset is not marked Ready` — tick Ready after you have checked images and captions.
- `Cannot create a job: N images still missing captions` — caption those images.
- `Cannot create a job: dataset has no images` — put images in the folder root and rescan.
- `This dataset already has a job` — open that job, or archive it, then create another.
- `That dataset already has a job` — you tried to change a job onto a dataset that already has a non-archived job.
- `Dataset folder missing: …` — restore the folder or fix the path, then rescan.

### Where is the learning rate, rank, and step count?

On the job form and under **Settings → Default training config**. The groups on the form are Job / process (LoRA name, Device, Trigger word), Network (Rank, Alpha), Save (Save every, Data Type: BF16, FP16, FP32), Dataset (folder or dataset, Resolution, Caption dropout, Cache latents, Shuffle tokens), Train (Steps, Learning rate, Batch size, Optimizer, Cache text embeddings, Gradient checkpointing, Disable sampling, Skip first sample), and Sample (prompts, one per line).

Optimizer choices are AdamW 8-bit (bitsandbytes), Adam 8-bit (bitsandbytes), AdEMAMix 8-bit (bitsandbytes), Lion 8-bit (bitsandbytes), AdamW 8-bit (toolkit), Adam 8-bit (toolkit), Prodigy 8-bit, Prodigy, AdamW, Adam, Lion, Adafactor, Adagrad, Automagic, Automagic 2, Automagic 3, and DAdaptation (legacy). There are no SGD or RMSprop entries. There is no Logging section. Max saves, push to hub, flips, and sample width/height can exist in the saved config. They are not their own controls. Do not look for them on the form.

After a real `.safetensors` checkpoint exists on disk, LoRA name, dataset, trigger, resolution, dtype, and network fields are locked for that job. Steps and other train settings remain editable until training starts. Synthetic Pending rows do not lock these fields.

Fresh-library defaults are Device `cuda:0`, Rank/Alpha 32/32, Save every 250, BF16, Resolution 512, Caption dropout 0, Cache latents on, Shuffle tokens off, Steps 2000, Learning rate 0.0001, Batch size 1, AdamW 8-bit (bitsandbytes), Cache text embeddings on, Gradient checkpointing on, Disable sampling on, and Skip first sample on.

- **Rank** is the network linear size. **Alpha** is linear alpha. Type stays `lora`.
- **Steps** is `train.steps`. The queue ETA uses this number. If it was never saved, Duration and Finish stay “—”.
- **Save every** is on the form. **Max step saves to keep** can exist in the saved config but has no control.
- **Resolution** is the dataset resolution list and defaults to 512. It does not enlarge source images. Shrink, separately, only downscales. Stored sample width/height default to 1024 and are not form controls.

The checkpoint path and global Quantize toggle are **not** on this form. They are under **Settings → External tools → Training model**.

### How is the LoRA name chosen?

On create, the suggestion is the stem of the newest checkpoint already in `{dataset}\output`, otherwise `Category_Dataset`. Allowed characters are letters, numbers, `_`, and `-`. Saving does not rename it back to the dataset name. A duplicated job keeps the copied stem. There is a control on the form to apply the suggested default name again.

Checkpoint files are `{LoRA name}_NNNNNNNNN.safetensors` under the training output folder, which defaults to `{dataset}\output`.

### What is the difference between the job form and config.yaml?

The job record in `{library}\!Jobs\{id}\job.json` is the source of truth. `config.yaml` is regenerated on save and before every run. Hand-edits to the YAML are replaced. The queue does not rewrite your saved steps when a run fails or when the toolkit’s progress total looks two steps short.

### Can I archive a job?

Yes. The Jobs screen has New, Completed, and Archived. **New** means any non-archived job that is not complete, including failed and cancelled. **Completed** means complete and non-archived. **Archived** contains archived jobs. Archiving does not delete `output` or checkpoints. Archive or delete the existing non-archived job to clear `This dataset already has a job`. A running job cannot be archived or deleted; Stop it first.

### What does multi-select do on Jobs?

Select several jobs to apply shared form changes, **Enqueue (N)**, Archive/Unarchive, or Delete. LoRA name, trigger, and dataset remain per-job and locked; another field changes across all selected jobs only when you edit it. If one selected job is running, the form is read-only. Duplicate remains disabled because it works one job at a time. Multi-delete asks first and keeps datasets and LoRA outputs.

### How do I know a job was created?

It appears in the Jobs list as **draft**, with a folder `{library}\!Jobs\{id}\` containing `job.json`. It is not training until you **Enqueue** and start the Queue. Enqueue should show **queued**. If it changes to **failed** as Start begins, Start preflight rejected paths, captions, image commit, or YAML. Read `!Jobs\{id}\logs\preflight-{timestamp}.log`.

---

## Queue

### How do I start training?

**Queue → Start** runs the first job, or restarts a paused process with the same YAML. When paused, both **Start** and **Resume** are visible. Only one training process runs. The header shows total queue ETA and live `s/it`. The live log is on the Queue screen. Training logs are `!Jobs\{id}\logs\train-{timestamp}.log`.

If AI Toolkit Work dir is cleared, Jobs and Queue are hidden. Set it again and use **Settings → External tools → AI Toolkit → Test AI Toolkit**. If a process is actually running, Queue and Stop stay visible until it ends; a paused row does not keep the UI visible. Direct runtime preflight still reports `AI Toolkit is not configured` if configuration is missing.

### What does Pause do?

It opens **Pause training?**, kills the toolkit process tree, and marks the job **paused**. The tooltip says `Pause (keeps checkpoints; Start/Resume continues)`, and the dialog says continuation uses the last checkpoint when the toolkit supports it. Resume starts the process again with the same YAML. Whether AI Toolkit actually continues from that checkpoint is **unknown** and not guaranteed. Pause is not a cooperative pause inside the toolkit.

If the app restarts while a row was persisted as running, that row comes back **paused**. The child process is not relaunched automatically.

### What is the difference between Stop, Stop after this, and Restart?

**Stop** opens **Stop training?**, cancels the running job, and leaves it in the queue so you can **Retry** or **Remove**. The next job does **not** start.

**Stop after this** lets the running job finish and does not start the next one. With nothing running, it returns `Nothing is training — stop-after-current only applies while running`.

**Restart / Clear** opens **Restart / clear output?**, deletes that job’s output folder, and starts from step 0. It refuses if that folder would be the dataset root (`Refusing to clear dataset folder as training output`) or is outside the dataset / not a conventional output folder (`Refusing to delete training folder outside dataset output: …`). This deletes checkpoints for that job.

Off the Queue screen, the bottom drawer appears while any job is queued, running, or paused. It shows the count and active category/dataset/status. Actions are Start, Stop, Pause, Resume when paused, and Open. Running or paused work shows Progress, Step, Elapsed, ETA, and Rate.

### Why did the next job start after a failure?

`continueOnFailure` in `settings.json` is true, which is the default, and neither **Stop** nor **Stop after this** blocked automatic advance. The failed job leaves the FIFO. About 10 seconds later the next job starts. There is no Settings screen for this flag.

### Why did the queue stop after a failure?

`continueOnFailure` is false, or you used **Stop** or **Stop after this**, or nothing else was queued. The failed job still leaves the FIFO; the remaining jobs wait. The failed job’s log has the reason. Preflight errors (captions, image commit, YAML) use the same rule.

### Can I reorder the queue?

Drag a row. Right-click also offers **Move to Top** and **Move to Bottom**; with a selected group it moves those non-running rows together. The running row stays first and cannot be reordered. **Remove** is refused while it is running (`Cannot remove a running job from the queue`).

Ctrl-click adds rows; Shift-click selects a range. Up/Down, Home/End, Enter (Edit Job), and Escape work when focus is not in an editor. The context menu also has Edit Job, Open Dataset, Reveal in Explorer, and Remove from Queue.

### What do Duration and Finish mean?

**Duration** is that job alone. **Finish** includes the jobs ahead of it. Before any measured rate exists, the estimate is 7 seconds per step. While a job runs, the live `s/it` is used and refreshed about every 60 seconds. Queued, paused, and later idle jobs use the last measured rate; there is no 7/live blend. That rate is retained in this window’s local storage, not library settings. These are estimates, not a promise. They need `train.steps` on the job.

### Why is the PC not sleeping during training?

While training runs, and during the 10-second gap before the next job, the app holds a wake lock and raises process priority, refreshing that boost every 5 seconds. The toolkit does not open its own console window. The LoraTraining window itself does not use the GPU. VRAM is for Python and Comfy.

### How do I know training succeeded?

The job status becomes **complete**, and new `{name}_NNNNNNNNN.safetensors` files are in the dataset `output` folder. **Failed** or **cancelled** means it did not. The log file is the detail. The exact text AI Toolkit uses for step and loss lines is parsed as tqdm-style progress. The precise regex is **unknown**. Do not invent one.

---

## Windows errors while training

### What is OSError 1455 / “paging file is too small”?

Windows commit charge. Safetensors normally memory-maps the whole checkpoint. A multi-gigabyte Krea 2 file can exhaust commit (RAM plus pagefile reservation) even when Task Manager still shows free RAM. Growing the pagefile forever is not the fix this app expects.

On Windows, LoraTraining starts `train_bootstrap.py`, which makes safetensors read with `pread` instead of mmap. On 1455 it stops immediately. It does not try a heavier loader.

### How do I know the workaround is active?

Near the start of `!Jobs\{id}\logs` you should see:

```
[LoraTraining] training via train_bootstrap.py (safetensors 1455 workaround)
[LoraTraining] safetensors Windows shim ACTIVE
```

A memory line may show commit free. If commit remaining is under about 8 GB, free some before the next load.

### The shim is active and it still fails. What now?

1. Do not retry in a tight loop.
2. End leftover `python.exe` processes from a crashed train or from Comfy. Reboot if commit is already exhausted.
3. Close ComfyUI before the next training load. They share RAM and VRAM.
4. If the AI Toolkit venv has a very old `safetensors`, update it **inside that venv**. That is the toolkit environment, not an LoraTraining button.
5. `LORA_TRAINING_ALLOW_SAFETENSORS_MMAP=1` turns the workaround off. Use it only to debug. It is not a fix.

### Is this a LoraTraining bug or an AI Toolkit bug?

If the log shows the shim line and then a Python traceback from the toolkit, the toolkit run failed. If the log never shows the shim line, the spawn did not go through the bootstrap. Check **Settings → External tools → AI Toolkit** paths and that you are on a current build. LoraTraining will not repair CUDA or the venv.

---

## Comfy previews

### How do I turn previews on?

1. ComfyUI already runs a Krea 2 graph on its own.
2. **Settings → External tools → ComfyUI**: Host, Port, Comfy root, and LoRAs.
3. **Install LT Comfy package**, then restart ComfyUI.
4. Install any red nodes with ComfyUI Manager, and download the model files listed below, once.
5. **Test ComfyUI** while Comfy is running.
6. Open the dataset tab, **Edit Workflow** if you need to change the seeded graph, then **Save workflow** and confirm the named tool.

Until **Settings → External tools → ComfyUI → LoRAs** is set, the six Comfy tabs, image-menu Upscale/Diversify, checkpoint keep/move controls, and Output validation details are hidden. Existing output checkpoints remain visible.

### Which tab does what?

| Tab | You set | The app varies | Files |
| --- | --- | --- | --- |
| Validation Steps | Model, prompt, seed, LoRA weight | Each keep-in-Comfy checkpoint that has no preview | `output\Set N\{lora stem}.jpg` |
| Validation Weight | One checkpoint, model, prompt, seed, min/max/step | The weight | `output\Weight N\{stem}_{weight}.jpg` |
| Model Stress-Testing | One checkpoint, prompt, seed, weight, ticked models | The Comfy model | `output\Stress N\{model}_{short hash}.jpg` |

All three share one graph, `comfy-workflow-validation.json`. They cannot run at the same time. Exact busy messages include `A model stress-test run is in progress — stop it before validating.`, `A validation-weight run is in progress — stop it before validating.`, `A LoRA validation run is in progress — stop it before weight validation.`, `A model stress-test run is in progress — stop it before weight validation.`, `A LoRA validation run is in progress — stop it before stress-testing.`, and `A validation-weight run is in progress — stop it before stress-testing.`

### What does seed 0 mean? What do Real and Anime mean?

Seed **0 or below** is random per job. A new Validation Steps set defaults to **0**. New Validation Weight and Model Stress-Testing sets default to fixed seed **1**. **Real** is style index 0. **Anime** is style index 1. **Default** as the model means **Settings → External tools → ComfyUI → Model**.

The dice icon **Fill prompt from a random dataset caption** replaces the active Validation Steps prompt with one randomly selected caption. The stored existing-copy policies are `reuse_if_identical_error_if_different` (default) and `overwrite_if_different`; there is no control for them in the preview panels.

Weight min / max / step default to **0.6 / 1.4 / 0.2**. The last range you used prefills the next weight set.

### What is Keep in Comfy?

On the **Output** tab, per checkpoint. The checkbox is icon-only; its tooltip explains the state. On: copy the file into the dataset’s Comfy LoRA folder if that filename is not already somewhere under `models\loras`. Off: delete the staged copy if one exists. Training images are not deleted. Unticking a checkpoint can make Validated true again only when at least one checkpoint is still included. **Refresh Comfy LoRA locations** re-reads where Comfy has the files.

**Clear output** opens **Clear output / reset training?**; confirm **Clear output**. It removes checkpoints, training caches, preview JPGs, ratings, and staged Comfy LoRAs. It keeps training images, captions, and Validation/Weight/Stress set definitions, and uses the same running/paused-training and Validation Steps guard as Delete dataset.

### What do Move, Pending, and Further training mean on Output?

**Move** relocates the staged Comfy copy to another subfolder under `models\loras`, or records where the next validation should stage it. The checkpoint in the dataset `output` folder does not move. **Refresh Comfy LoRA locations** rescans after files were moved outside the app.

**Pending** / **Further training** rows are checkpoints planned from the current in-flight job’s step target but not written yet. They are not files and cannot be selected. They appear only while AI Toolkit Work dir is configured. Then, before any real or pending row exists, Output says **Training not started** and shows the expected folder. Without that configuration, pending rows are hidden and an empty list says **No training output found**; existing `.safetensors` still appear. Up/Down selects checkpoints; Left/Right changes the selected Steps set.

### Why did Run continue onto other datasets?

The play-icon **Run all sets** finishes unfinished work on the current dataset, then walks other **trained** datasets. Inside each dataset the order is Validation Steps, Validation Weight, then Model Stress-Testing. Sets with no checkpoint or no models are skipped. **Stop** cancels the current Comfy job and stops that walk. The header chip always says **Validating · {set label}** and jumps to whatever is active. The preview pane itself uses the specific **Validation Steps**, **Validation Weight**, or **Stress Test** status.

### Why did Stress keep going after one model failed?

That is current behaviour. A model Comfy no longer lists is dropped from the selection and is not a failure. Any other error is skipped. The banner shows `FAILED · {model}: …`, and the run ends with a summary. Untick weights that crash Comfy, especially `int8` / `convrot` files, before a long run.

### What is Stress Compare?

On Model Stress-Testing, choose **Compare models** to open the overview grid: models as rows, stress sets as columns. You can reorder and collapse rows. That layout is stored on the dataset. **Select models…** opens **Models to stress-test**; **Apply** saves the default list for new sets.

### How do I rate a preview?

On the preview, set **0–5 stars**. Unrated is not the same as zero. Zero is an explicit score. Clearing the rating returns it to unrated. The rating does not delete the JPG. **Delete image** asks first (`Delete preview image?`) and removes that JPG only, not the checkpoint.

### Why will validation not start?

Check, in order:

- ComfyUI is running and **Test ComfyUI** succeeded.
- LT nodes were installed and Comfy was restarted.
- A workflow has been saved. Otherwise: `Capture a ComfyUI workflow first (Save workflow from the … tab).` Depending on the tool, the message may name **Validate**, **Validation Steps**, **LoRA Validation**, **Upscale**, **Context**, or **Expression**.
- The dataset has `.safetensors` under `output`. Otherwise you can see `No .safetensors snapshots under:` plus the folder.
- At least one set exists. Otherwise: `No validation sets defined for this dataset`.
- Another of Steps, Weight, or Stress is not already running. The message names the blocker and ends with **before validating**, **before weight validation**, or **before stress-testing**, depending on the pair.

Red nodes in the graph are missing ComfyUI Manager packs. This app does not install those packs.

### Where do I put the Comfy model files?

You download them. The app does not. Restart ComfyUI after copying.

| File | Folder |
| --- | --- |
| `qwen3vl_4b_fp8_scaled.safetensors` | `models\text_encoders` |
| `Wan2_1_VAE_fp32.safetensors` | `models\vae` |
| `4x_foolhardy_Remacri.pth` | `models\upscale_models` |
| `Qwen-Image-Edit-2509-Q5_0.gguf` | `models\unet` |
| `qwen_image_vae.safetensors` | `models\vae` |
| `qwen_2.5_vl_7b_nvfp4.safetensors` | `models\text_encoders` |
| `Edit\Qwen-Image-Lightning-4steps-V1.0-bf16.safetensors` | `models\loras\Edit` |

Sources: Comfy-Org Krea-2 (text encoder), Kijai WanVideo_comfy (VAE), FacehugmanIII `4x_foolhardy_Remacri`, QuantStack `Qwen-Image-Edit-2509-GGUF`, Comfy-Org Qwen-Image_ComfyUI (VAE and text encoder), ModelTC Qwen-Image-Lightning. The Lightning file in that repo may use a longer name. Rename it, or change the graph, so the name matches. Create `models\loras\Edit` if it does not exist.

The Krea 2 UNET is not in that table. Set its filename in **Settings → External tools → ComfyUI → Model** to whatever Comfy shows under Load Diffusion Model. A common file is `krea2_raw_fp8_scaled.safetensors` in `models\diffusion_models`.

Packs the shipped graphs often still need from ComfyUI Manager: Dynamic Prompts for Validation and Upscale, ComfyUI-GGUF for Context, and ComfyUI-AdvancedLivePortrait plus ComfyUI-LivePortraitKJ for Expression. Expression does not list checkpoint filenames. Its portrait weights usually land in `models\liveportrait` on first run from the Kijai LivePortrait_safetensors repo.

### What if Save workflow is refused?

Each tool (Validation, Upscale, Context, Expression) has its own editor session. **Reload** reloads that ComfyUI webview. **Save workflow** opens a named confirmation such as **Save Validation** or **Save Diversify · Context**, so one graph cannot overwrite another. It also writes `!WorkflowBackups\{stem}\last.bak` first. If that backup cannot be written, Save is refused. Fix the library folder permissions and save again. **Install LT Comfy package** will not overwrite a graph you have already saved.

### How do I know a preview succeeded?

A JPG appears in the set folder named above, and the grid shows it. The run banner names the set. A missing JPG after **Run** means that checkpoint was skipped (already had a preview, not Keep in Comfy, or the set was not configured) or Comfy errored. The banner and Comfy’s own window are the next place to look. This app does not document ComfyUI’s sampler internals.

---

## Upscale and Diversify

### How do I add, remove, clear, or clone preview sets?

Validation Steps, Validation Weight, and Model Stress-Testing each have an add-set button, a remove-set button, and **Clear images**. Clear images asks first, deletes only that active set’s preview JPGs, and does not delete checkpoints. It cancels an active preview run for that set.

Only Validation Steps has **Clone…**. It copies Steps sets from another dataset that is already Validated. **Add to current** keeps yours and its confirm button says **Add sets**. **Overwrite** replaces them. With no eligible source, the dialog says **No other validated datasets available to clone from.** and offers **OK**. Weight and Stress cannot be cloned.

### How do I upscale one image?

Open the dataset, **Upscale** tab, with Comfy configured. Fields: prompt (empty uses the caption), model (`Default` or a Comfy model), seed, **Denoise** (0 to 1), style **Real** or **Anime**, and **Max Size** (64 to 8192, step 64). With no stored config, fallbacks are Denoise 0.5 and Max Size 1600. By default the result overwrites the image. With **NTFS versions** enabled and the dataset on NTFS, it becomes a new version tip. The pixels sent to Comfy are the pristine `$DATA`, not an unsaved tip. **Run all** continues through images that are not upscaled yet, with the same settings.

When versions exist and Upscale is idle, its own **Revert to original** button removes all tip edits while keeping the pristine file body. The image menu separately has **Undo last edit** and **Revert to original**.

### What is the difference between Context and Expression?

Both write sibling files named `{stem}_dNN` next to the parent. Context and Expression each have a **Run** / **Edit Workflow** toggle. There is no Face tab.

**Context** asks for a prompt, a seed, and a count from 1 to 64. Seed 0 or below is random. The prompt is not filled from the caption. New files do **not** get the parent caption, because the scene changed. Caption them again.

**Expression** asks for a **count** only (1 to 64). Each run uses a random seed. The parent `.txt` is copied onto the new files.

**Run all** uses root images only, not siblings that are already `_dNN`, times the count.

### Does Diversify commit my in-progress edit?

No. It resolves the current tip for the input and does not commit it. JoyCaption and training do commit. If you need the edited pixels to be the permanent file first, Save in the editor, or run JoyCaption or training, which commit before they start.

---

## Files, backup, and recovery

### What do I back up?

The library folder, plus any dataset folders that live outside it. That restores categories, settings, jobs, workflows, and thumbnails. AppData does not need a backup. There is no automatic backup and no cloud copy.

### Where is the train log?

`{library}\!Jobs\{job id}\logs`. Training writes `train-{timestamp}.log`; Start-preflight failures write `preflight-{timestamp}.log`. The Queue screen also shows the live log. Jobs are not stored under `%APPDATA%`.

JoyCaption logs are separate: `{library}\!Jobs\_caption-runs\{runId}\caption-*.log`.

### Can I undo an image edit?

With **NTFS versions** enabled on an NTFS dataset, **Undo last** drops the newest version and **Revert to original** deletes all version streams and leaves `$DATA`. If you have not Saved, closing without saving discards the in-memory edit. After four versions, the stack does not grow past `VER_4`. With the option off or on a non-NTFS disk, there is no newly created stack and Save overwrites the file.

### What happens if the app crashes mid-save?

Sidecar JSON, YAML, and captions are written to a temp file and then renamed. A crash during the write should not leave a half-written catalog file. An image Save that was not finished is not a new version.

### I reinstalled Windows and the library looks empty. Where is it?

Only the pointer was in AppData. The library folder is wherever you chose. Use **Settings → External tools → Library** and pick that folder again. If the folder is gone, the data is gone. There is no recovery inside the app.

### How do I move the library to another disk?

Copy the library folder. In **Settings**, set the library root to the new path. Dataset folders that were outside the library still need to exist at their old paths, or you move those too and fix each dataset path. An exported settings file does not move images.

---

## Limits, versions, and what not to ask the app to do

### Can I run two training jobs at once?

No. One training process is the limit, so the GPU is not shared between two toolkit runs. You can queue many jobs. They run one after another.

### Can I train Flux or SDXL in this app?

No. Do not look for a base-model dropdown beyond the Krea 2 arch choices (raw, turbo, edit).

### Does the app use my GPU for the window?

No. Hardware acceleration is off so VRAM stays with Python and Comfy. A slow crop preview is the CPU preview. Turning on GPU compositing is not a supported setting.

### Will Pause resume the exact step inside AI Toolkit?

Unknown. Resume only guarantees the same YAML is launched again. Whether the toolkit continues from the last checkpoint depends on AI Toolkit and is not documented here. Do not promise it.

### How do I tell a LoraTraining problem from an external-tool problem?

| You see | It belongs to |
| --- | --- |
| SmartScreen on the Setup exe | The unsigned installer. Check the hash |
| `AI Toolkit is not configured` or JoyCaption **Test** cannot find Python | Paths in **Settings** |
| `Cannot create a job: N images still missing captions` | Captions in the dataset |
| `Captioning is running; training is blocked` | The job may already be enqueued. Wait for JoyCaption, then press Queue → Start |
| OSError 1455 after the shim line | Windows commit. Close Python and Comfy, or reboot |
| A Python traceback after the toolkit starts | The AI Toolkit venv and the training settings you entered |
| Red nodes, missing `.safetensors` inside Comfy | ComfyUI Manager and the model folders. This app does not download them |
| `Capture a ComfyUI workflow first` | **Edit Workflow → Save workflow** on that tab |

### Where do I report a bug in LoraTraining?

https://github.com/aipower66669/LoraTraining/issues

Include the app version, Windows 10 or 11, whether the failure is LoraTraining, AI Toolkit, JoyCaption, or ComfyUI, what you expected, and the error text or lines from `!Jobs\{id}\logs`. Do not attach dataset images, captions, or private prompts.

Before opening an issue, upload `docs/all-in-one.md` (this FAQ plus the full guide) to an assistant and ask there. If the assistant cannot answer from that file, the issue is the right next step.

---

## Upgrades, retries, and messages you can search for

### I upgraded the app. Do I need to migrate by hand?

No, for a normal launch. The first open after an upgrade moves settings into the library if they were still in the old place. A legacy `{file}.original` sidecar moves into the NTFS version stream only on a launch where **NTFS versions** is enabled. You do not run a script for that. Developers have `npm run migrate:*` commands. Users of the installer do not.

Old workflow filenames `comfy-workflow.json`, `validation-comfy-workflow.json`, and `upscale-comfy-workflow.json` are still read if the new names are missing.

### Will an upgrade delete my datasets?

No. Datasets stay in their folders. The installer replaces the app. **Install** from Settings quits the app and runs the Setup exe. Your library folder is not the install directory. Do not point the installer at the library folder.

### Why can’t I retry this job?

**Retry** is only for **failed** or **cancelled** jobs. The message is `Only failed or cancelled jobs can be retried`. A complete job stays complete. Use **Restart / Clear** if you mean “delete output and run from step 0”, and confirm that dialog.

### Why can’t I remove or delete a job?

A running job cannot leave the queue (`Cannot remove a running job from the queue`) and cannot be deleted (`Cannot delete a running job`). Stop or pause it first. Reorder has the same limit: `Stop or pause the running job before reordering it.`

### What does “Captioning is running; training is blocked” mean?

JoyCaption is still going and `allowConcurrentCaptioning` is false (the default). Enqueue can still add a job; **Queue → Start** is blocked. Wait for captioning to finish. If the stored key is true, Start is allowed to run training concurrently with captioning. There is no on-screen toggle. This is a one-way Start check: JoyCaption itself does not refuse merely because training is already active, so avoid launching it during training unless the machine can handle both.

### What does “This dataset already has a job” mean?

One non-archived job per dataset. Draft, queued, running, paused, complete, failed, and cancelled jobs all count. Open it from **Jobs**, or archive/delete it before creating another. Archiving does not delete checkpoints.

### What does “Refusing to clear dataset folder as training output” mean?

**Restart / Clear** was going to delete a folder that is the dataset itself, not `output`. The app stops rather than delete your images. Check the job’s training output folder. It should be `{dataset}\output`, not the dataset root.

### Where is Settings, and when does it save?

**Settings** is in the header, next to **Image Scraper**. Edits autosave after about 400 ms and flush when you leave Settings. The status line says `Settings saved` after a successful write. They are stored in `{library}\settings.json`, not only in the window. A Settings save currently resets the hidden queue keys to their defaults.

### Why did the status line say Imported N · skipped M?

You dropped files on the grid. N files were copied into the dataset. M were skipped because they were not a supported image or `.txt`, or the name started with `.`. The originals were not moved.
