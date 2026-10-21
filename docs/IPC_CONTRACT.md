# IPC contract

Source of truth for channel names and DTOs: `src/shared/ipc/contract.ts` (+ domain types in `src/shared/comfy.ts`, schemas). Preload exposes `window.loraTraining`.

---

## Result envelope

Every invoke returns:

```ts
{ ok: true, value: T } | { ok: false, error: AppError }
```

`AppError`: `{ code, message, details?, remediation? }`.

---

## Channels (summary)

### System
`getVersion` · `chooseFolder` · `chooseFile` · `openPath`

### Settings
`get` · `set`

### Datasets
`list` · `get` · `create` · `createInCategory` · `update` · `remove` · `deleteForever` · `rescan` · `openFolder` · `revealImage` · `importFiles` · `listOutputs` · `clearOutput` · `convertImagesToJpg` · `shrinkImagesToMax` · `deleteImage` · validation rating/preview helpers · Comfy LoRA staging helpers

### Categories
`list` · `create` · `update` · `remove` · `reorder`

### Captions
`get` · `set` · `bulkTransform`

### Jobs
`list` · `get` · `create` · `update` · `duplicate` · `remove` · `writeYaml` · `exportYamlText`

### Queue
`list` · `enqueue` · `remove` · `reorder` · `start` · `pause` · `resume` · `stop` · `retry` · `restartClear`  

`list` / snapshot includes `jobIds`, `runningJobId`, `statuses`, `totalSteps`.

### Tools
`testJoyCaption` · `testAiToolkit` · `runJoyCaption` · `cancelToolRun` · `editInPhotoshop`

### Comfy
`testConnection` · `saveWorkflow` · `getWorkflow` · `startValidation` (`{ datasetId }` → all sets) · `cancelValidation` · `getValidationProgress` · validation set CRUD · `clearValidationSetImages`

### Events
Subscribe via preload → `app-event` with `AppEvent` union (`job-updated`, `queue-updated`, `process-log`, `process-metrics`, `tool-run-updated`, `validation-progress`, `dataset-folder-changed`, `category-datasets-changed`, `caption-progress`, …).

---

## Conventions

- Validate payloads with Zod in `src/main/ipc/register.ts`.
- Prefer additive DTO fields; bump app version notes when breaking.
- Renderer never imports `fs` / `child_process`.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

