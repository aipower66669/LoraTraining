# LoraTraining v0.5.0 — release notes

**Date:** 2026-10-25  
**Tag:** `v0.5` (package **0.5.0**)  
**Previous:** [v0.4.0](docs/RELEASE_NOTES_v0.4.0.md)  
**Licence:** [PolyForm Noncommercial 1.0.0](LICENSE.md)

Fifth product release (**v0.5.0**): image-editor text annotations keep the dragged box and can be typed in, NTFS history can drop only the last version, and Photoshop asks before it opens an image that still has a version stack. Library-scale performance and the v0.4.0 defaults are included.

Full detail: [CHANGELOG.md](CHANGELOG.md) · [docs/RELEASE_NOTES_v0.5.0.md](docs/RELEASE_NOTES_v0.5.0.md).

---

## Highlights

- **Text annotations** — the box you drag stays that size, with the same move and resize handles as a rectangle. Double-click to type. Escape restores the handles.
- **Undo last** — drops only the newest NTFS version. The editor top bar and the image menu both have it. **Revert to original** still clears the whole stack.
- **Edit in Photoshop** — when NTFS versions is on and the image has a stack, choose **Edit original** or **Commit latest edit**. Cancel does neither. Otherwise Photoshop opens the file directly.
- **JFIF saves** — an edited `.jfif` is written as a JPEG.
- **v0.4.0 defaults** — NTFS versions off unless you turn them on, and JoyCaption, AI Toolkit, and ComfyUI work areas stay hidden until their Settings paths are filled. See [v0.4.0 notes](docs/RELEASE_NOTES_v0.4.0.md).

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
# → release/LoraTraining Setup 0.5.0.exe
```

**Next patch build** (`0.5.0` → `0.5.1`, then the installer):

```bash
npm run dist
```

Requirements: Windows 10/11. AI Toolkit is required for training; JoyCaption is optional for automatic captions; ComfyUI is optional for validation and image tools.

The Windows NSIS installer is **unsigned**. SmartScreen may show **Windows protected your PC** — choose **More info → Run anyway** if you trust this release. Verify the download against `SHA256SUMS.txt` on the GitHub Release before installing.

---

## Upgrade from v0.4.x

1. Install over the previous build, or use Settings → Check for update from GitHub or from a folder that contains the new Setup exe.
2. Library layout is compatible — no migration is required for v0.5.0.
3. Turn **NTFS versions** on if you want editor/upscale version stacks and **Undo last**. With the option off, saves overwrite the image.

Image folders on disk stay in place unless you delete images or use **Delete dataset…**.

---

## Known limitations

- Windows-first; no macOS/Linux support matrix
- One training process at a time
- Pause/resume depends on AI Toolkit checkpoints
- Very large bases still need enough free commit charge — see [docs/WINDOWS_TRAINING.md](docs/WINDOWS_TRAINING.md)
- Comfy previews need saved workflows and a reachable ComfyUI
- Training and Comfy previews are **Krea 2 only**
