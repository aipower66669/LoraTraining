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

Clears `release/`, then builds `release/LoraTraining Setup X.Y.Z.exe` from the version already in `package.json` (0.4.0 for this release).

### Next patch installer

```bash
npm run dist
```

Bumps the patch (`0.4.0` → `0.4.1`), clears `release/`, then builds the NSIS installer.

| Variable | Effect |
| --- | --- |
| `SKIP_VERSION_BUMP=1` | On `npm run dist` only: do not increment patch (`dist:nobump` never bumps) |
| `SKIP_RELEASE_CLEAN=1` | Do not delete existing `release/*` |

To set `package.json` and `package-lock.json` from a tag by hand: `npx tsx scripts/sync-version-from-tag.ts v0.4.0`. The release workflow does not do this; it requires the tag to already match `package.json`.

---

## In-app updates

After the first install:

1. Settings → **App updates**. Leave **Release folder** empty to use GitHub Releases. Set it (for example repo `release/`) to install from local Setup exes instead.
2. **Check for update** — compares the newest `LoraTraining Setup *.exe` with the running version. **What's new** renders the release notes when a newer version is found.
3. **Install update** — quits the app and launches the NSIS installer. A GitHub check downloads the exe first.

`npm run dist` and `npm run dist:nobump` both clear `release/` before building, so that folder holds one Setup exe. `dist` is the command that also bumps the patch, which is what makes a folder check see a newer version than the installed app. An empty Release folder does not use that folder; it uses the GitHub release.

---

## GitHub Actions

| Workflow | Trigger | What runs |
| --- | --- | --- |
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | Push tag `vX.Y.Z` only | One job: `npm run check`, then `npm run dist:nobump`, then GitHub Release + `SHA256SUMS.txt` |

A branch push and a pull request do not start a workflow. There is no manual `workflow_dispatch` build. Pushing `v0.4.0` (the tag that matches `package.json`) is the only Action.

CI does **not** require repository secrets. The release workflow uses the built-in `GITHUB_TOKEN` to attach `LoraTraining Setup X.Y.Z.exe` and a SHA-256 checksum file. The release body is [RELEASE_NOTES.md](../RELEASE_NOTES.md). Workflow actions are **pinned to commit SHAs**. `electron-builder` uses `--publish never` / `"publish": null`, so only `softprops/action-gh-release` publishes.

### Ship a tagged release

1. Set `package.json` to the target version (`0.4.0` for this release).
2. `npm run check` locally.
3. Tag and push (**full three-part tag, equal to `v` + `package.json` version**):

```bash
git tag v0.4.0
git push origin v0.4.0
```

Short tags such as `v0.4` do not match the workflow filter `v*.*.*` and do not build. The workflow also fails the release job when the tag string is not exactly `v` plus the committed version, so the installer name stays aligned with the tag.

GitHub Actions runs check, builds with `npm run dist:nobump` (no version rewrite), writes `release/SHA256SUMS.txt`, and publishes the Release.

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
Get-FileHash -Algorithm SHA256 ".\LoraTraining Setup 0.4.0.exe"
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

