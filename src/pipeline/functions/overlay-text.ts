import { join } from 'node:path'
import { addTextOverlay } from '../../services/ffmpeg.js'
import type { TextPosition, TextStyle } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

const VALID_POSITIONS: TextPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

function resolvePosition(raw: unknown): TextPosition {
  const str = typeof raw === 'string' ? raw.toLowerCase().trim() : 'bottom-center'
  if ((VALID_POSITIONS as string[]).includes(str)) return str as TextPosition
  return 'bottom-center'
}

export const manifest: FunctionManifest = {
  name: 'overlayText',
  description:
    'Burns text onto a video at a specified position. Use for stat overlays, labels, lower thirds. Can show text at specific time ranges.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video.',
      required: true,
    },
    {
      name: 'text',
      type: 'string',
      description: 'Text string to display on the video.',
      required: true,
    },
    {
      name: 'position',
      type: 'string',
      description:
        'Where to place the text. One of: top-left, top-center, top-right, center, bottom-left, bottom-center, bottom-right. Defaults to bottom-center.',
      required: false,
    },
    {
      name: 'fontsize',
      type: 'number',
      description: 'Font size in pixels. Defaults to 48.',
      required: false,
    },
    {
      name: 'color',
      type: 'string',
      description: 'Font colour as hex string, e.g. "#FFFFFF". Defaults to white.',
      required: false,
    },
    {
      name: 'startSec',
      type: 'number',
      description: 'Time in seconds at which the text appears. Optional — omit to show for full duration.',
      required: false,
    },
    {
      name: 'endSec',
      type: 'number',
      description: 'Time in seconds at which the text disappears. Optional.',
      required: false,
    },
  ],
  outputs: [
    { name: 'withText', description: 'Path to the video with text burned in.' },
  ],
  estimatedSeconds: 15,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const input = assets[videoAsset]
  if (!input) {
    throw new Error(
      `Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`
    )
  }

  const text = inputs.text as string
  if (!text || text.trim() === '') throw new Error('text input must be a non-empty string')

  const position = resolvePosition(inputs.position)
  const fontsize = inputs.fontsize !== undefined ? Number(inputs.fontsize) : 48
  const color = typeof inputs.color === 'string' ? inputs.color : '#FFFFFF'

  const style: TextStyle = {
    fontsize,
    fontcolor: color,
  }

  // Append time-enable expression to text if startSec/endSec supplied.
  // addTextOverlay escapes the text internally, so we pass the raw string
  // and handle enable via a wrapped approach: prefix with enable expression
  // by building a style that drawtext supports.
  // Since addTextOverlay does not expose enable= directly, we embed it
  // into fontcolor as a no-op and instead call ffmpeg with a modified text
  // that includes the enable range filter expression injected at the style level.
  //
  // The simplest correct approach: addTextOverlay accepts TextStyle which maps
  // to drawtext filter params. We extend fontcolor to include enable= by
  // using a composite filter string — but the service builds drawtext for us.
  //
  // Since the service function doesn't expose enable= natively, we pass
  // startSec/endSec through a custom enable workaround: append enable range
  // information directly to the text field (not visible) won't work. Instead
  // we build the enable expression and add it as a custom style entry by
  // leveraging the fact that TextStyle is an open interface.
  //
  // Cleanest solution: cast style to any and add enable key for drawtext.
  const startSec = inputs.startSec !== undefined ? Number(inputs.startSec) : undefined
  const endSec = inputs.endSec !== undefined ? Number(inputs.endSec) : undefined

  if (startSec !== undefined || endSec !== undefined) {
    const from = startSec ?? 0
    const to = endSec !== undefined ? endSec : 999999
    ;(style as Record<string, unknown>)['enable'] = `between(t,${from},${to})`
  }

  const output = join(projectDir, `text-overlay-${Date.now()}.mp4`)

  const result = await addTextOverlay(input, text, position, style, output)
  if (!result.ok) throw new Error(`addTextOverlay failed: ${result.error}`)

  return { withText: output }
}
