# Library config migrations

Agents must not edit `{libraryRoot}` configs directly. When on-disk schemas change, add and run a script here.

## Checklist

1. Name: `scripts/migrate-<short-name>.ts`
2. Resolve root with `resolveLibraryRoot()` from `scripts/lib/library-root.ts` (reads AppData `app-config.json`, falling back to the legacy `settings.json`; optional `LORA_LIBRARY_ROOT` override)
3. Touch only JSON catalogs/sidecars (`categories.json`, `category.json`, `dataset.json`, `job.json`, library `settings.json`, workflow JSON renames) — not images, captions, or `output/`
4. Make the script idempotent; log what changed; exit non-zero on failure
5. Prefer `--dry-run`
6. Add `"migrate:<name>": "tsx scripts/migrate-<short-name>.ts"` to `package.json`
7. Run via npm and report stdout — do not browse `{libraryRoot}` to verify

**When not to add a script:** missing fields that Zod already defaults on every read, and that `migrateRecord` / settings load already rewrite on open, do not need a one-shot materialize script. Add a migration when you **rename/remove** persisted keys, move data between files, or change semantics that a default cannot heal.

## Active scripts

| Script | Role |
| --- | --- |
| `migrate-settings-to-library.ts` (`npm run migrate:settings`) | One-shot AppData `settings.json` / workflow → library. The app also runs this automatically on startup; the script is a manual / `--dry-run` fallback |
| `migrate-rename-workflow-files.ts` (`npm run migrate:rename-workflow-files`) | Rename legacy workflow filenames to `comfy-workflow-<tool>.json`; seed Upscale from Validation when needed. App still reads legacy names as fallback |
| `migrate-remove-dataset-upscale-config.ts` (`npm run migrate:remove-dataset-upscale-config`) | Strip obsolete per-dataset `upscaleConfig` (Upscale settings live in library `lastUpscaleConfig`) |
| `migrate-remove-dataset-lora-folder.ts` (`npm run migrate:remove-dataset-lora-folder`) | Strip obsolete per-dataset `comfyLoraSubfolder` (staging folder is Settings → Val. LoRA only) |
| `migrate-diversify-seed-default.ts` (`npm run migrate:diversify-seed-default`) | Set Diversify last-used `seed` to `0` (random) for Context + Expression |
| `migrate-dataset-trained.ts` (`npm run migrate:dataset-trained`) | Set sticky `trained: true` on datasets that have a `complete` job (or are already `validated`) |
| `migrate-spawned-from-images.ts` (`npm run migrate:spawned-from-images`) | Move Create-New-Dataset source flags from `{file}.spawned` markers into `dataset.json` → `spawnedFromImages`, then delete the markers |
| `migrate-originals-to-ads.ts` (`npm run migrate:originals-to-ads`) | `{file}.original` → ADS `VER_1` + restore pristine `$DATA` (D27). App also runs this on ready only when **NTFS versions** is enabled; script is manual / `--dry-run` (touches image bytes — intentional exception) |

Path constants: `src/shared/library-paths.ts` (`LIBRARY_CATEGORIES_FILE`, `JOBS_DIR`, workflow filenames, etc.).
