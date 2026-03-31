import { join } from 'node:path'
import { generateEndCard } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateEndCard',
  description: 'Creates a branded end card with a title and stats line on a branded background. Plays at the end of the video. Only use if title and stats are provided.',
  inputs: [
    { name: 'title', type: 'string', description: 'Main title for the end card, e.g. "Mustang dyno"', required: true },
    { name: 'stats', type: 'string', description: 'Stats line, e.g. "452HP / 532 FT-Lbs torque"', required: true },
    { name: 'durationSec', type: 'number', description: 'Duration of the end card in seconds. Default: 4', required: false },
  ],
  outputs: [
    { name: 'endCard', description: 'Path to the end card video file' },
  ],
  estimatedSeconds: 8,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const output = join(projectDir, 'pipeline-end-card.mp4')

  // Read brand colors from brandConfig asset if available
  let brand: { primary?: string; secondary?: string; text?: string; background?: string } = {}

  if (assets.brandConfig) {
    try {
      const { readFile } = await import('node:fs/promises')
      const raw = JSON.parse(await readFile(assets.brandConfig, 'utf-8')) as {
        colors?: { primary?: string; secondary?: string; text?: string; background?: string }
      }
      brand = raw.colors ?? {}
    } catch { /* use defaults */ }
  }

  const result = await generateEndCard({
    titleText: inputs.title as string,
    statsText: inputs.stats as string,
    output,
    brand,
    durationSec: (inputs.durationSec as number | undefined) ?? 4,
  })
  if (!result.ok) throw new Error(`generateEndCard failed: ${result.error}`)
  return { endCard: output }
}
