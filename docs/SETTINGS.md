# Settings

Settings are split across two files so that **only the library needs to be backed up to restore a workspace**:

| File | Location | Contents |
| --- | --- | --- |
| `app-config.json` | Electron AppData (`userData`) | Only `{ version, libraryRoot }` — a pointer to the library. Disposable; never needs backing up. |
| `settings.json` | `{libraryRoot}/settings.json` | Everything else: tools, Comfy, queue prefs, **NTFS versions**, default training config, recent IDs, `lastValidationPrompt`, last-used Upscale/Diversify/Stress/scraper fields, `updateCheckFolder` |

Both are Zod-validated. The renderer/IPC surface (`window.loraTraining.settings.get()/set()`) still sees one merged `AppSettings` object — the two-file split is an internal detail of `src/main/settings/store.ts`. **External tools** is always available and edits Library, App updates, JoyCaption, AI Toolkit, Training model, and ComfyUI. **Default training config** appears after AI Toolkit **Work dir** is set. Queue prefs have no controls. Edits autosave after about 400 ms and flush when leaving the screen.

AppData also keeps `window-state.json` (pure window x/y/width/height — no backup value, regenerates on next launch).

**Why:** `lastValidationPrompt` can hold private prompt text, and AppData is disposable (wiped by uninstalls / OS profile resets). Keeping everything except the pointer inside the library means the library alone is sufficient to restore a workspace, and sensitive/valuable settings fall under the same library access boundary as datasets and jobs rather than the freely-browsable AppData zone.

Existing installs migrate automatically on first launch after upgrading (see [PROJECT_FORMAT.md](PROJECT_FORMAT.md)); `npm run migrate:settings -- --dry-run` previews the same migration without touching disk.

---

## Export / Import (Settings page)

**Settings → External tools → Library** offers **Export settings…** / **Import settings…**.

Exports a small JSON file (`format: lora-training-settings-export`) with only the Settings-page fields: library root, **NTFS versions**, tools, Comfy, queue prefs, default training config, and release folder. It does **not** include datasets, jobs, Comfy workflow graphs, recent IDs, or `last*` tool prefs.

A full **library folder backup** already contains the same data in `{libraryRoot}/settings.json`. Use Export when you want a portable prefs file (fresh install, new empty library, VM) without copying the whole library. Import asks **Import settings?**, then applies values as-is — fix absolute tool/Comfy paths in Settings if the machine layout differs.

---

## Sections

### Library and image editor

| Field | Default | Purpose |
| --- | --- | --- |
| Library root | Empty on a fresh install | Workspace root for categories, datasets, settings, jobs, and workflows |
| NTFS versions | **Off** | Optional advanced history for Edit image and Upscale |

With **NTFS versions off**, Edit image and Upscale overwrite the image on save, like a conventional editor. With it on, a dataset hosted on an NTFS drive keeps the pristine image plus up to four tips in alternate data streams. Non-NTFS datasets still overwrite. Turning the setting off does not immediately remove an existing stack; its next editor/Upscale overwrite saves the current result into the image body and clears the stack.

### JoyCaption

| Field | Purpose |
| --- | --- |
| Work dir | JoyCaption process cwd, normally the venv root |
| Python | Interpreter; blank uses `venv\Scripts\python.exe` from Work dir when present, otherwise Python on `PATH` |
| Script | Defaults to bundled `kohya_joycaption_captioner_v5_3.py` (not from upstream JoyCaption). Work-dir copy overrides. Fixed model: `fancyfeast/llama-joycaption-beta-one-hf-llava` — [SETUP](SETUP.md#4-joycaption-captions) |
| Mode | `direct` or `cmd` (activate.bat fallback) |

The schema preserves `extraArgs`, but the Settings screen has no Extra args field.

**Test JoyCaption:** Python OK + resolved script path.

Until **Work dir** is set, automated-caption controls, **Add to caption queue…**, and the dataset **Description** field are hidden. Manual caption editing, Set caption, identity tags, and bulk caption tools remain available.

### AI Toolkit

| Field | Purpose |
| --- | --- |
| Work dir | Toolkit root and process cwd |
| Python | Interpreter; blank uses `venv\Scripts\python.exe` from Work dir when present, otherwise Python on `PATH` |
| Script | Usually `run.py` |

The schema preserves `extraArgs`, but the Settings screen has no Extra args field.

**Test AI Toolkit:** python `-V` + script exists.

Until **Work dir** is set, the app hides **Jobs**, **Queue**, Create/Open Job, the queue drawer, the library Queue filter/queued badge, pending Further training rows, and **Default training config**. Existing jobs and outputs remain on disk. If training is actually running when the path is cleared, Queue and Stop stay visible until it ends; a paused row does not keep training UI visible.

### Training model

Visible controls: Checkpoint path; Architecture (raw, turbo, raw Edit Training, or turbo Edit Training); Low VRAM; Quantize; and Layer offloading (transformer 0–100%, step 5%). Stored on `defaultTrainingConfig.model` and applied to **every** job when YAML is written at start. Quantization type, text-encoder quantization/offload, and model kwargs remain in the stored config but have no controls.

### ComfyUI

| Field | Purpose |
| --- | --- |
| Host / Port | HTTP + WS address (defaults `127.0.0.1:8188`) |
| Comfy root | ComfyUI install folder — **Install LT Comfy package** copies bundled nodes here |
| LoRAs | Absolute path to Comfy `models/loras` |
| Val. LoRA | Default staging dir under Comfy `loras` |
| Wildcards | Directory of Dynamic Prompts wildcard files for `__name__` autocomplete in Validation Steps / Weight / Stress / Upscale prompts |
| Launch | Optional external Comfy launcher when preview jobs need Comfy started |
| Model | Default validation checkpoint filename |

The schema preserves `secure` (default false), but the Settings screen has no Secure checkbox.

**Install LT Comfy package:** copies `comfyui-lora-training` into `{comfyRoot}/custom_nodes/` and seeds the shipped working library workflows (`comfy-workflow-validation.json`, upscale, context, expression from `resources/comfy-workflows/`) when missing. Restart ComfyUI afterward. This does **not** install ComfyUI itself, third-party node packs, or models.

**You must** use **ComfyUI Manager** for any missing nodes a workflow needs, and download models into the correct `models/` sub-folder yourself. Tedious, but **once per Comfy install**.

**Seed bundled workflows** only creates missing library graphs; it never overwrites a saved graph. **Test ComfyUI** requires the server to be running. **Launch ComfyUI** starts the configured Launch command and is disabled when that field is empty.

Until **LoRAs** is set, the Validation Steps, Validation Weight, Model Stress-Testing, Upscale, Context, and Expression tabs and image-menu commands are hidden. Output checkpoints remain visible, but their validation-preview details and Comfy keep/move controls are hidden.

### App updates

| Field | Purpose |
| --- | --- |
| Release folder (`updateCheckFolder`) | Directory of electron-builder NSIS installers (`LoraTraining Setup X.Y.Z.exe`), typically repo `release/` |

The **Installed** row shows `Check to compare with folder` until **Check for update** runs, then shows the running version and, when found, the newest folder version. **Check for update** scans for the newest Setup exe and compares to `app.getVersion()`. **Install update** launches the installer (detached) and quits the app so NSIS can replace files; use the finish-page **Run** checkbox to start the new build.

Use `npm run dist` when shipping a build: it increments the patch version and clears `release/` so only the new Setup exe remains (required for Check for update to see a newer version).

### Queue prefs

Stored in `settings.json`. There is no Queue section on the Settings screen and no supported on-screen way to change these keys. **Stop** and **Stop after this** block the next job even when continue is on. Current `saveSettings` behavior rewrites this object to its defaults whenever Settings saves or imports, so manual values are not durable across a later Settings edit.

| Key | Default | Meaning |
| --- | --- | --- |
| `allowConcurrentCaptioning` | `false` | Start refuses while JoyCaption is already active. When true, training may start concurrently with it. Enqueue is unaffected; JoyCaption itself has no reciprocal training-busy guard |
| `continueOnFailure` | `true` | Failed jobs leave the FIFO. True starts the next queued job after cooldown; false leaves the remaining queue stopped |

### Default training config

Shown only after AI Toolkit **Work dir** is set. This is the full AI Toolkit process config object (network, train, model, sample, …), seeded from `reference/config-sample.yaml` on first launch with placeholders resolved for new jobs via materialisation.

### Remembered last-used fields

| Key | Used by |
| --- | --- |
| `lastValidationPrompt` | Prefill new Validation Steps Set 1 |
| `lastWeightRange` | Prefill new Weight set min / max / step |
| `lastUpscaleConfig` | Upscale / Detail fields across images (D16) |
| `lastDiversify*Config` | Context / Expression |
| `lastStressModels` | **Apply** in Stress → Select models…; seeds new Stress sets |
| `lastImageScraperSource` | Image scraper Pinterest vs Google |

---

## Related

[EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md) · [TRAINING_CONFIG.md](TRAINING_CONFIG.md) · [PROJECT_FORMAT.md](PROJECT_FORMAT.md)

