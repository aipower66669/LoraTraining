# Release notes — LoraTraining v0.2.0

**Release date:** 8 August 2026  
**Channel:** Full-featured production milestone (`0.2.0`) — superseded by [v0.3.0](RELEASE_NOTES_v0.3.0.md)

---

## Summary

LoraTraining **v0.2.0** is the complete Windows desktop control panel for LoRA work: dataset hygiene, JoyCaption, AI Toolkit training queues, ComfyUI preview tools (Steps / Weight / Stress / Upscale / Diversify), in-app image editing, and local installer updates. The feature set is intended for daily training use; remaining work is polish and bugfixes, not new product pillars.

The app still orchestrates your existing tools — it does not replace JoyCaption, AI Toolkit, or ComfyUI.

---

## Highlights

### Library is the workspace
Settings, captured Comfy workflows, jobs, thumbs, and catalogs live under your **library root**. AppData only stores the pointer and window geometry. Back up the library folder and you can restore the workspace.

### Overnight queues you can trust
Failed jobs no longer auto-start the rest of the FIFO. Successful jobs wait a short GPU cooldown before the next spawn. While training, the app holds a wake lock and raises the toolkit process priority so Windows is less likely to throttle an unfocused window.

### Full Comfy preview suite
Validation Steps, Weight sweeps, Stress (+ Compare), Upscale, and Diversify (Context / Expression / Face) with per-tool workflow isolation and library-side backups on save.

### Edit and prepare images in-app
Built-in image editor, scraper import, bulk caption/convert/shrink tools, and Photoshop hand-off when you still want an external app.

### Update from inside the app
Point Settings → **App updates** at your `release/` folder (or any folder of `LoraTraining Setup *.exe` builds). **Check for update** → **Install update** quits the app and runs the NSIS installer; tick **Run** on the finish page.

### Jobs at scale
Multi-select jobs for shared training-field edits, enqueue many at once, and control the queue from the global drawer without staying on the Queue screen.

---

## Requirements

| Requirement | Notes |
| --- | --- |
| Windows 10/11 | Primary supported OS |
| Node 20+ (from source) | For `npm run dev` / build |
| JoyCaption (optional) | Automated captions |
| AI Toolkit (optional) | Training |
| ComfyUI + LT nodes (optional) | Preview / validate tools |

---

## Install

**From source**

```bash
npm install
npm run dev
```

**Installer**

```bash
npm run dist         # preferred: bumps patch, clears release/, builds installer
# or: npm run build:win   # same version, does not wipe release/
```

Artifacts land in `release/` (e.g. `LoraTraining Setup 0.2.0.exe`). Each `dist` leaves only the newest Setup exe in that folder.

**In-app update (after first install)**  
Settings → App updates → set Release folder → Check → Install.

---

## Upgrade from v0.1.x

1. Install or run **Install update** over the previous build.
2. On first launch, library settings migration runs if you still have a legacy AppData `settings.json` / workflow — confirm the library root if prompted.
3. Re-check Settings → tools / Comfy paths if anything looks empty (each library owns its `settings.json`).

Image folders on disk are untouched unless you delete images or use **Delete dataset…**.

---

## Known limitations

- Non-Windows packaging is still out of scope.
- Pause/resume kills the training process; resume depends on AI Toolkit checkpoints.
- Preview tools need a saved Comfy workflow and a reachable ComfyUI.
- Queue ETA remains an estimate (~7 s/step and/or blended live rate).
- One training process at a time; Comfy preview tools share VRAM with training if run together.

---

## Documentation

- [User guide](USER_GUIDE.md)
- [Changelog](../CHANGELOG.md)
- [README](../README.md)
- [Development](DEVELOPMENT.md)
- Prior notes: [v0.1.0](RELEASE_NOTES_v0.1.0.md)

---

## Thank you

v0.2.0 is the “this is it” feature line for serious local LoRA production. Report bugs and rough edges — that’s the focus from here.
