# LoraTraining v0.4.0 — release notes

**Date:** 2026-10-21  
**Tag:** `v0.4.0` (package **0.4.0**)  
**Previous:** [v0.3.0](docs/RELEASE_NOTES_v0.3.0.md)  
**Licence:** [GPL-3.0-only](LICENSE)

Fourth product release (**v0.4.0**): image version history is an opt-in, and JoyCaption, AI Toolkit, and ComfyUI work areas stay hidden until their Settings paths are filled. Library-scale performance and the Windows safetensors workaround from v0.3.0 are included.

Full detail: [CHANGELOG.md](CHANGELOG.md) · [docs/RELEASE_NOTES_v0.4.0.md](docs/RELEASE_NOTES_v0.4.0.md).

---

## Highlights

- **NTFS versions** — **Settings → External tools → Library → NTFS versions** defaults off. Saves overwrite the image. Version stacks need the option on and an NTFS dataset folder.
- **Capability-gated UI** — automatic captions, Jobs/Queue, and Comfy preview tools appear after their required path is set. Manual dataset and caption work stays available. Settings stays available so those paths can be filled.
- **App updates** — leave Release folder empty to check GitHub Releases. **What's new** shows the release notes when a newer version is found. A local folder still installs from Setup exes you built yourself.
- **v0.3.0 scale and overnight training** — discovery progress, shallow checkpoint scans, batch enqueue, and the safetensors bootstrap for Windows OSError 1455. See [v0.3.0 notes](docs/RELEASE_NOTES_v0.3.0.md).

---

## Install

**From source**

```bash
git clone https://github.com/aipower66669/LoraTraining.git
cd LoraTraining
npm install
npm run dev
```

**Installer (current version, no bump)**

```bash
npm run dist:nobump
# → release/LoraTraining Setup 0.4.0.exe
```

**Next patch build** (`0.4.0` → `0.4.1`, then the installer):

```bash
npm run dist
```

Requirements: Windows 10/11. AI Toolkit is required for training; JoyCaption is optional for automatic captions; ComfyUI is optional for validation and image tools.

The Windows NSIS installer is **unsigned**. SmartScreen may show **Windows protected your PC** — choose **More info → Run anyway** if you trust this release. Verify the download against `SHA256SUMS.txt` on the GitHub Release before installing.

---

## Upgrade from v0.3.x

1. Install over the previous build, or use Settings → Check for update from a folder that contains the new Setup exe.
2. Library layout is compatible — no migration is required for v0.4.0.
3. Turn **NTFS versions** on if you want editor/upscale version stacks. With the option off, saves overwrite the image.
4. Fill JoyCaption Work dir, AI Toolkit Work dir, and ComfyUI LoRAs to show those work areas.

Image folders on disk stay in place unless you delete images or use **Delete dataset…**.

---

## Known limitations

- Windows-first; no macOS/Linux support matrix
- One training process at a time
- Pause/resume depends on AI Toolkit checkpoints
- Very large bases still need enough free commit charge — see [docs/WINDOWS_TRAINING.md](docs/WINDOWS_TRAINING.md)
- Comfy previews need saved workflows and a reachable ComfyUI
- Training and Comfy previews are **Krea 2 only**
