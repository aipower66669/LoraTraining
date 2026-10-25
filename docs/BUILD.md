# Building & releases

Windows NSIS installers (`LoraTraining Setup X.Y.Z.exe`) are typically **large** (Electron + native deps). Do not commit them to git — `release/` is for local output only.

**Primary target:** Windows 10/11. Non-Windows packaging is out of scope.

---

## Local development

```bash
npm ci
npm run dev          # Electron + renderer HMR
npm run check        # typecheck + lint + Vitest (local). GitHub runs this only inside the tag release workflow
```

Settings pointer lives in `%APPDATA%\lora-training\` for both dev and installed builds.

---

## Production build

```bash
npm run build        # electron-vite → out/
npm run build:win    # + electron-builder NSIS → release/ (no version bump, keeps existing release/)
```

### Installer at the current version

```bash
npm run dist:nobump
```

Clears `release/`, then builds `release/LoraTraining Setup X.Y.Z.exe` from the version already in `package.json` (0.5.0 for this release). After the installer is written, the build copies `resources/release-README.md` to `release/README.md`. That file is the note to put next to the Setup exe, `comfyui-lora-training.zip`, and `comfyui-custom-save-node.zip` when uploading to a file host. A tag build writes both zips into the GitHub Release. Zip the `comfyui-lora-training` folder itself, so unzipping yields `comfyui-lora-training\__init__.py`.

### Next patch installer

```bash
npm run dist
```

Bumps the patch (`0.5.0` → `0.5.1`), clears `release/`, then builds the NSIS installer.

| Variable | Effect |
| --- | --- |
| `SKIP_VERSION_BUMP=1` | On `npm run dist` only: do not increment patch (`dist:nobump` never bumps) |
| `SKIP_RELEASE_CLEAN=1` | Do not delete existing `release/*` |

To set `package.json` and `package-lock.json` from a tag by hand: `npx tsx scripts/sync-version-from-tag.ts v0.5.0`. That script accepts `vX.Y.Z` only. The release workflow does not run it and does not compare the tag to `package.json`. The installer name comes from `package.json`.

---

## In-app updates

After the first install:

1. Settings → **App updates**. Leave **Release folder** empty to use GitHub Releases. Set it (for example repo `release/`) to install from local Setup exes instead.
2. **Check for update** — compares the newest `LoraTraining Setup *.exe` with the running version. **What's new** renders the release notes when a newer version is found.
3. **Install update** — quits the app and launches the NSIS installer. A GitHub check downloads the exe first.

`npm run dist` and `npm run dist:nobump` both clear `release/` before building, then write one Setup exe and `README.md`. `dist` is the command that also bumps the patch, which is what makes a folder check see a newer version than the installed app. An empty Release folder does not use that folder; it uses the GitHub release.

---

## GitHub Actions

| Workflow | Trigger | What runs |
| --- | --- | --- |
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | Push any tag that starts with `v` (`v0.5`, `v0.5.0`) | Check, then the Windows installer, then the GitHub Release |

A branch push and a pull request do not start a build. `workflow_dispatch` runs the check only. The installer is attached only for a tag push. The tag filter is `v*`, the same pattern Wildcards Manager uses. `v0.5` matches. The installer filename still comes from `package.json` (`LoraTraining Setup 0.5.0.exe`).

CI does **not** require repository secrets. The release workflow uses the built-in `GITHUB_TOKEN` to attach these files:

- `LoraTraining Setup X.Y.Z.exe`
- `README.md` (from `resources/release-README.md`)
- `comfyui-lora-training.zip` (the `comfyui-lora-training` folder, without `__pycache__`)
- `comfyui-custom-save-node.zip` (from `resources/comfyui-custom-save-node.zip`, without `__pycache__`)
- `SHA256SUMS.txt` covering those four files

The release body is [RELEASE_NOTES.md](../RELEASE_NOTES.md). Workflow actions are **pinned to commit SHAs**. `electron-builder` uses `--publish never` / `"publish": null`, so only `softprops/action-gh-release` publishes.

### Ship a tagged release

1. Set `package.json` to the target version (`0.5.0` for this release).
2. `npm run check` locally.
3. Tag and push. The tag must start with `v`. `v0.5` and `v0.5.0` both start the workflow. The workflow file on that commit is the one GitHub runs, so the tag has to point at a commit that already contains this `v*` filter.

```bash
git tag v0.5
git push origin v0.5
```

GitHub Actions runs check, builds with `npm run build:win` (no version rewrite), writes the two node zips and `release/SHA256SUMS.txt`, and publishes the Release.

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
Get-FileHash -Algorithm SHA256 ".\LoraTraining Setup 0.5.0.exe"
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
5. `npm run dist:nobump` when the version is already correct, or `npm run dist` to bump the patch and build
6. Smoke-test installer
7. Tag `vX.Y.Z` (three-part, matching `package.json`) and push. GitHub Actions attaches the Setup exe and `SHA256SUMS.txt`

See also [DEVELOPMENT.md](DEVELOPMENT.md).

