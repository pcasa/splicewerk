import { join } from 'node:path'
import { generateScrollingTitleCard } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateScrollingTitleCard',
  description: 'Creates an animated scrolling text card that plays between the brand intro and main footage. Each line scrolls upward in sequence.',
  inputs: [
    { name: 'lines', type: 'string[]', description: 'Array of text lines to scroll, e.g. ["Resonator delete", "Stock cats and mufflers"]', required: true },
    { name: 'durationSec', type: 'number', description: 'Total duration of the title card in seconds. Default: 10', required: false },
    { name: 'textColor', type: 'string', description: 'Text color hex. Uses brand config default if not specified.', required: false },
    { name: 'bgColor', type: 'string', description: 'Background color hex. Uses brand config default if not specified.', required: false },
  ],
  outputs: [
    { name: 'titleCard', description: 'Path to the scrolling title card video file' },
  ],
  estimatedSeconds: 8,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const output = join(projectDir, 'pipeline-title-card.mp4')

  // Read brand colors from brandConfig asset if available
  let textColor: string | undefined
  let bgColor: string | undefined

  if (assets.brandConfig) {
    try {
      const { readFile } = await import('node:fs/promises')
      const brand = JSON.parse(await readFile(assets.brandConfig, 'utf-8')) as {
        colors?: { text?: string; background?: string }
      }
      textColor = brand.colors?.text
      bgColor = brand.colors?.background
    } catch { /* use defaults */ }
  }

  const result = await generateScrollingTitleCard(
    inputs.lines as string[],
    (inputs.durationSec as number | undefined) ?? 10,
    output,
    {
      color: (inputs.textColor as string | undefined) ?? textColor,
      bgColor: (inputs.bgColor as string | undefined) ?? bgColor,
    }
  )
  if (!result.ok) throw new Error(`generateScrollingTitleCard failed: ${result.error}`)
  return { titleCard: output }
}
