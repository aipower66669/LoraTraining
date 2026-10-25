# Release notes — LoraTraining v0.5.0

**Release date:** 25 October 2026  
**Channel:** Public release (`0.5.0`) — **PolyForm Noncommercial 1.0.0**  
**Previous:** [v0.4.0](RELEASE_NOTES_v0.4.0.md)

---

## Summary

LoraTraining **v0.5.0** keeps the v0.4.0 library, training, and Comfy behaviour and changes image editing:

- A text annotation keeps the rectangle you drag. It has the same move and resize handles as a rectangle. Double-click the text to type. Letters, including **E**, go into the box. Escape leaves the text and brings the handles back. A second Escape closes the editor. **Ctrl+S** still saves.
- **Undo last** drops only the newest NTFS version. **Edit image** shows **Undo last** in the top bar when a stack exists, and it can be repeated. The image menu has **Undo last edit**. **Revert to original** still deletes every version and leaves the original file.
- **Edit in Photoshop** asks only when **NTFS versions** is on and that image has saved versions. **Edit original** opens the pristine file and leaves the stack. **Commit latest edit** writes only the newest version into the file, removes the history, then opens Photoshop. Cancel does neither. Otherwise Photoshop opens the file directly.
- Saving an edit of a `.jfif` writes a JPEG. The editor can read JFIF and cannot write that type back.

Training and Comfy previews stay **Krea 2 only**. The app is provided **AS-IS**, with no direct support.

---

## Install and build

Artifacts: `release/LoraTraining Setup 0.5.0.exe` plus `SHA256SUMS.txt` on the GitHub Release. A tag that starts with `v` (`v0.5` or `v0.5.0`) runs the check and attaches that installer. The filename comes from `package.json`. A branch push does not publish an installer.

| Command | Version | `release\` |
| --- | --- | --- |
| `npm run check` | unchanged | not built — typecheck, lint, Vitest |
| `npm run dist:nobump` | unchanged | cleared, then current Setup exe |
| `npm run dist` | patch +1 (`0.5.0` → `0.5.1`) | cleared, then the new Setup exe |

The installer is unsigned. SmartScreen may warn; **More info → Run anyway** if you trust the release. Compare SHA-256 to `SHA256SUMS.txt` first.

---

## Upgrade from v0.4.x

1. Install over the previous build, or leave **Release folder** empty and use **Check for update** against GitHub. A local folder that contains `LoraTraining Setup 0.5.0.exe` still works.
2. No library migration is required for 0.5.0. Settings and jobs stay under the library root.
3. **NTFS versions** stays off unless you turn it on. With it off, Save overwrites the image and Photoshop opens the file without asking.

Image folders on disk are untouched unless you delete images or use **Delete dataset…**.

---

## Known limitations

- Windows 10/11 is the supported platform
- One training process at a time
- Pause/resume depends on AI Toolkit checkpoints
- Very large bases still need enough free commit charge — see [WINDOWS_TRAINING.md](WINDOWS_TRAINING.md)
- Comfy previews need saved workflows and a reachable ComfyUI
- Training and Comfy previews are **Krea 2 only**
