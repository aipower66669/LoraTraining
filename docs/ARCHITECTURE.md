# Architecture

Standalone Electron + React desktop app. Clear process boundaries; no Node APIs in the renderer.

---

## Process model

```
Renderer (React + Zustand)
        │  typed preload (contextIsolation + sandbox)
Main (datasets, captions, settings, jobs, queue, Comfy, runners, media)
        │  child_process.spawn / HTTP+WS
JoyCaption / AI Toolkit / ComfyUI / Photoshop
        └──── user image folders + app userData ────┘
```

**Media:** custom protocol serves files only under registered dataset roots. Thumbs generated with Sharp into a per-dataset `!Thumbnails` cache under the library root.

**App state split:** Electron AppData (`userData`) holds only a disposable pointer (`app-config.json: { libraryRoot }`) and window geometry. Everything else — settings, default training config, recent IDs, the captured Comfy workflow — lives under the library root, so a library backup alone is sufficient to restore a workspace. See [PROJECT_FORMAT.md](PROJECT_FORMAT.md).

---

## Repository layout

```
src/
├─ main/
│  ├─ ipc/              register handlers
│  ├─ settings/
│  ├─ categories/
│  ├─ datasets/         store, categorySync, folderWatch, convert, shrink
│  ├─ captions/
│  ├─ jobs/
│  ├─ queue/
│  ├─ comfy/            adapter, validation queue/sets, inject
│  ├─ runners/          joycaption, photoshop, process utils
│  ├─ progress/         toolkit log parsers
│  ├─ media/            protocol + thumbs
│  ├─ security/
│  └─ logging/
├─ preload/             window.loraTraining
├─ renderer/
│  ├─ screens/
│  ├─ components/
│  ├─ store.ts
│  └─ styles/
├─ shared/              schemas, ipc contract, pure helpers
└─ tests/
comfyui-lora-training/  Comfy custom nodes
docs/
reference/
```

---

## State ownership

| Concern | Owner |
| --- | --- |
| Navigation / ephemeral UI | Renderer Zustand |
| Dataset & job truth | Main + disk |
| Category sync | Main `categorySync` |
| Queue order & running pid | Main queue engine |
| Live train logs / metrics | Main → `app-event` → renderer |
| Validation progress | Main Comfy queue → events |
| Caption progress | Main tool runner → events |

---

## Config materialisation

1. Default training config in settings (seeded from sample YAML).
2. Job create: clone → apply dataset folder, trigger, name, steps.
3. Job edit: mutate job JSON `config` only.
4. Save/run: write `jobs/{id}/config.yaml`, spawn AI Toolkit.
5. Never mutate `reference/config-sample.yaml` as runtime source of truth.

---

## Error model

Structured `AppError` (`code`, `message`, optional `remediation`).  
IPC: `{ ok: true, value } | { ok: false, error }`.

See [IPC_CONTRACT.md](IPC_CONTRACT.md), [SECURITY.md](SECURITY.md), [DECISIONS.md](DECISIONS.md).

