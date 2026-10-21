# UI design

Dark tool UI with a cool blue accent. This is a **workbench**, not a marketing site.

---

## Tokens (`global.css`)

| Token | Role |
| --- | --- |
| `--bg` / `--bg-elevated` / `--bg-panel` | Surfaces |
| `--border` | Hairlines / controls |
| `--text` / `--text-dim` | Primary / secondary |
| `--accent` / `--accent-dim` | Primary actions / selection |
| `--danger` / `--success` | Destructive / positive |

Patterns: uppercase dim section titles, `.mono` for paths/metrics, `.primary` / `.danger` buttons, panels, status bar, context menus, status pills, icon-only toolbar buttons with `title` + `aria-label`.

---

## App chrome

```
┌────────────────────────────────────────────────────────────┐
│ [Datasets] [Jobs] [Queue] [Image Scraper] [Settings] status│
├────────────────────────────────────────────────────────────┤
│  Screen content (split panes on Datasets)                  │
├────────────────────────────────────────────────────────────┤
│  Status bar · optional queue/caption drawer progress       │
└────────────────────────────────────────────────────────────┘
```

---

## Screens (v0.2)

| Screen | Layout notes |
| --- | --- |
| **Datasets** | Library \| middle (images / output / Comfy tools) \| details; resizable splits |
| **Jobs** | Job list + config form; hidden until AI Toolkit Work dir is set |
| **Queue** | FIFO cards (drag) + progress/log; hidden until AI Toolkit Work dir is set |
| **Image Scraper** | Header action; embedded Pinterest / Google Images browser |
| **Settings** | External tools tab (including Library root + optional NTFS versions); Default training config appears after AI Toolkit Work dir is set |

### Datasets library

- Category groups, icon status filters, search, tile covers + lifecycle icons
- Context menu: rename (F2), duplicate, reveal, remove/delete forever; caption queue appears only when JoyCaption Work dir is configured

### Image grid

- Virtualized thumbs; multi-select; active outline; drag-import when supported
- Icon toolbar for rescan/open/bulk and configured JoyCaption; image menu shows Upscale / Diversify only when ComfyUI LoRAs is configured

### Queue rows

- Rounded bordered cards; handle + order + name + status
- Fixed columns: duration | finish ETA | icon actions
- Drop-target highlight while dragging

### Validation Steps / Validation Weight / Model Stress-Testing details

- Set tabs + Run / Stop / clear / remove; shared status toolbar while continuum active
- Live Comfy line + preview image; Stress Compare overview grid

### Dialogs

Confirm dialogs for destructive or irreversible operations (dataset delete, clear output, **Stop training?**, **Pause training?**, **Restart / clear output?**, **Delete preview image?**, workflow saves). Image Del uses Recycle Bin without confirm; Shift+Del is permanent without confirm. Duplicate category names are errors, not confirmations.

---

## Accessibility

- Keyboard focus on grids; Escape closes menus
- `aria-label` on icon buttons; tooltips via `title`
- Progress bars expose `role="progressbar"` where used

---

## Related

[USER_GUIDE.md](USER_GUIDE.md) · [DATASET_MANAGER.md](DATASET_MANAGER.md) · [JOB_QUEUE.md](JOB_QUEUE.md)

