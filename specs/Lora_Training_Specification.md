# LoraTraining — Master Specification

**Status:** Draft for implementation  
**Platform:** Windows 10/11 (primary)  
**Stack:** Electron + React + TypeScript  

**Reference config:** [`../reference/config-sample.yaml`](../reference/config-sample.yaml)

---

## 1. Product intent

LoraTraining is a **local desktop control panel** for LoRA dataset hygiene and
AI Toolkit training jobs. The user:

1. Registers image folders as **datasets**, edits captions, sets a **trigger**.
2. Optionally runs **JoyCaption** (external) to (re)caption a folder.
3. Maintains a **default training configuration** (YAML fields from the sample)
   plus paths to JoyCaption and AI Toolkit.
4. Creates **jobs** (each with its own editable YAML, cloned from defaults).
5. Queues jobs and watches **live training progress** (steps, ETA, loss, LR, …).

The app **never** embeds training or captioning logic. It spawns configured
Python entry points, parses stdout/stderr (and optional log files), and persists
job state on disk.

---

## 2. Non-goals (v1)

- Reimplementing JoyCaption, AI Toolkit, or Kohya.
- Hosting or downloading base models (paths only).
- Multi-machine / remote queue.
- macOS / Linux as first-class (architecture should not preclude later).
- Automatic caption quality scoring or LLM chat UIs beyond “run JoyCaption”.
- Editing images (crop/resize) — optional later; v1 is caption + config + jobs.

---

## 3. Actors and boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (React)                                           │
│  Datasets · Captions · Settings · Jobs · Queue · Progress   │
└──────────────────────────┬──────────────────────────────────┘
                           │ typed IPC (preload bridge)
┌──────────────────────────▼──────────────────────────────────┐
│  Main process                                               │
│  Dataset index · Caption FS · Config YAML · Job store       │
│  Queue engine · Child-process runners · Log/progress parse  │
└───────┬───────────────────────────────┬─────────────────────┘
        │ spawn / cwd / env             │ read/write
        ▼                               ▼
  JoyCaption (Python)            App data + dataset folders
  AI Toolkit (Python)            Generated job YAML files
```

**Rules:**

- Renderer never calls `fs`, `child_process`, or absolute tool paths directly.
- Main validates every IPC payload with Zod.
- Dataset **images and `.txt` captions live in the user-chosen folder**; the app
  stores only metadata + pointers in its own data root.
- Job YAML files are written under the app’s job storage (or a user-chosen
  output path) and passed as the argument to `run.py`.

---

## 4. Core domains

### 4.1 Dataset

| Field | Description |
| --- | --- |
| `id` | Stable nanoid |
| `name` | Display name (renamable) |
| `folderPath` | Absolute path to image folder |
| `trigger` | Trigger token/phrase for this dataset |
| `captionExt` | Default `txt` |
| `notes` | Optional free text |
| `createdAt` / `updatedAt` | ISO timestamps |
| `imageCount` / `captionCount` | Cached stats (refreshed on scan) |

**Supported image extensions (v1):** `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`  
**Caption file:** same basename + `.` + `captionExt` (e.g. `shot01.jpg` → `shot01.txt`).  
**Scan:** non-recursive (files directly in `folderPath` only).  
**Encoding:** captions are UTF-8.  
If two images share a stem (`a.jpg` + `a.png`), they share one caption file — warn in UI.

**Operations:**

- Add dataset (choose folder).
- Rename, edit metadata (trigger, notes), delete (**app metadata only** in v1;
  never deletes the image folder).
- Rescan folder → refresh image/caption inventory.
- Open folder in Explorer.

### 4.2 Caption unit

One image + optional caption text file.

| Operation | Scope |
| --- | --- |
| View thumbnail + caption | Single |
| Edit caption (textarea, autosave) | Single |
| Create empty `.txt` if missing | Single |
| Add prefix / suffix to all captions | Dataset |
| Find & replace keyword (all captions) | Dataset |
| Remove keyword / phrase (all) | Dataset |
| Ensure trigger present (prepend or append if missing) | Dataset |
| Strip trigger from all | Dataset |
| Run JoyCaption on folder | Dataset (spawns external tool) |

Bulk ops must:

1. Preview count of files that would change.
2. Support optional dry-run.
3. Write atomically (temp file + rename) per caption.
4. Leave images untouched.

### 4.3 Tool settings (global)

| Field | Example / notes |
| --- | --- |
| `joyCaption.workingDirectory` | `F:\AI\joy_env` |
| `joyCaption.pythonExecutable` | `F:\AI\joy_env\Scripts\python.exe` |
| `joyCaption.scriptPath` | `kohya_joycaption_captioner_v5_3.py` (relative or absolute) |
| `joyCaption.extraArgs` | Optional string array |
| `joyCaption.invocationMode` | `direct` (default) or `cmd` fallback |
| `aiToolkit.workingDirectory` | `F:\ai\ai-toolkit` |
| `aiToolkit.pythonExecutable` | `F:\ai\ai-toolkit\venv\Scripts\python.exe` |
| `aiToolkit.runScript` | `run.py` |
| `aiToolkit.extraArgs` | Optional |

**Invocation contract:** see [`docs/EXTERNAL_TOOLS.md`](../docs/EXTERNAL_TOOLS.md).  
Settings UI must validate paths exist (non-blocking warnings OK).  
Locked field names: [`docs/DECISIONS.md`](../docs/DECISIONS.md) (D1, D2).

### 4.4 Default training configuration

A structured form that round-trips to AI Toolkit YAML matching the sample under
`reference/config-sample.yaml`. Stored as JSON in app settings **and**
exportable as YAML for inspection.

Placeholders in the sample (`CONCEPT_NAME`, `CONCEPT_FOLDER`, `CONCEPT_STEPS`,
etc.) become **template variables** filled when a job is created from a dataset.

**Template variables (v1):**

| Token | Resolved from |
| --- | --- |
| `CONCEPT_NAME` / job `name` | Job name (sanitized) |
| `CONCEPT_FOLDER` | Selected dataset `folderPath` |
| `CONCEPT_FOLDER/output` | Default: `{folderPath}/output` (D3); overridable per job |
| `CONCEPT_STEPS` | Integer steps on the job/default config (must be numeric in YAML) |
| `CONCEPT_CLASS` | Optional class token field |
| `CONCEPT_PROMPT` | Sample prompt field |
| `trigger_word` | Dataset trigger |

Full field inventory: [`docs/TRAINING_CONFIG.md`](../docs/TRAINING_CONFIG.md).

### 4.5 Job

A runnable training unit.

| Field | Description |
| --- | --- |
| `id` | nanoid |
| `name` | Human label; also becomes YAML `config.name` stem |
| `datasetId` | Linked dataset |
| `status` | See queue states |
| `config` | Full training config object (source of truth; YAML regenerated — D4) |
| `yamlPath` | Absolute path of last written YAML |
| `createdAt` / `updatedAt` / `startedAt` / `finishedAt` | Timestamps |
| `progress` | Latest parsed metrics snapshot |
| `lastError` | Message if failed |
| `pid` | Child process id while running (optional) |

**CRUD:** add / rename / duplicate / delete / edit config.  
Deleting a job does not delete the dataset or LoRA outputs unless confirmed.

### 4.6 Queue

FIFO (default) of jobs ready to run. Only **one** training job runs at a time
in v1 (captioning may run concurrently or also be single-flight — prefer
**single-flight for all external processes** to avoid VRAM contention; document
as setting `queue.allowConcurrentCaptioning: boolean` default `false`).

**Controls:** enqueue, dequeue, run next, pause, resume, stop (terminate process
tree — D13), retry failed. Reorder is v1.1 (D14).

States: `draft` → `queued` → `running` → `paused` | `complete` | `failed` |
`cancelled`.

---

## 5. Progress & metrics UI

While a training job is `running` (or `paused` with last known stats), show:

| Metric | Source |
| --- | --- |
| Current step / total steps | Parsed from AI Toolkit stdout / log |
| Percent complete | `step / steps * 100` |
| Elapsed time | Wall clock since start (minus paused duration) |
| ETA | `(total - current) * avgSecondsPerStep` |
| Average time per step | Rolling window (e.g. last N steps) |
| Seconds / iteration **or** iterations / second | Whichever is clearer given magnitude (show both if space) |
| Learning rate | Parsed if present |
| Loss | Parsed if present |
| Last log lines | Ring buffer of stdout |

**Parser requirements:**

- Pluggable regex / line parsers; do not hard-fail if a field is missing.
- Persist last metrics on the job record for reopen.
- Prefer parsing AI Toolkit’s existing log format; document patterns in
  `docs/EXTERNAL_TOOLS.md` and refine once live output is captured.

Captioning jobs (JoyCaption) get a simpler progress UI: process alive, elapsed
time, last log lines (unless JoyCaption emits countable progress).

---

## 6. UI surfaces

See [`docs/UI_DESIGN.md`](../docs/UI_DESIGN.md). Summary:

1. **Welcome / library** — recent datasets & jobs.
2. **Dataset Manager** — list + detail (grid of images, caption editor, bulk tools, JoyCaption).
3. **Settings** — tool paths + **default training config** form.
4. **Jobs** — list CRUD + per-job config editor.
5. **Queue & Progress** — queue drawer/panel + live metrics (can be a dedicated screen or docked panel always visible when jobs active).

Visual language: dark panels, `#4f8cff` accent, monospace for paths/metrics,
section titles, primary buttons — see `docs/UI_DESIGN.md`.

---

## 7. IPC contract

Full method table: [`docs/IPC_CONTRACT.md`](../docs/IPC_CONTRACT.md).

Domains: `system`, `settings`, `datasets`, `captions`, `jobs`, `queue`, `tools`,
plus push `events`. Every method returns
`IpcResult<T>` (`{ ok: true, value } | { ok: false, error }`).

---

## 8. Persistence

App data under Electron `userData` (and/or a user-chosen library root):

```
LoraTraining/
  settings.json          # tools + default config + UI prefs
  datasets/
    {id}.json            # dataset metadata
  jobs/
    {id}/
      job.json           # status, metrics, links
      config.yaml        # materialised AI Toolkit config
      logs/
        train.log        # captured stdout/stderr
```

Dataset image folders remain **outside** this tree (user-owned).

Details: [`docs/PROJECT_FORMAT.md`](../docs/PROJECT_FORMAT.md).

---

## 9. Security

- `contextIsolation: true`, `sandbox: true`, no `nodeIntegration` in renderer.
- Narrow preload API only.
- Path validation: refuse to write captions outside the dataset folder.
- Media protocol path-gated to registered dataset folders (D12).
- Child processes: fixed executable paths from settings; pass folder/config as
  arguments; prefer `spawn(exe, args)` over shell strings (`cmd` only if
  `invocationMode: 'cmd'`).
- On stop/pause, kill the process tree (D13).
- Confirm destructive actions (delete dataset record, stop job, bulk caption rewrite).

---

## 10. Quality bar

- Strict TypeScript (`noUncheckedIndexedAccess`, no `any` escape hatches).
- Zod at IPC and settings boundaries.
- ESLint 0 warnings; Prettier; Vitest for schemas, caption bulk transforms,
  YAML round-trip, progress parsers.
- `npm run check` = typecheck + lint + test before considering a phase done.

---

## 11. Acceptance criteria (v1)

1. User can register a folder of images, edit one caption, and apply a prefix to all.
2. User can set JoyCaption + AI Toolkit paths and run a dry “test” that verifies
   the Python binary starts (e.g. `--help` or `python -V`).
3. User can edit default training fields matching the sample YAML and export YAML
   that AI Toolkit accepts (smoke: `run.py` starts reading the file).
4. User can create a job from a dataset (config cloned + paths filled), enqueue it,
   see it run, pause/stop/resume as supported by process control, and view
   step/loss/ETA when parseable from logs.
5. UI matches the dark theme tokens and panel layout in `docs/UI_DESIGN.md`.

---

## 12. Decisions & open items

Locked defaults: [`docs/DECISIONS.md`](../docs/DECISIONS.md) (D1–D29).

Still open until a live integration run (O1–O2 in that file): AI Toolkit log
regexes and checkpoint-on-resume behavior. JoyCaption now exposes **Only
missing**, **Append to existing**, and **Overwrite (redo)** explicitly.
