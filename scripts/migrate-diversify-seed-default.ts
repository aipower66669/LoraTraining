/**
 * IN-PLACE migration: set Diversify last-used seeds to 0 (random by default).
 *
 * Updates `lastDiversifyContextConfig.seed` and `lastDiversifyExpressionConfig.seed`
 * in library `settings.json` when present and not already ≤0.
 *
 * Idempotent. Usage: npm run migrate:diversify-seed-default
 *    or: npx tsx scripts/migrate-diversify-seed-default.ts [--dry-run]
 */
import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { librarySettingsPath } from '../src/shared/library-paths'
import { resolveLibraryRoot } from './lib/library-root'

const DRY_RUN = process.argv.includes('--dry-run')

type DiversifyBlob = { seed?: unknown; [key: string]: unknown }

function needsSeedReset(raw: unknown): raw is DiversifyBlob {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return false
  const seed = (raw as DiversifyBlob).seed
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return true
  return seed > 0
}

function withSeedZero(raw: DiversifyBlob): DiversifyBlob {
  return { ...raw, seed: 0 }
}

async function main(): Promise<void> {
  const root = await resolveLibraryRoot()
  const path = librarySettingsPath(root)
  try {
    await access(path, constants.F_OK)
  } catch {
    console.log(`No settings.json at ${path} — nothing to migrate.`)
    return
  }

  const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  const ctx = raw.lastDiversifyContextConfig
  const expr = raw.lastDiversifyExpressionConfig
  const patchCtx = needsSeedReset(ctx)
  const patchExpr = needsSeedReset(expr)

  if (!patchCtx && !patchExpr) {
    console.log('Diversify seeds already ≤0 (random) — no changes.')
    return
  }

  const next = {
    ...raw,
    ...(patchCtx ? { lastDiversifyContextConfig: withSeedZero(ctx) } : {}),
    ...(patchExpr ? { lastDiversifyExpressionConfig: withSeedZero(expr) } : {})
  }
  console.log(
    `${DRY_RUN ? '[dry-run] would write' : 'Writing'} diversify seed → 0 → ${path}`,
    { patchCtx, patchExpr }
  )
  if (!DRY_RUN) {
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
