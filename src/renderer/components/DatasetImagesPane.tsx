import { ContactRound, FolderOpen, PenLine, RefreshCw, Type } from 'lucide-react'
import type { DatasetDetail } from '@shared/ipc/contract'
import { ImageGrid } from './ImageGrid'
import { BULK_ACTIONS, type BulkOpId } from './bulkActions'

export interface DatasetImagesPaneProps {
  detail: DatasetDetail
  selectedImage: string | null
  processingFileName: string | null
  onSelectImage: (fileName: string) => void
  onRescan: () => void
  onOpenFolder: () => void
  onOpenBulkTool: (op: BulkOpId) => void
  /** When false, JoyCaption toolbar button is hidden (tool not configured in Settings). */
  showJoyCaption?: boolean
  onOpenJoyCaption?: (opts?: { shiftKey?: boolean }) => void
  onOpenSetCaption: () => void
  onOpenIdentityTag: () => void
  onCreateDatasetFromImage?: (fileName: string) => void
}

/** Images tab: toolbar (rescan / open folder / bulk caption tools / JoyCaption) + the image grid. */
export function DatasetImagesPane(props: DatasetImagesPaneProps): React.JSX.Element {
  const {
    detail,
    selectedImage,
    processingFileName,
    onSelectImage,
    onRescan,
    onOpenFolder,
    onOpenBulkTool,
    onOpenJoyCaption,
    onOpenSetCaption,
    onOpenIdentityTag,
    onCreateDatasetFromImage,
    showJoyCaption = false
  } = props

  return (
    <>
      <div className="toolbar images-toolbar" role="toolbar" aria-label="Dataset images">
        <button
          type="button"
          className="icon-btn"
          title="Rescan this dataset folder for new, removed, or renamed images and captions."
          aria-label="Rescan folder"
          onClick={onRescan}
        >
          <RefreshCw size={17} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Open this dataset’s folder in the file explorer."
          aria-label="Open folder"
          onClick={onOpenFolder}
        >
          <FolderOpen size={17} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="toolbar-spacer" aria-hidden="true">
          |
        </span>
        {BULK_ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.id}
              type="button"
              className="icon-btn"
              title={action.tooltip}
              aria-label={action.label}
              onClick={() => onOpenBulkTool(action.id)}
            >
              <Icon size={17} strokeWidth={2} aria-hidden="true" />
            </button>
          )
        })}
        <span className="toolbar-spacer" aria-hidden="true">
          |
        </span>
        <button
          type="button"
          className="icon-btn"
          title="Set a caption manually on all images in this dataset."
          aria-label="Set caption"
          onClick={onOpenSetCaption}
        >
          <Type size={17} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Add a unique identity tag (female name) to each image caption."
          aria-label="Add identity tag"
          onClick={onOpenIdentityTag}
        >
          <ContactRound size={17} strokeWidth={2} aria-hidden="true" />
        </button>
        {showJoyCaption && onOpenJoyCaption ? (
          <button
            type="button"
            className="icon-btn"
            title="Run JoyCaption… · Shift+click: missing only + prepend trigger (no dialog)"
            aria-label="JoyCaption"
            onClick={(e) => onOpenJoyCaption({ shiftKey: e.shiftKey })}
          >
            <PenLine size={17} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        <span className="hint dataset-image-count" style={{ marginLeft: 'auto' }}>
          {detail.images.length} image{detail.images.length === 1 ? '' : 's'}
        </span>
      </div>
      {detail.stats.stemCollisions.length > 0 && (
        <div className="error-banner">
          Duplicate image names (different extensions):{' '}
          {detail.stats.stemCollisions.map((stem) => `${stem}.*`).join(', ')}. Each group shares
          one caption file (e.g. {detail.stats.stemCollisions[0]}.txt) — rename so every image has
          a unique name.
        </div>
      )}
      <div className="middle-panel-body">
        <ImageGrid
          datasetId={detail.id}
          images={detail.images}
          selected={selectedImage}
          onSelect={onSelectImage}
          processingFileName={processingFileName}
          onCreateDatasetFromImage={onCreateDatasetFromImage}
        />
      </div>
    </>
  )
}
