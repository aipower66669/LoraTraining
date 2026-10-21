/** HTML5 DnD custom type for dataset image transfers (grid → library tile). */
export const DATASET_IMAGE_DRAG_MIME = 'application/x-lora-training-dataset-images'

export type DatasetImageDragPayload = {
  sourceDatasetId: string
  fileNames: string[]
}

export function encodeDatasetImageDragPayload(payload: DatasetImageDragPayload): string {
  return JSON.stringify({
    sourceDatasetId: payload.sourceDatasetId,
    fileNames: payload.fileNames.filter((n) => typeof n === 'string' && n.trim())
  })
}

export function parseDatasetImageDragPayload(raw: string): DatasetImageDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.sourceDatasetId !== 'string' || !obj.sourceDatasetId) return null
    if (!Array.isArray(obj.fileNames)) return null
    const fileNames = obj.fileNames.filter(
      (n): n is string => typeof n === 'string' && n.trim().length > 0
    )
    if (fileNames.length === 0) return null
    return { sourceDatasetId: obj.sourceDatasetId, fileNames }
  } catch {
    return null
  }
}

export function isDatasetImageDrag(types: DOMStringList | readonly string[]): boolean {
  const list = Array.from(types as ArrayLike<string>)
  return list.includes(DATASET_IMAGE_DRAG_MIME)
}
