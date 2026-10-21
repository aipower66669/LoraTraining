# LoraTraining v0.3.0 — release notes

**Date:** 2026-09-02  
**Tag:** `v0.3.0` (package **0.3.0**)  
**Previous product baseline:** [v0.2.0](CHANGELOG.md#020--2026-08-08)  
**Licence:** [GPL-3.0-only](LICENSE) (was MIT before this release)

Third product release (**v0.3.0**): scale and reliability for large libraries and overnight Windows training — performance across discovery, enqueue, and checkpoint UI; honest queue/job status; and a safetensors workaround for Windows OSError 1455.

Full detail: [CHANGELOG.md](CHANGELOG.md). User guide: [docs/USER_GUIDE.md](docs/USER_GUIDE.md). Windows training: [docs/WINDOWS_TRAINING.md](docs/WINDOWS_TRAINING.md).

---

## Highlights

### Performance at library scale

- **Library load progress** — status bar and explorer show sync phase and counts while categories/datasets discover
- **Fast discovery** — sidecar `dataset.json` makes folders discoverable without scanning every image; no recursion into existing datasets
- **Shallow checkpoint scans** — Output tab lists `.safetensors` without deep Training-tree walks; cached validation preview paths
- **Enqueue many** — batch IPC, fast caption preflight (`readdir` only), background validated sync
- **Jobs ↔ queue sync** — enqueued jobs show **queued** immediately; refresh races fixed in jobs cache

### Windows overnight training

- **`train_bootstrap.py`** prepends before AI Toolkit — patches safetensors to prefer `pread` / streaming reads (avoids mmap commit charge)
- **Abort on OSError 1455** — no heavier fallback that makes system commit worse
- Memory/commit snapshot logged once at job start
- Quiet shim logging (once per load path, not every step)

See [docs/WINDOWS_TRAINING.md](docs/WINDOWS_TRAINING.md).

### Validation & further training

- Default validation set **seed = 0**; new sets bump seed only when previous seed **> 0**
- **Pending** checkpoint rows in Output when an open job plans steps beyond on-disk checkpoints
- **Validated** demotes when further training is queued (not only when new previews are missing)

### Polish

- App icon — transparent corners (no white taskbar fringes)
- MyFileExplorer-compatible NTFS ADS image versions (D27), now optional and off by default — JoyCaption/training commit existing tips before run
- Global training model in Settings (D26) — one checkpoint/VRAM policy for all jobs
- Capability-gated UI hides unavailable JoyCaption, AI Toolkit, and ComfyUI work areas while preserving manual dataset/caption work

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
# → release/LoraTraining Setup 0.3.0.exe
```

Requirements: Windows 10/11. AI Toolkit is required for training; JoyCaption is optional for automatic captions; ComfyUI is optional for validation and image tools.

---

## Upgrade from v0.2.x

1. Install over the previous build (or Settings → Check for update from your `release/` folder).
2. Library layout is compatible — no migration required for v0.3.0 specifically.
3. First launch after upgrade picks up the safetensors bootstrap automatically for new training runs.
4. If Windows commit was exhausted before upgrade, **reboot or kill leftover python.exe** once — the shim cannot fix an already-starved session.

Image folders on disk are untouched unless you delete images or use **Delete dataset…**.

---

## Licence change

v0.3.0 is released under **GPL-3.0-only**. See [LICENSING.md](LICENSING.md) and [CONTRIBUTING.md](CONTRIBUTING.md). The **LoraTraining** name and logo remain trademarks — [TRADEMARK.md](TRADEMARK.md).

---

## Known limitations

- Windows-first; no macOS/Linux support matrix
- One training process at a time
- Pause/resume depends on AI Toolkit checkpoints
- Very large bases still need enough free **commit charge** — see Windows training doc
- Comfy previews need saved workflows and a reachable ComfyUI

---

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Advantages](docs/ADVANTAGES.md)
- [Build & releases](docs/BUILD.md)
- [Changelog](CHANGELOG.md)
- Prior: [v0.2.0](docs/RELEASE_NOTES_v0.2.0.md) · [v0.1.0](docs/RELEASE_NOTES_v0.1.0.md)
