import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JobRecordSchema } from '@shared/schemas/job'
import { TrainingConfigSchema } from '@shared/schemas/training-config'
import { atomicWriteJson, atomicWriteFile } from '../security/atomic-write'
import { ensureJobsDir } from '../settings/store'
import { trainingConfigToYaml } from './yaml'

/**
 * Update job configs that still point at an old dataset folder path after a rename.
 */
export async function remapJobsDatasetFolder(opts: {
  datasetId: string
  oldFolderPath: string
  newFolderPath: string
}): Promise<number> {
  const { datasetId, oldFolderPath, newFolderPath } = opts
  if (oldFolderPath === newFolderPath) return 0

  const root = await ensureJobsDir()
  const ids = (await readdir(root).catch(() => [] as string[])).filter((id) => !id.includes('.'))
  let updated = 0

  for (const id of ids) {
    const jsonPath = join(root, id, 'job.json')
    let raw: string
    try {
      raw = await readFile(jsonPath, 'utf8')
    } catch {
      continue
    }
    let record
    try {
      record = JobRecordSchema.parse(JSON.parse(raw))
    } catch {
      continue
    }
    if (record.datasetId !== datasetId) continue

    const config = structuredClone(record.config)
    let dirty = false
    const replacePath = (value: string): string => {
      if (value === oldFolderPath) return newFolderPath
      // training_folder is usually `{folder}/output`
      if (value.startsWith(oldFolderPath)) {
        return newFolderPath + value.slice(oldFolderPath.length)
      }
      return value
    }

    if (config.datasets[0]?.folder_path) {
      const next = replacePath(config.datasets[0].folder_path)
      if (next !== config.datasets[0].folder_path) {
        config.datasets[0].folder_path = next
        dirty = true
      }
    }
    if (config.training_folder) {
      const next = replacePath(config.training_folder)
      if (next !== config.training_folder) {
        config.training_folder = next
        dirty = true
      }
    }

    if (!dirty) continue

    const parsed = TrainingConfigSchema.parse(config)
    const nextRecord = JobRecordSchema.parse({
      ...record,
      config: parsed,
      updatedAt: new Date().toISOString()
    })
    await atomicWriteJson(jsonPath, nextRecord)
    if (nextRecord.yamlPath) {
      await atomicWriteFile(nextRecord.yamlPath, trainingConfigToYaml(parsed))
    }
    updated++
  }

  return updated
}
