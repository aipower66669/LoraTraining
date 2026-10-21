# Security

LoraTraining is a local desktop app. The threat model focuses on **path escape** and accidental destructive IO—not multi-user remote attack surfaces.

---

## Process isolation

- Renderer: no Node integration; `contextIsolation` + sandboxed preload.
- All filesystem and process control go through typed IPC → main.
- IPC payloads validated with Zod where registered.

---

## Path guards

| Helper | Role |
| --- | --- |
| `assertAbsolutePath` | Reject relative paths for roots |
| `assertInsideRoot` | Ensure candidates stay under a dataset folder |

Deletes, reveals, media serving, and caption writes must resolve inside the registered dataset (or explicitly validated output subpaths).

**Delete dataset forever** refuses to delete a path that equals a **category root**.

**Clear output** refuses to wipe anything that is not a dedicated `output/` under the dataset.

---

## Media protocol

`loratraining-media://` (or equivalent) serves only registered dataset folders. Renderer must not use raw `file://` for library images.

---

## Settings live under the library, not AppData

Only a disposable pointer (`app-config.json: { libraryRoot }`) and window geometry live in AppData. Everything else — tool paths, Comfy config, default training config, recent IDs, and remembered prompts/tool configs (which can hold private prompt text) — lives at `{libraryRoot}/settings.json`, alongside the captured Comfy workflows (`comfy-workflow-*.json`). This means potentially sensitive settings fall under the same **library access boundary** as datasets and jobs, not the freely-browsable AppData zone — see [library-access-and-migrations.mdc](../.cursor/rules/library-access-and-migrations.mdc). It also means the library alone is sufficient to back up and restore a full workspace.

---

## Destructive actions

| Action | Guardrails |
| --- | --- |
| Image trash / permanent | Basename-only file names; extension allowlist |
| Delete dataset | Confirm UI; idle assert blocks running/paused training and Validation Steps; not category root |
| Clear output | Confirm UI; same idle assert; under dataset `output/` only |
| Bulk caption | Dry-run preview when applicable |

---

## Releases (installer trust)

Windows NSIS installers are **unsigned** today (`signExecutable: false`). SmartScreen warnings on first run are expected. Prefer downloads from [GitHub Releases](https://github.com/aipower66669/LoraTraining/releases) and verify `SHA256SUMS.txt` before installing. Code signing is a planned release goal — see [BUILD.md](BUILD.md#unsigned-installer--smartscreen).

---

## Related code

`src/main/security/path-guards.ts`, `atomic-write.ts`, media protocol, dataset/store delete paths, `src/main/settings/store.ts` (AppData pointer vs. library settings split).

