#!/usr/bin/env tsx
import 'dotenv/config'
import path from 'node:path'
import { Command } from 'commander'
import { Inngest } from 'inngest'
import { catalogAssets } from '../services/asset-catalog.js'
import { generateEDL } from '../services/llm.js'
import { loadFormatPresets } from '../services/ffmpeg.js'

// ─── Inngest client ───────────────────────────────────────────────────────────

const inngest = new Inngest({
  id: 'splicewerk',
  eventKey: process.env.INNGEST_EVENT_KEY,
})

// ─── Handlers (exported for testing) ─────────────────────────────────────────

export interface ProduceOptions {
  prompt: string
  assets: string
  formats: string
  project?: string
  dryRun: boolean
}

export async function handleProduce(options: ProduceOptions): Promise<void> {
  try {
    const formatsArray = options.formats.split(',').map((f) => f.trim()).filter(Boolean)
    const projectName = options.project ?? path.basename(path.resolve(options.assets))

    if (options.dryRun) {
      // Inline dry-run: catalog assets + generate EDL without Inngest
      console.log(`⧗ Dry run for project: ${projectName}`)
      console.log(`  Formats: ${formatsArray.join(', ')}\n`)

      console.log('  [1/2] Cataloging assets...')
      const manifest = await catalogAssets(options.assets)
      console.log(`        ${manifest.files.length} file(s) found: ${manifest.files.map(f => f.filename).join(', ')}\n`)

      console.log('  [2/2] Generating EDL via LLM...')
      const result = await generateEDL(options.prompt, manifest)
      if (!result.ok) {
        console.error(`\n✗ EDL generation failed: ${result.error}`)
        process.exit(1)
      }

      console.log('\n─── Generated EDL ───────────────────────────────────────\n')
      console.log(JSON.stringify(result.value, null, 2))
      console.log('\n─────────────────────────────────────────────────────────')
      console.log('\n✓ Dry run complete. Run without --dry-run to queue the full render.')
      return
    }

    await inngest.send({
      name: 'video/production-requested',
      data: {
        prompt: options.prompt,
        assetsDir: options.assets,
        formats: formatsArray,
        projectName,
        dryRun: false,
      },
    })

    console.log(`✓ Production job queued for project: ${projectName}`)
    console.log(`  Formats: ${formatsArray.join(', ')}`)
    console.log(`  Run 'pnpm inngest:dev' to start the Inngest dev server if not already running.`)
  } catch (err) {
    console.error('Error queueing production job:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

export async function handleCatalog(assetsDir: string): Promise<void> {
  try {
    const manifest = await catalogAssets(assetsDir)
    console.log(JSON.stringify(manifest, null, 2))
  } catch (err) {
    console.error('Error cataloging assets:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

export function handleFormats(): void {
  try {
    const presets = loadFormatPresets()

    const rows = Object.entries(presets).map(([key, preset]) => ({
      name: key,
      label: preset.label,
      dimensions: `${preset.width}x${preset.height}`,
      fps: preset.fps,
      maxDuration: preset.maxDuration !== null ? `${preset.maxDuration}s` : 'unlimited',
    }))

    // Print header
    console.log(
      'NAME'.padEnd(25) +
      'LABEL'.padEnd(30) +
      'DIMENSIONS'.padEnd(15) +
      'FPS'.padEnd(8) +
      'MAX DURATION'
    )
    console.log('-'.repeat(90))

    for (const row of rows) {
      console.log(
        row.name.padEnd(25) +
        row.label.padEnd(30) +
        row.dimensions.padEnd(15) +
        String(row.fps).padEnd(8) +
        row.maxDuration
      )
    }
  } catch (err) {
    console.error('Error loading format presets:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

export function handleStatus(projectName: string): void {
  console.log(
    `Status check for project '${projectName}' — connect to Inngest dashboard at http://localhost:8288`
  )
}

// ─── CLI Program ──────────────────────────────────────────────────────────────

const program = new Command()

program
  .name('splicewerk')
  .description('Splicewerk video production CLI')
  .version('1.0.0')

program
  .command('produce')
  .description('Queue a video production job')
  .requiredOption('--prompt <text>', 'Creative prompt for the video')
  .requiredOption('--assets <path>', 'Path to the assets directory')
  .option('--formats <formats>', 'Comma-separated list of output formats', 'youtube')
  .option('--project <name>', 'Project name (defaults to assets dir basename)')
  .option('--dry-run', 'Generate EDL without rendering', false)
  .action(async (options: ProduceOptions) => {
    await handleProduce(options)
  })

program
  .command('catalog')
  .description('Catalog assets in a directory')
  .requiredOption('--assets <path>', 'Path to the assets directory')
  .action(async (options: { assets: string }) => {
    await handleCatalog(options.assets)
  })

program
  .command('formats')
  .description('List available output format presets')
  .action(() => {
    handleFormats()
  })

program
  .command('status')
  .description('Check production status for a project')
  .requiredOption('--project <name>', 'Project name')
  .action((options: { project: string }) => {
    handleStatus(options.project)
  })

// Only parse argv when this file is run directly (not imported in tests)
if (process.env.NODE_ENV !== 'test') {
  program.parse(process.argv)
}
