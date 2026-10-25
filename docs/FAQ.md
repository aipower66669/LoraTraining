# LoraTraining FAQ

Answers a user or an assistant can use without opening another file. Each answer names the screen, what must already be true, what should happen, and what to check when it does not.

LoraTraining does not train models and does not install AI Toolkit, ComfyUI, CUDA, or model files. Those tools have their own manuals. This FAQ covers only how LoraTraining calls them. An assistant may use an upstream manual for a question about that tool, and must say the answer came from that project.

Platform: Windows 10 / 11. Training and Comfy previews are **Krea 2** only.

**Provided AS-IS.** This is free noncommercial software. The author is not paid for it and does not provide direct support.

---

## What the app is

### Does the author provide support?

No. LoraTraining is provided **AS-IS**. It is free noncommercial software. The author is not paid for it and does not provide direct support. There is no warranty and no commitment to answer questions, fix a bug, or add a feature. This FAQ, and `docs/all-in-one.md` given to an AI assistant, are the help that exists. A GitHub issue is a public note, not a support ticket.

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

`npm ci` installs the lockfile versions; use `npm install` instead when intentionally changing dependencies. `npm run dev` is the app with hot reload. `npm run check` runs typecheck, lint, and Vitest. Run it locally before a release. GitHub Actions does not run on a branch push or a pull request. Pushing a tag that starts with `v` (this release: `v0.5`) is the only build. It runs that check, then builds and attaches the installer. The workflow file on the tagged commit is what GitHub uses. `npm run dist` bumps the patch version, clears `release\`, and writes `release\LoraTraining Setup X.Y.Z.exe` plus `release\README.md` (from `resources\release-README.md`, for a file-host upload next to the exe and `comfyui-lora-training.zip`). `npm run dist:nobump` clears `release\` and writes that installer and README without changing the version. `SKIP_RELEASE_CLEAN=1` keeps files already in `release\`. Source checkout is for people changing the app. Training does not require it.

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

Double-click opens a full-size preview. Escape or Enter closes it. Arrow keys move. With focus in the image grid, **Ctrl+A** selects every image. On the dataset screen, **E** opens **Edit image**. Inside the editor, **E** or **Ctrl+S** saves and closes. The other editor keys are C crop, R rotate, F flip horizontal, Shift+F flip vertical, O remove (erase, not file delete), Z resize, A annotate, T filters, U finetune. A text box has the same move and resize handles as a rectangle. Double-click the text to type. Letters, including E, go into that box. Escape leaves the text and brings the handles back; a second Escape closes the editor. Ctrl+S still saves.

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

On the dataset screen, **E** opens **Edit image…**. Inside the editor, changes stay in memory until Save; **E** or **Ctrl+S** saves and closes. Other keys, with Alt not held: **C** crop, **R** rotate, **F** flip horizontal, **Shift+F** flip vertical, **O** remove (erase, not file delete), **Z** resize, **A** annotate, **T** filters, **U** finetune. A text box has the same move and resize handles as a rectangle. Double-click the text to type. Letters, including E, go into that box. Escape leaves the text and brings the handles back; a second Escape closes the editor. Ctrl+S still saves.

Before Crop or Remove, the current edits are baked in so they chain without a Save in between. Save writes only if something actually changed. With NTFS versions enabled on an NTFS drive, it adds a version; otherwise it overwrites the image. Undo back to the image you opened does not count.

When **NTFS versions** is enabled and the dataset is on NTFS, the file keeps at most four version slots (`VER_1`…`VER_4`). `$DATA` is the pristine bytes. **Edit image** shows **Undo last** in the top bar when a stack exists. Each click drops only the newest version and reloads the previous one. **Revert to original** on the image menu deletes every `VER_*` stream. With the option off or on another file system, Save overwrites the file and there is no new stack.

JoyCaption and training commit the tip into `$DATA` before they run, so they see the edited pixels. A program you start yourself reads `$DATA` only, which may still be the pristine file.

The crop dim is opacity, not a GPU blur. This window does not use the GPU.

### How do I import images without the scraper?

Drop files onto the image grid. The app **copies** them into the dataset folder. Originals stay where they were. It accepts `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, and `.txt`. Other types and names starting with `.` are skipped. The status line reports `Imported N` and, when needed, how many were skipped. `Could not read dropped file paths` means the drop did not yield paths the app could copy.

### How does the image scraper work?

Header → **Image Scraper**. Choose Pinterest or Google Images. Select a dataset in the library first. Clicking an image saves a copy into that dataset. If no dataset is selected, the error is `Select a dataset in the library first — downloads go there.` The app does not document how those websites log in.

### What does Edit in Photoshop do?

Image menu → **Edit in Photoshop…**. The first time, you locate `Photoshop.exe`. That path is remembered in library settings. There is no Photoshop field in Settings and no supported in-app control to replace a still-valid saved path. If the saved or chosen file is missing, the app asks again or reports `Selected Photoshop executable was not found.` When **NTFS versions** is on and that image has saved versions, choose **Edit original** (the pristine file, stack kept) or **Commit latest edit** (newest version becomes the file, history removed, then Photoshop opens). Cancel does neither. With the option off, or with no versions, the file opens directly. Photoshop is optional. Training and Comfy do not need it. This app does not document Photoshop’s own tools.

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

With **NTFS versions** enabled on an NTFS dataset, **Edit image** shows **Undo last** in the top bar when the file has saved versions. Each click drops only the newest version and reloads the previous one. The image menu has the same **Undo last edit**, plus **Revert to original**, which deletes all version streams and leaves `$DATA`. If you have not Saved, closing without saving discards the in-memory edit. After four versions, the stack does not grow past `VER_4`. With the option off or on a non-NTFS disk, there is no newly created stack and Save overwrites the file.

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

