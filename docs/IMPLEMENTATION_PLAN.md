# Implementation Plan

Phased build for LoraTraining. Each phase ends with `npm run check` green and
the listed acceptance items demoable.

Related: [Master specification](../specs/Lora_Training_Specification.md) ·
[Decisions](DECISIONS.md) · [Development](DEVELOPMENT.md).

---

## Phase 0 — Foundations (shell)

**Goal:** Empty Electron/React app with the target folder layout and UI tokens.

| Deliverable | Notes |
| --- | --- |
| electron-vite + React + TS strict | Layout: `src/main`, `preload`, `renderer`, `shared`, `tests` |
| Typed IPC stub + `IpcResult` | Contract file + preload bridge (`window.loraTraining`); see `IPC_CONTRACT.md` |
| Global CSS tokens | Dark palette from `docs/UI_DESIGN.md` |
| Custom media protocol stub | `loratraining-media://` registration (D12) |
| Screens shell | Welcome, Datasets, Settings, Jobs, Queue (empty panels) |
| Logging (pino or equivalent) | Main-process structured logs |
| Lint / format / vitest / CI scripts | typecheck, lint (0 warnings), test, `check` |

**Done when:** App launches, navigates between empty screens, shows version via IPC.

---

## Phase 1 — Settings & external tools

| Deliverable | Notes |
| --- | --- |
| Settings persistence | `settings.json` in userData |
| Tool path form | JoyCaption + AI Toolkit fields |
| Folder / file pickers | `dialog.showOpenDialog` |
| `tools.testJoyCaption` / `tools.testAiToolkit` | Spawn python `-V` or script existence check |
| Document invocation | Finalize `docs/EXTERNAL_TOOLS.md` with chosen spawn style |

**Done when:** User saves paths; test buttons report OK/fail in status UI.

---

## Phase 2 — Dataset Manager

| Deliverable | Notes |
| --- | --- |
| Dataset CRUD | Metadata JSON; folder pointer |
| Rescan | Image + caption inventory |
| Thumbnail grid | Lazy load; virtualize if >200 images |
| Caption editor | Per-image; autosave debounce |
| Bulk transforms | Prefix, suffix, replace, remove, ensure/strip trigger |
| Dry-run preview | Count + sample diffs |
| Trigger field | On dataset detail |
| “Open in Explorer” | `shell.openPath` |

**Done when:** Full caption workflow works without JoyCaption.

---

## Phase 3 — JoyCaption integration

| Deliverable | Notes |
| --- | --- |
| `tools.runJoyCaption(datasetId)` | Spawn with dataset folder arg |
| Caption job UI | Log stream; cancel (kill process) |
| Post-run rescan | Refresh captions after exit code 0 |
| Error surfacing | Non-zero exit → failed status + log tail |

**Done when:** Running JoyCaption from UI updates `.txt` files on disk.

---

## Phase 4 — Training config UI + YAML

| Deliverable | Notes |
| --- | --- |
| Zod schema for training config | Mirror `reference/config-sample.yaml` |
| Default config form | Grouped sections: job, network, save, dataset, train, model, sample, logging |
| JSON ↔ YAML round-trip | YAML library; golden test against sample |
| Template variable resolution | When creating job from dataset |
| Export / copy YAML | Debug affordance |

**Done when:** Exported YAML structurally matches sample; placeholders resolve.

---

## Phase 5 — Jobs

| Deliverable | Notes |
| --- | --- |
| Job CRUD + duplicate | Clone default config |
| Per-job config editor | Same form as defaults |
| Materialise `config.yaml` under `jobs/{id}/` | Absolute paths for dataset + output |
| Link job ↔ dataset | Validate folder still exists before run |

**Done when:** Job YAML opens correctly and points at the right `folder_path`.

---

## Phase 6 — Queue engine + AI Toolkit runner

| Deliverable | Notes |
| --- | --- |
| Queue store | Durable job statuses |
| Single-flight runner | Spawn AI Toolkit `run.py` with yaml path |
| pause / stop / resume | Document strategy (stop = terminate; resume = requeue / checkpoint if supported) |
| Log capture | Tee to `jobs/{id}/logs/train.log` + IPC events |
| Metrics parser | Step, loss, LR, timing → progress snapshot |
| Progress UI | % bar, ETA, s/it, loss, LR, step |

**Done when:** One real (or stubbed) training process updates the progress panel live.

---

## Phase 7 — Polish

| Deliverable | Notes |
| --- | --- |
| Welcome / recent | Last datasets & jobs |
| Confirm dialogs | Destructive + stop job |
| Empty states & errors | Remediation hints |
| User guide stub | `docs/USER_GUIDE.md` |
| Windows packaging | electron-builder NSIS (optional) |

---

## Suggested milestone order for first working vertical slice

1. Phase 0 + 1  
2. Phase 2 (datasets/captions) — usable even without training  
3. Phase 4 + 5 (config + jobs)  
4. Phase 6 (queue/train)  
5. Phase 3 (JoyCaption) can run parallel to 4–6 if captioning is secondary  

---

## Effort sketch (rough)

| Phase | Relative effort |
| --- | --- |
| 0 Foundations | M |
| 1 Settings / tools | S |
| 2 Dataset Manager | L |
| 3 JoyCaption | S–M |
| 4 Config / YAML | M–L |
| 5 Jobs | M |
| 6 Queue + progress | L |
| 7 Polish | M |

S ≈ 1–2 days, M ≈ 3–5 days, L ≈ 1–2 weeks (solo, including tests), assuming known AI Toolkit log format.

---

## Implementation notes

- Prefer `spawn(pythonExe, [script, ...args], { cwd })` over `.bat` wrappers.
- Keep renderer dumb; all FS and process work in main.
- Broadcast typed app events for job/queue/log/metrics; renderer subscribes via preload.
- Do not commit secrets; tool paths are machine-local in `userData`.
