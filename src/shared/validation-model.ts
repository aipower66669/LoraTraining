/** Sentinel: use Settings → ComfyUI → Default validation model. */
export const VALIDATION_MODEL_DEFAULT = 'Default'

/** Resolve the checkpoint name injected into LT · Model (empty = leave workflow alone). */
export function resolveValidationModel(
  setModel: string | undefined | null,
  settingsDefault: string | undefined | null
): string {
  const raw = (setModel ?? VALIDATION_MODEL_DEFAULT).trim()
  if (!raw || raw === VALIDATION_MODEL_DEFAULT) {
    return (settingsDefault ?? '').trim()
  }
  return raw
}
