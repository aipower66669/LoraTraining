# Release notes — LoraTraining v0.3.0

**Release date:** 2 September 2026  
**Channel:** Public release (`0.3.0`) — **GPL-3.0-only**

---

## Summary

LoraTraining **v0.3.0** is the first **public** release line: same full LoRA control panel as v0.2, plus the performance and Windows reliability work needed for large libraries and daily overnight training without constant reboots.

The app still orchestrates JoyCaption, AI Toolkit, and ComfyUI — it does not replace them.

---

## Highlights

### Built for 200+ datasets

Library discovery shows live progress instead of a silent “Loading…” spinner. Folder-backed categories sync in parallel. Datasets with a sidecar are discoverable without scanning every image file. Output and validation preview paths use shallow scans and cached prefs so switching checkpoints stays responsive.

### Enqueue at scale

Select many failed or draft jobs → **Enqueue** once. Caption preflight uses a fast directory read instead of statting every image. The Jobs list and Queue stay aligned — status shows **queued**, not stale **failed**.

### Windows Krea / Flux loading

Training spawns through `train_bootstrap.py`, which forces safetensors away from mmap on Windows (OSError 1455 / commit charge). If commit is already exhausted, the shim aborts cleanly instead of retrying heavier paths that can break unrelated apps.

Guide: [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md).

### Further-training clarity

Raise job steps past existing checkpoints → Output shows **Pending** rows; **Validated** demotes until the new plan is reflected on disk and in previews. Validation set seeds default to **0**; adding a set increments only when the previous seed was already non-zero.

### Licence & docs

Repository is **GPL-3.0-only** with first-class docs matching the public release: [README](../README.md), [ADVANTAGES](ADVANTAGES.md), [BUILD](BUILD.md), [CONTRIBUTING](../CONTRIBUTING.md).

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
git clone https://github.com/aipower66669/LoraTraining.git
cd LoraTraining
npm install
npm run dev
```

**Installer**

```bash
npm run dist
```

Artifacts: `release/LoraTraining Setup 0.3.0.exe`.

**In-app update** — Settings → App updates → Release folder → Check → Install.

---

## Upgrade from v0.2.x

1. Install over the previous build.
2. No new library migration for 0.3.0 — settings and jobs remain under your library root.
3. New training runs use the safetensors bootstrap automatically.
4. Reboot once if you were hitting daily OSError 1455 before upgrading — stale commit is a session problem, not fixed by the installer alone.

---

## Known limitations

- Non-Windows packaging out of scope
- One training job at a time
- Pause/resume = kill + respawn (toolkit checkpoints)
- Queue ETA remains estimate (~7 s/step and/or live rate)
- Comfy + training share VRAM if run together

---

## Documentation

- [User guide](USER_GUIDE.md)
- [Changelog](../CHANGELOG.md)
- [Release summary](../RELEASE_NOTES.md)
- [Development](DEVELOPMENT.md)
- Prior: [v0.2.0](RELEASE_NOTES_v0.2.0.md) · [v0.1.0](RELEASE_NOTES_v0.1.0.md)

---

## Thank you

v0.3.0 opens the repo for public use and contribution under GPLv3. Report issues on GitHub — especially Windows training reliability and library-scale performance.
