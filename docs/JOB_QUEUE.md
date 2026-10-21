# Jobs & queue

Training jobs are durable records under `{libraryRoot}/!Jobs/{id}/`. The queue is a FIFO of job IDs restored from disk on startup (`queueOrder` + status).

**Capability gate:** **Jobs**, **Queue**, dataset Create/Open Job, the bottom queue drawer, and the library Queue filter/queued badge are hidden until **Settings → External tools → AI Toolkit → Work dir** is set. The records are not deleted; configuring the path makes them visible again. **Default training config** is hidden by the same gate. If training is actually running when the path is cleared, Queue and the drawer keep Stop available until it ends; Jobs stays hidden. A paused row does not keep training UI visible.

---

## Job statuses

| Status | Meaning |
| --- | --- |
| `draft` | Editable; not in FIFO |
| `queued` | Waiting in FIFO |
| `running` | AI Toolkit child process alive |
| `paused` | Process stopped; can Resume |
| `complete` | Exit 0 |
| `failed` | Non-zero / crash |
| `cancelled` | User Stop |

One **non-archived** job per dataset. Complete, failed, and cancelled jobs also block a second job until the existing record is archived or deleted.

---

## Queue operations

| Action | Behavior |
| --- | --- |
| Enqueue | Append to FIFO |
| Remove | Drop from FIFO (not while running) |
| Reorder | Drag-and-drop or `queue.reorder` (cannot reorder the running slot against neighbors unsafely) |
| Start | Run the first runnable row; when paused, Start and Resume are both visible and restart the process with the same YAML; skips failed/cancelled rows unless Retried |
| Pause | **Pause training?** confirms; kill process tree → `paused`. Start/Resume relaunches the same YAML; toolkit checkpoint continuation is not guaranteed |
| Resume | Restart process with same YAML |
| Stop | Kill → `cancelled`; stays in FIFO for Retry/Remove; does not auto-start the next job |
| Stop after this | Let the running job finish; do not auto-start the next (queue kept); with no running job, it is refused |
| Retry | Re-queue failed/cancelled |
| Restart / Clear | Delete a safe, conventional dataset output folder; start from step 0 |

**Single-flight:** at most one running training process.

**Before spawn:** permanently Commit any existing optional NTFS tip edits in the dataset folder so AI Toolkit reads final pixels from `$DATA`. The same preflight runs before JoyCaption. **NTFS versions** defaults off, in which case editor saves already overwrite `$DATA`.

**Auto-advance:** after a clean `complete` (exit 0), or after `failed` when `queue.continueOnFailure` is true in library `settings.json` (default **on**). There is no Settings → Queue screen. A failed job leaves the FIFO regardless of the flag. With continue on, the next job starts after the usual ~10s GPU cooldown; with it off, the remaining queue waits. **Stop** and **Stop after this** block automatic advance. Preflight failures (captions, image commit, YAML) are logged to `preflight-{timestamp}.log`, marked `failed`, removed from the FIFO, and use the same continue decision. Current Settings saves/imports reset hidden queue prefs to defaults.

With `queue.allowConcurrentCaptioning: false` (default), Start refuses while JoyCaption is active. When true, training may start concurrently with that caption process. Enqueue itself only adds rows and does not perform this check. JoyCaption has no reciprocal training-busy guard, so users can still launch it after training has started.

On app startup, a persisted `running` status is hydrated as `paused`; no child process is relaunched automatically.

**While training:** wake locks (`prevent-app-suspension` + `prevent-display-sleep`), High OS priority + EcoQoS disabled on the toolkit process tree **and** the Electron process (refreshed every **5 seconds**, and again when the window blurs or focuses), and Chromium background throttling disabled — so Win11 is less likely to slow dataloaders when the window is unfocused.

---

## ETA model

Each queue row shows:

1. **Duration** — this job alone  
2. **Finish** — cumulative through this job (jobs ahead + self)

| Situation | Seconds / step |
| --- | --- |
| Idle / no live rate | **7** (conservative overshoot) |
| Running job | Live toolkit `s/it` (sample immediately, refresh ~every **60s**) |
| Queued, paused, or idle after a measured rate exists | Last measured rate; there is no blend |

The renderer retains the last measured rate in local storage key `lora-training:queue-last-seconds-per-step`. Remaining steps for the running job use `totalSteps − currentStep`. Planned steps always come from job config `train.steps` — never from tqdm `progress.totalSteps` (toolkit often reports total−2). Queue/runtime updates use `patchJobRuntime` and do not rewrite `config`. Queue snapshot includes a `totalSteps` map for reliability.

Helpers: `src/shared/queue-eta.ts`.

---

## UI

- Card-style rows, drag handle, status pill
- Icon Edit / Retry / Remove
- Ctrl/Shift multi-select; context Move to Top/Bottom applies to selected non-running rows
- Context Edit Job, Open Dataset, Reveal in Explorer, Remove from Queue
- Up/Down, Home/End, Enter, Escape keyboard navigation
- Progress panel + live log on the right
- Header total ETA + optional `live ~Xs/it`
- Outside Queue, the bottom drawer shows count, active breadcrumb/status, Start/Stop/Pause/Resume/Open, and Progress/Step/Elapsed/ETA/Rate
- Confirmations are **Stop training?**, **Pause training?**, and **Restart / clear output?**

---

## Related code

| Area | Location |
| --- | --- |
| Engine | `src/main/queue/engine.ts` |
| Jobs store | `src/main/jobs/store.ts` |
| Progress parse | `src/main/progress/parser.ts` |
| Screen | `src/renderer/screens/QueueScreen.tsx` |

See [TRAINING_CONFIG.md](TRAINING_CONFIG.md) and [EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md).

