# Dataset manager

Datasets are folders of training images (and optional `.txt` captions) registered in the app library. Image bytes stay on disk; metadata lives in each folder’s `dataset.json` under your **library** category tree (see [PROJECT_FORMAT.md](PROJECT_FORMAT.md)).

---

## Lifecycle

| Action | Effect |
| --- | --- |
| Discover / create | Sidecar + optional mkdir under category root |
| Rescan | Re-enumerate images/captions; update stats |
| Update | Name, category, trigger, Description/caption guidance, Ready, caption, cover |
| **Duplicate…** | Sibling folder: copy images/captions/image sidecars; skip `output/`; new id; ready/trained/validated/done cleared |
| Create from image | New dataset folder + one image (and caption/original/upscale siblings); flags source in `spawnedFromImages` |
| Remove from library | Remove catalog metadata only (folderless legacy/fallback category); files stay |
| Delete dataset… | After confirmation, delete the folder recursively (images, captions, `output/`) + sidecar; refused for a category root, running/paused training, or Validation Steps on that dataset. The current guard does not test the other Comfy tools |

Rename may rename the on-disk folder and remap linked jobs when the sanitized folder name changes.

### Duplicate

Library context menu → **Duplicate…**. Default name is `{name} V2` (or next `Vn`). Copies training media only so you can re-caption (and optionally add images) without inheriting checkpoints or validation previews. Keeps trigger, caption guidance, notes, and Steps/Weight/Stress set configs; clears stress/weight checkpoint picks.

---

## Scan rules

- **Non-recursive** listing of `folderPath`.
- Image extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp` (discovery for categories is JPG/JPEG/PNG only).
- Caption pairing by stem + `captionExt` (default `txt`), UTF-8.
- Stem collisions (e.g. `a.jpg` + `a.png`) surface in stats for the UI banner.

## Cover

The library tile shows the first image in filename order (same order as the image grid) until **Set Dataset Cover** stores a file name on the dataset. That saved file is used only while it is still in the folder. If it is missing, the tile uses the first image again. The fallback is not written back as a saved cover. An empty dataset has no cover.

---

## Image grid

- Always virtualized; thumbs via `loratraining-media://` thumb URLs (200×200 center crop cache).
- Double-click opens the full preview overlay; Escape/Enter closes, arrows navigate. With focus in the image grid, **Ctrl+A** selects every image.
- Multi-select (grid order); arrow-key navigation; focus returns after delete.
- Post-delete selection moves to next/prev neighbor (never blindly first).
- Drag selected thumbnails to a different dataset tile to move; Shift+drop copies. Source/target must be idle, paired captions and current tip pixels travel, existing destination names skip.
- A thumbnail badge appears when NTFS `VER_*` versions already exist.

### Optional NTFS versions

**Settings → External tools → Library → NTFS versions** defaults **off**. Off, **Edit image** and Upscale overwrite the image body on save, like Paint or Photoshop. On, and only for datasets on NTFS drives, the app keeps the pristine image plus up to four `VER_*` tips in alternate data streams. That enables **Undo last edit** and **Revert to original**. **Edit image** shows **Undo last** in the top bar when a stack exists; each click drops only the newest version. On another file system it still overwrites.

Disabling the option does not immediately discard an existing stack. The next editor/Upscale save overwrites the main image with the saved result and clears that stack.

### Context menu (image)

| Action | Behavior |
| --- | --- |
| Set Dataset Cover / Reveal in Explorer / Edit in Photoshop… | Cover, reveal, or optional external editor. With **NTFS versions** on and a version stack, Photoshop asks: edit the original, or commit the latest edit into the file first |
| Edit image… | Open editor; **E** does the same from the dataset screen. Inside, a text box has the same move and resize handles as a rectangle. Double-click the text to type; letters including **E** go into the box, Escape brings the handles back, a second Escape closes the editor, and **Ctrl+S** still saves |
| Upscale / Undo last edit / Revert to original | Jump to Upscale or change the ADS `VER_*` stack |
| Diversify Context / Diversify Expression | Jump to that tool |
| Create New Dataset… | Spawn a one-image sibling dataset |
| Move to Recycle Bin / Delete permanently | Context-menu delete labels; shortcuts are Del / Shift+Del |

### Delete shortcuts

| Input | Behavior |
| --- | --- |
| **Del** | `shell.trashItem` image + caption (Recycle Bin) |
| **Shift+Del** | Permanent `unlink` |

Folder watch is muted briefly after programmatic delete so selection is not stomped by a full rescan.

---

## Captions & bulk tools

- Per-image editor with debounced atomic write.
- Details pane: Filename (or selected count), Name, Category, Trigger, Ready, Caption, **Delete image** / **Delete Images**. When JoyCaption Work dir is configured it also shows **Description**, the caption guidance sent to JoyCaption. There is no Notes field.
- Multi-select supports shared caption/delete. Shift+click Delete Images deletes permanently.
- Bulk: prefix, suffix, replace, remove keyword, ensure/strip trigger; show a before/after preview before apply.
- Convert non-PNG/JPG → JPG; Shrink downscales only when the shortest edge exceeds 1024, then makes it 1024 (Lanczos).
- JoyCaption: external process, progress events, cancel; optional context file + trigger token flags. Until JoyCaption Work dir is set, all automatic-caption entry points and Description are hidden; manual caption controls remain.
- Shift+click the Images-toolbar JoyCaption icon runs Only missing + Prepend trigger without opening the dialog. Logs are under `!Jobs/_caption-runs/{runId}/caption-*.log`.
- Library **Add to caption queue…** opens JoyCaption for that dataset.
- **Create Job / Edit Job / Open Job** is hidden until AI Toolkit Work dir is set.
- The library **Queue** filter and queued/training badge are also hidden until then; a saved Queue filter resets to All.
- Validation, Weight, Stress, Upscale, Context, and Expression are hidden until the ComfyUI LoRAs folder is set. Output still lists existing checkpoints; Comfy validation details and keep/move controls stay hidden.
- Library spell-check opens **Caption validation** for Ready+ datasets: missing caption, missing trigger, no trigger word, and unsupported image type. Fix/Fix all converts unsupported images to JPG.

---

## Library explorer

- Status filters (icon-only chips) and name search (`"word"` = whole word).
- Context menu: Rename (F2), **Duplicate…**, Reveal, Remove from library / Delete dataset…, plus **Add to caption queue…** when JoyCaption Work dir is configured.

---

## Image scraper

App toolbar scraper (Pinterest / Google) downloads into the selected dataset folder. Last source is remembered in library settings (`lastImageScraperSource`).

---

## Comfy dataset tools (middle tabs)

| Tab | Role |
| --- | --- |
| Images | Grid + captions |
| Output | Checkpoints, keep-in-Comfy, clear output |
| Validation Steps / Validation Weight / Model Stress-Testing | Previews — see [VALIDATION.md](VALIDATION.md) |
| Upscale | Detail / upscale via dedicated Comfy workflow; last-used fields in `lastUpscaleConfig` |
| Context / Expression | Diversify variants as `{root}_dNN` siblings — see [EXTERNAL_TOOLS.md](EXTERNAL_TOOLS.md) |

---

## Covers & media

- Cover file name stored on dataset record; explorer tiles use thumb URL.
- Custom protocol serves only registered dataset roots (and derived output paths as allowed by handlers).
- Thumb invalidation on shrink/convert/delete/edit.

---

## Output / checkpoints

Under `{datasetFolder}/output/`:

- Training checkpoints (`.safetensors`)
- Validation Steps folders `Set 1`, `Set 2`, …
- Validation Weight folders `Weight 1`, …
- Stress-Test folders `Stress 1`, …
- Clear output asks first, then removes training artifacts + staged Comfy LoRAs for this dataset (not training images). It uses the running/paused-training and Validation Steps guard.

Legacy `{stem}.upscale.json` next to images may still exist from older builds; live Upscale settings are library `lastUpscaleConfig` (D16). Cleanup removes those sidecars when images are deleted.

See [VALIDATION.md](VALIDATION.md) and [JOB_QUEUE.md](JOB_QUEUE.md).

---

## Related code

| Area | Location |
| --- | --- |
| Store / scan / delete / duplicate | `src/main/datasets/store.ts` |
| Thumbs | `src/main/media/thumbs.ts` |
| Protocol | `src/main/media/protocol.ts` |
| Grid UI | `src/renderer/components/ImageGrid.tsx` |
| Explorer | `src/renderer/components/DatasetExplorer.tsx` |
| Screen | `src/renderer/screens/DatasetsScreen.tsx` |

