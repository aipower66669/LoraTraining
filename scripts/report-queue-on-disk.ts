/**
 * Read-only report: how many jobs are still queue members on disk.
 * Does not modify any files. Safe to run after a scare that the FIFO looked empty.
 *
 * Usage: npx tsx scripts/report-queue-on-disk.ts
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveLibraryRoot } from './lib/library-root'
import { libraryJobsDir } from '../src/shared/library-paths'
import { buildQueueIdsFromJobs, type QueueHydrateJob } from '../src/shared/queue-hydrate'

async function main(): Promise<void> {
  const root = await resolveLibraryRoot()
  const jobsRoot = libraryJobsDir(root)
  const dirs = await readdir(jobsRoot, { withFileTypes: true })
  const names = dirs.filter((d) => d.isDirectory()).map((d) => d.name)

  const byStatus = new Map<string, number>()
  const hydrateJobs: QueueHydrateJob[] = []
  let parseFailures = 0

  for (const id of names) {
    try {
      const raw = JSON.parse(await readFile(join(jobsRoot, id, 'job.json'), 'utf8')) as {
        id?: string
        status?: string
        archived?: boolean
        queueOrder?: number | null
        updatedAt?: string
      }
      const status = String(raw.status ?? 'unknown')
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1)
      hydrateJobs.push({
        id: String(raw.id ?? id),
        status: status as QueueHydrateJob['status'],
        archived: Boolean(raw.archived),
        queueOrder: typeof raw.queueOrder === 'number' ? raw.queueOrder : null,
        updatedAt: String(raw.updatedAt ?? '')
      })
    } catch {
      parseFailures++
    }
  }

  const fifo = buildQueueIdsFromJobs(hydrateJobs)
  console.log(`libraryRoot: ${root}`)
  console.log(`!Jobs folders: ${names.length}`)
  console.log(`job.json parse failures: ${parseFailures}`)
  console.log('status counts:')
  for (const [status, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${n}`)
  }
  console.log(`FIFO restore size (queued/paused/running/cancelled-with-order): ${fifo.length}`)
  if (fifo.length > 0) {
    console.log(`FIFO head (up to 8): ${fifo.slice(0, 8).join(', ')}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
