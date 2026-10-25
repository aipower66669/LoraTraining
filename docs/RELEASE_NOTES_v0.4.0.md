# Release notes — LoraTraining v0.4.0

**Release date:** 21 October 2026  
**Channel:** Public release (`0.4.0`) — **PolyForm Noncommercial 1.0.0**. Later release: [v0.5.0](RELEASE_NOTES_v0.5.0.md).
**Previous:** [v0.3.0](RELEASE_NOTES_v0.3.0.md)

---

## Summary

LoraTraining **v0.4.0** keeps the v0.3.0 library-scale and Windows training work and changes two defaults:

- Image editor and Upscale **NTFS version history** is an advanced opt-in. **Settings → External tools → Library → NTFS versions** defaults **off**. A normal save overwrites the image. A version stack is written only when the option is on and the dataset folder is on NTFS.
- JoyCaption, AI Toolkit, and ComfyUI work areas stay hidden until the required Settings path is non-empty. Settings itself stays available. Manual dataset and caption editing stays available. Filling a path shows the UI; it does not prove the path works — use **Test**.

The app still orchestrates JoyCaption, AI Toolkit, and ComfyUI. It does not replace them. Training and Comfy previews are **Krea 2 only**.

**App updates:** leave **Settings → External tools → App updates → Release folder** empty to check GitHub Releases. **What's new** renders the notes when a newer version is found. A filled folder still installs from local `LoraTraining Setup *.exe` files and reads `RELEASE_NOTES.md` from that folder or the folder above it.

---

## What changed

### NTFS versions (default off)

| | |
| --- | --- |
| Setting | **Settings → External tools → Library → NTFS versions** |
| Default | Off |
| Off | Saves overwrite the current image file |
| On | Editor and Upscale can keep an NTFS alternate-data-stream history, on NTFS dataset folders |

JoyCaption and training still commit an existing tip before they run when versions are enabled. Legacy `{image}.original` sidecars move into NTFS streams on a launch where the option is enabled.

### Capability-gated UI

| Path filled | UI that appears |
| --- | --- |
| JoyCaption **Work dir** | Automatic caption controls, caption queue, dataset Description |
| AI Toolkit **Work dir** | Jobs, Queue, training actions |
| ComfyUI **LoRAs** | Validation, Weight, Stress, Upscale, Diversify, and related image-menu commands |

### Carried forward from v0.3.0

Discovery progress, sidecar-first dataset discovery, shallow checkpoint scans, batch **Enqueue many**, pending checkpoint rows, and the Windows `train_bootstrap.py` safetensors workaround (OSError 1455). Detail: [RELEASE_NOTES_v0.3.0.md](RELEASE_NOTES_v0.3.0.md) and [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md).

---

## Install and build

Artifacts: `release/LoraTraining Setup 0.4.0.exe` plus `SHA256SUMS.txt` on the GitHub Release for tag `v0.4.0`.

| Command | Version | `release\` |
| --- | --- | --- |
| `npm run check` | unchanged | not built — typecheck, lint, Vitest (same as the push/PR workflow) |
| `npm run dist:nobump` | unchanged | cleared, then current Setup exe |
| `npm run dist` | patch +1 | cleared, then the new Setup exe |

This release was published as tag `v0.4.0` with installer `LoraTraining Setup 0.4.0.exe`. Current tag rules are in [BUILD.md](BUILD.md) and [v0.5.0](RELEASE_NOTES_v0.5.0.md): any tag that starts with `v` builds the installer named from `package.json`. A branch push does not publish an installer.

The installer is unsigned. SmartScreen may warn; **More info → Run anyway** if you trust the release. Compare SHA-256 to `SHA256SUMS.txt` first.

---

## Upgrade from v0.3.x

1. Install over the previous build, or leave **Release folder** empty and use **Check for update** against GitHub. A local folder that contains `LoraTraining Setup 0.4.0.exe` still works.
2. No library migration is required for 0.4.0. Settings and jobs stay under the library root.
3. Turn **NTFS versions** on to keep editor/upscale history. Leave it off to overwrite images on save.
4. Set JoyCaption Work dir, AI Toolkit Work dir, and ComfyUI LoRAs to restore those work areas.

Image folders on disk are untouched unless you delete images or use **Delete dataset…**.

---

## Known limitations

- Windows 10/11 is the supported platform
- One training process at a time
- Pause/resume depends on AI Toolkit checkpoints
- Large training runs still need free Windows commit charge
- Comfy previews need a reachable ComfyUI and a saved workflow
- Krea 2 only for training defaults and Comfy preview workflows
