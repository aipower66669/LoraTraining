# Development Guide

Implementation lives under `src/`. **Documentation hub:** [`README.md`](README.md) in this folder. Product entry points: [`../README.md`](../README.md) and [`USER_GUIDE.md`](USER_GUIDE.md).

## Toolchain

- Node.js 20 LTS, npm 10+
- Windows 10/11 (primary)
- Electron + electron-vite
- React + TypeScript (strict, including `noUncheckedIndexedAccess`)
- Zustand, Zod, Vitest, ESLint (0 warnings), Prettier

## Version

Current release line: **0.4.x** (`package.json` → `version`, currently **0.4.0**). `npm run dist` auto-bumps the **patch** and wipes `release/` before the installer. `npm run dist:nobump` builds that installer without changing the version. For a new minor/major, set the version in `package.json`, update [`../CHANGELOG.md`](../CHANGELOG.md) + [`../RELEASE_NOTES.md`](../RELEASE_NOTES.md) + `docs/RELEASE_NOTES_vX.Y.Z.md`, then `npm run dist:nobump`.

See also [`BUILD.md`](BUILD.md) for installer and tag workflow.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Electron + renderer HMR |
| `npm run typecheck` | Strict TS for main/preload and renderer |
| `npm run lint` | ESLint, max-warnings 0 |
| `npm run test` | Vitest unit + integration |
| `npm run check` | typecheck + lint + Vitest — run locally; GitHub runs it when a `v*` tag is pushed |
| `npm run build` | Production electron-vite build |
| `npm run build:win` | Windows NSIS installer (no version bump; keeps existing `release/`) |
| `npm run dist:nobump` | Clear `release/` → build installer at the current version |
| `npm run dist` | Bump patch → clear `release/` → build installer |
| `npm run prepare-dist` | Bump patch + clear `release/` (`--no-bump` / `SKIP_VERSION_BUMP=1` skip the bump; `SKIP_RELEASE_CLEAN=1` skips the clear) |
| `npm run migrate:*` | Library schema migrations — see [`../scripts/README-migrations.md`](../scripts/README-migrations.md) |

## Path aliases

`@shared`, `@main`, `@renderer` — keep `tsconfig` and vite config in sync.

## Layout

| Path | Role |
| --- | --- |
| `src/main/` | Electron main: IPC, stores, queue, Comfy, tools |
| `src/preload/` | Typed `window.loraTraining` bridge |
| `src/renderer/` | React UI |
| `src/shared/` | Schemas, pure helpers, IPC contract types |
| `comfyui-lora-training/` | Comfy custom nodes for validation inject |
| `reference/` | Sample training YAML |

## Reading order for implementers

1. [`../README.md`](../README.md) — current scope  
2. [`USER_GUIDE.md`](USER_GUIDE.md) — product behavior  
3. [`DECISIONS.md`](DECISIONS.md) — locked defaults  
4. [`ARCHITECTURE.md`](ARCHITECTURE.md) — process boundaries  
5. Domain docs as needed (Dataset, Training Config, Job Queue, External Tools, Project Format)

Older planning docs (`IMPLEMENTATION_PLAN.md`, early UI/IPC sketches) may describe pre-v0.1 intent; prefer code + USER_GUIDE when they conflict.

## Testing expectations

| Area | What to test |
| --- | --- |
| Caption transforms | Pure functions: prefix/suffix/replace/ensure/strip trigger |
| Path guards | Writes outside dataset folder rejected |
| Queue ETA | Step resolution, live vs 7s vs blended rates, formatting |
| Category discovery | Folder name filters, immediate-child checks, path keys |
| YAML round-trip | Fixture with **numeric** `steps` and resolved paths |
| Metrics parser | Sample toolkit / tqdm log lines |

## Release checklist

**Patch / daily installer** (in-app Check for update):

1. `npm run check` (optional but recommended)  
2. `npm run dist` — bumps patch (`0.4.N` → `0.4.N+1`), deletes old `release/*`, builds `LoraTraining Setup 0.4.N+1.exe`  
3. Smoke-test the new installer (or Install update from Settings)

**Minor / major milestone** (docs + tag):

1. Set `package.json` version to the new `X.Y.0` (or let `dist` only handle patches after that)  
2. Update `CHANGELOG.md` + `RELEASE_NOTES.md` + `docs/RELEASE_NOTES_vX.Y.Z.md`  
3. `npm run check`  
4. `npm run dist:nobump` if the version is already correct, else `npm run dist`  
5. Tag anything that starts with `v` (for example `v0.4`) on a commit that contains `.github/workflows/release.yml`, and push that tag; CI attaches the Setup exe + `SHA256SUMS.txt`

## License

**GPL-3.0-only** — see [../LICENSE](../LICENSE) and [../LICENSING.md](../LICENSING.md).
