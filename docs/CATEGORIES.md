# Categories

Categories group datasets in the library explorer. New categories are **folder-backed** under the library root. Legacy/fallback categories without a folder can still behave as plain labels.

---

## Concepts

| Mode | Behavior |
| --- | --- |
| **Label only (legacy / fallback)** | Add dataset asks for an existing folder. **Remove from library** is available (files stay on disk). |
| **Folder-backed (normal)** | `folder` is relative under `libraryRoot` and may be nested. `folderPath` is derived. Immediate child folders with discoverable images become datasets. Membership is driven by disk + sync. |

No category name is permanently built in. With no categories, Add dataset may show a temporary General fallback. A new category creates its folder, defaulting the relative path from its name.

The Add dataset dialog also has **+ New category…**, which creates the folder-backed category before creating its dataset child.

---

## Folder-backed discovery

### Rules

1. The category folder must be inside the library root and cannot be the library root itself. The UI accepts a nested relative path such as `Group/Category`, or an absolute folder under the library and stores it as relative.
2. Only **immediate** child directories are considered (not nested grandchildren). When a child already has `dataset.json`, it is treated as a dataset immediately — the app never looks inside that folder for nested datasets (there are none).
3. Directory names starting with `.` or `!` are ignored.
4. A folder is discoverable if it has a `dataset.json` **or** at least one top-level `.jpg` / `.jpeg` / `.png`.
5. Empty folders are **not** auto-discovered (they can still be created via “create in category” flows that mkdir + register).
6. Library refresh emits live progress (category / folder counts, then badge enrich) so a slow network share is not an opaque “Loading datasets…”.

### Sync triggers

- Renderer library refresh / `datasets.list` (not gated behind window creation)
- Category create/update when a folder is set
- Debounced `fs.watch` on category roots

### Concurrency & duplicates

Sync is **serialized** (single-flight chain). On each sync the app:

1. Collapses multiple library JSON records that share the same normalized folder path (keeps oldest).
2. Creates missing records for discovered folders.
3. Prunes records for this category that are missing on disk or no longer immediate children.

Normalized path key: `path.resolve` + strip trailing separators + lowercase on Windows.

---

## UI

- **Categories…** dialog: add, rename, change folder, reorder, delete. Blank folder input defaults from the name; it does not create a folderless category.
- Duplicate names return `Category "…" already exists`; a duplicate folder returns `Another category already uses folder "…"`.
- Changing the folder moves the old directory when the destination is absent. If the destination already exists, the category is retargeted and the old directory stays.
- Delete has no confirmation. It removes category metadata, not the disk folder or images. Dataset records move to the first remaining category; with none, they display as Uncategorized.
- Explorer groups datasets under category headers (collapsible).
- Context menu on tiles: Rename, Duplicate…, Reveal in Explorer, Add to caption queue…, Remove from library (non–folder-backed), Delete dataset…

---

## Related code

| Area | Location |
| --- | --- |
| Sync / watch | `src/main/datasets/categorySync.ts` |
| Category CRUD | `src/main/categories/store.ts` |
| UI | `src/renderer/components/CategoryManager.tsx`, `DatasetExplorer.tsx` |

See also [DATASET_MANAGER.md](DATASET_MANAGER.md) and [PROJECT_FORMAT.md](PROJECT_FORMAT.md).

