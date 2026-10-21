# Project / app data format

New folder-backed categories and their dataset folders live under the chosen library root. Legacy/fallback label categories may point at dataset folders elsewhere on disk. The app splits its own state across two places:

- **Electron AppData** (Windows: `%APPDATA%\lora-training\`) — a minimal, disposable pointer plus window geometry. Never needs backing up.
- **The library** (a folder you choose, e.g. `F:\...`) — everything else: categories, datasets, jobs, thumb cache, and now **settings** and the captured Comfy workflow. Back this folder up and you can fully restore your workspace.

---

## Layout

```
%APPDATA%/lora-training/
  app-config.json                 # { version, libraryRoot } — the ONLY pointer; disposable
  window-state.json               # window x/y/width/height — disposable

{libraryRoot}/
  categories.json                 # category catalog (id, name, sortOrder, folder, timestamps)
  settings.json                   # tools, Comfy, queue prefs, default training config, recents, last* configs
  comfy-workflow-validation.json  # Validation Steps / Validation Weight / Model Stress-Testing graph
  comfy-workflow-upscale.json     # Upscale / Detail graph
  comfy-workflow-context.json     # Diversify Context graph
  comfy-workflow-expression.json  # Diversify Expression graph
  !WorkflowBackups/               # per-tool last.bak + timestamped history (D18)
  !Jobs/
    _caption-runs/
      {runId}/
        caption-*.log
    {jobId}/
      job.json
      config.yaml
      logs/
  !Temp/                          # in-flight Upscale / Diversify scratch
  {category folder}/
    category.json                 # per-category sidecar
    {dataset folder}/
      dataset.json                # per-dataset sidecar
      identity-names-used.txt     # optional; names assigned by Add identity tag
      !Thumbnails/                # dataset thumb cache
      image001.jpg
      image001.txt
      output/
```

Older installs may still have `comfy-workflow.json` / `validation-comfy-workflow.json` / `upscale-comfy-workflow.json`; the app reads those as fallbacks. Run `npm run migrate:rename-workflow-files` to tidy names on disk.

`!`-prefixed folders (`!Jobs`, `!Thumbnails`) are skipped by category/dataset discovery. See [library-access-and-migrations.mdc](../.cursor/rules/library-access-and-migrations.mdc) for the agent access boundary between AppData and the library.

---

## `app-config.json` (AppData pointer — shape)

```json
{
  "version": 1,
  "libraryRoot": "F:\\MyLoraLibrary"
}
```

## `settings.json` (library — shape)

```json
{
  "version": 1,
  "tools": {
    "joyCaption": {
      "workingDirectory": "",
      "pythonExecutable": "",
      "scriptPath": "",
      "extraArgs": [],
      "invocationMode": "direct"
    },
    "aiToolkit": {
      "workingDirectory": "",
      "pythonExecutable": "",
      "runScript": "run.py",
      "extraArgs": []
    }
  },
  "comfy": {
    "host": "127.0.0.1",
    "port": 8188,
    "secure": false,
    "validationLoraSubfolder": "",
    "wildcardLibraryFolder": ""
  },
  "queue": {
    "allowConcurrentCaptioning": false,
    "continueOnFailure": true
  },
  "imageVersionsEnabled": false,
  "lastValidationPrompt": "",
  "lastWeightRange": { "weightMin": 0.6, "weightMax": 1.4, "weightStep": 0.2 },
  "lastUpscaleConfig": {},
  "lastDiversifyContextConfig": {},
  "lastDiversifyExpressionConfig": {},
  "lastStressModels": [],
  "lastImageScraperSource": "pinterest",
  "defaultTrainingConfig": {}
}
```

`defaultTrainingConfig` matches the Zod training-config schema (see [TRAINING_CONFIG.md](TRAINING_CONFIG.md)). The Settings UI has no Queue section, and current Settings saves/imports rewrite the queue object to the two defaults shown above.

---

## Categories

Category records include `id`, `name`, `sortOrder`, timestamps, and optional `folderPath` for folder-backed sync. See [CATEGORIES.md](CATEGORIES.md).

---

## `dataset.json` (per-dataset sidecar, shape)

```json
{
  "id": "...",
  "name": "MyConcept",
  "folderPath": "Z:\\datasets\\myconcept",
  "categoryId": "...",
  "trigger": "ohwx concept",
  "captionExt": "txt",
  "notes": "",
  "captionGuidance": "",
  "ready": false,
  "trained": false,
  "validated": false,
  "done": false,
  "coverFileName": null,
  "spawnedFromImages": [],
  "validationSets": [],
  "weightSets": [],
  "stressTestSets": [],
  "stressCompareModelOrder": [],
  "stressCompareSetOrder": [],
  "stressCompareCollapsedModels": [],
  "createdAt": "...",
  "updatedAt": "...",
  "stats": { "images": 42, "captions": 40, "stemCollisions": [] }
}
```

---

## `{libraryRoot}/!Jobs/{id}/job.json` (shape)

```json
{
  "id": "...",
  "name": "MyConcept_r32",
  "datasetId": "...",
  "status": "draft",
  "archived": false,
  "config": {},
  "createdAt": "...",
  "updatedAt": "...",
  "startedAt": null,
  "finishedAt": null,
  "yamlPath": ".../config.yaml",
  "progress": null,
  "lastError": null,
  "queueOrder": null
}
```

**Source of truth:** `config` on the job JSON. `config.yaml` is regenerated on save/run.

---

## Dataset folder (user-owned)

```
MyConcept/
  image001.jpg                   # normal image body; optional VER_* ADS when enabled on NTFS
  image001.txt
  …
  output/
    *.safetensors
    Set 1/                       # Validation Steps
    Weight 1/                    # Validation Weight
    Stress 1/                    # Model Stress-Testing
```

`imageVersionsEnabled` defaults false. Off, Edit image and Upscale overwrite the image body. On, datasets on NTFS can keep `VER_1`…`VER_4` ADS tips; non-NTFS datasets still overwrite. Legacy `{file}.original` siblings (pre-ADS) are migrated to `VER_1` on a launch where the option is enabled. Legacy `{stem}.upscale.json` files may remain from older builds; live Upscale values are now stored in library settings, and image deletion removes the old sidecar.
---

## Atomic writes

JSON / YAML / captions: write temp sibling → `rename`.

## Backups

No automatic backup. Back up **the library folder** (`libraryRoot`) — it contains everything needed to restore a workspace, including settings and captured Comfy workflows. AppData does not need to be backed up: it only holds a disposable pointer and window geometry, and is recreated automatically (prompting you to re-set `libraryRoot`) if lost. Prefer Recycle Bin deletes for images; keep your own folder backups for important datasets.

