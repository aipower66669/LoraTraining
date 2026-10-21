# Building & releases

Windows NSIS installers (`LoraTraining Setup X.Y.Z.exe`) are typically **large** (Electron + native deps). Do not commit them to git — `release/` is for local output only.

**Primary target:** Windows 10/11. Non-Windows packaging is out of scope.

---

## Local development

```bash
npm ci
npm run dev          # Electron + renderer HMR
npm run check        # typecheck + lint + test — same as GitHub Actions
```

Settings pointer lives in `%APPDATA%\lora-training\` for both dev and installed builds.

---

## Production build

```bash
npm run build        # electron-vite → out/
npm run build:win    # + electron-builder NSIS → release/ (no version bump)
```

### Daily / patch installer

```bash
npm run dist
```

This runs `prepare-dist` (patch bump + wipe `release/`), then build + NSIS.
Output: `release/LoraTraining Setup X.Y.Z.exe`.

Skip steps when needed:

| Variable | Effect |
| --- | --- |
| `SKIP_VERSION_BUMP=1` | Do not increment patch in `package.json` |
| `SKIP_RELEASE_CLEAN=1` | Do not delete existing `release/*` |

Example — version already set to 0.3.0:

```bash
SKIP_VERSION_BUMP=1 npm run dist
```

---

## In-app updates

After the first install:

1. Settings → **App updates** → set **Release folder** (e.g. repo `release/`)
2. **Check for update** — scans for `LoraTraining Setup *.exe` with a higher semver
3. **Install update** — quits the app and launches the NSIS installer

Each `npm run dist` should leave only the newest Setup exe in `release/` so Check for update sees a single newer build.

---

## GitHub Actions

| Workflow | Trigger | What runs |
| --- | --- | --- |
| [`.github/workflows/check.yml`](../.github/workflows/check.yml) | Push / PR to `main` | `npm run check` on `windows-latest` |
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | Push tag `vX.Y.Z` | `npm run check` → Windows NSIS build → GitHub Release + `SHA256SUMS.txt` |

CI does **not** require repository secrets. The release workflow uses the built-in `GITHUB_TOKEN` to attach `LoraTraining Setup X.Y.Z.exe` and a SHA-256 checksum file to the release for the tag. Workflow actions are **pinned to commit SHAs**.

### Ship a tagged release

1. Set `package.json` to the target version (or let CI sync from the tag).
2. `npm run check` locally.
3. Tag and push (**full three-part tag only**):

```bash
git tag v0.3.0
git push origin v0.3.0
```

Do **not** use short tags like `v0.3` — they are rejected so the tag always matches the installer version (`0.3.0`).

GitHub Actions runs check, builds the installer (`SKIP_VERSION_BUMP=1 npm run dist`), writes `release/SHA256SUMS.txt`, and publishes a Release with the Setup exe + checksums. `electron-builder` is configured with `--publish never` / `"publish": null` so it **never** tries to upload via `GH_TOKEN` — only the workflow’s `softprops/action-gh-release` step publishes, using the built-in `GITHUB_TOKEN`.

Invalid tags (e.g. `v0.3`, `v1`, `v1.2.3.4`, `vbeta`) fail in the version-sync step — only `vX.Y.Z` is accepted.

---

## Troubleshooting builds

### `EBUSY` / locked `app.asar`

Close any LoraTraining window launched from `release/win-unpacked` (or delete that folder) before rebuilding.

### Unsigned installer & SmartScreen

`electron-builder` is configured with `signExecutable: false`. **Code signing is a release goal** but not available yet.

On first run, Windows may show **“Windows protected your PC”** (SmartScreen) or similar Defender prompts. That is **expected** for unsigned builds:

1. Click **More info**.
2. Click **Run anyway** only if you downloaded the file from [this project’s GitHub Releases](https://github.com/aipower66669/LoraTraining/releases).

Before installing, verify the SHA-256 of the Setup exe against `SHA256SUMS.txt` on the same release (also attached by CI). Example (PowerShell):

```powershell
Get-FileHash -Algorithm SHA256 ".\LoraTraining Setup 0.3.0.exe"
# Compare to the line in SHA256SUMS.txt
```

Local `npm run dist` builds are likewise unsigned — same SmartScreen behavior.

### Icon assets

Source PNGs: `resources/icon.png` (512) and `build/icon.png` (1024). Regenerate `build/icon.ico` after PNG changes. Corners must be **transparent**, not white, for taskbar/title chrome.

---

## Release checklist (minor / major)

1. Set `package.json` to `X.Y.0`
2. Update [CHANGELOG.md](../CHANGELOG.md) and [RELEASE_NOTES.md](../RELEASE_NOTES.md)
3. Add or update `docs/RELEASE_NOTES_vX.Y.Z.md` if detailed notes help
4. `npm run check`
5. `SKIP_VERSION_BUMP=1 npm run dist` (or `npm run dist` for patch-only after 0.3.0)
6. Smoke-test installer
7. Tag `vX.Y.Z` (three-part only) and publish GitHub Release + attach Setup exe + `SHA256SUMS.txt`

See also [DEVELOPMENT.md](DEVELOPMENT.md).

