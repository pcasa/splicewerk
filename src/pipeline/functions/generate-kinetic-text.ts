import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { FunctionManifest, ExecuteFn } from '../types.js'

/**
 * Generates an animated kinetic text overlay video (transparent background)
 * using FFmpeg drawtext with animated position and opacity.
 *
 * For full Remotion-based kinetic text, use the Remotion integration in
 * apps/web/. This function provides a lightweight FFmpeg fallback that
 * produces dramatic reveal animations without external dependencies.
 */
export const manifest: FunctionManifest = {
  name: 'generateKineticText',
  description:
    'Creates an animated kinetic text video clip with dramatic reveal animation (slide-up + fade-in). The clip has a transparent or black background that composites over video. Use for impactful words, stats, or short phrases the user wants to animate over footage. For multi-layer Remotion animations, use the web app instead.',
  inputs: [
    {
      name: 'text',
      type: 'string',
      description: 'The text to animate. Keep short — 1-5 words work best. E.g. "320 HP".',
      required: true,
    },
    {
      name: 'durationSeconds',
      type: 'number',
      description: 'Duration of the text animation clip in seconds. Default: 3.',
      required: false,
    },
    {
      name: 'fontSize',
      type: 'number',
      description: 'Font size in pixels. Default: 96.',
      required: false,
    },
    {
      name: 'fontColor',
      type: 'string',
      description: 'Font color hex without #. Default: FFFFFF (white).',
      required: false,
    },
    {
      name: 'width',
      type: 'number',
      description: 'Output width in pixels. Default: 1280.',
      required: false,
    },
    {
      name: 'height',
      type: 'number',
      description: 'Output height in pixels. Default: 720.',
      required: false,
    },
  ],
  outputs: [
    { name: 'kineticClip', description: 'Path to the kinetic text animation video clip (black background).' },
  ],
  estimatedSeconds: 15,
}

export const execute: ExecuteFn = async (inputs, _assets, projectDir) => {
  const text = inputs.text as string
  if (!text?.trim()) throw new Error('text is required')

  const duration = Math.max(1, Number(inputs.durationSeconds ?? 3))
  const fontSize = Number(inputs.fontSize ?? 96)
  const fontColor = (inputs.fontColor as string | undefined) ?? 'FFFFFF'
  const width = Number(inputs.width ?? 1280)
  const height = Number(inputs.height ?? 720)

  const output = join(projectDir, `kinetic-text-${Date.now()}.mp4`)
  const fps = 30
  const totalFrames = duration * fps

  // Animate: slide up from center+50px with simultaneous fade in over first 15 frames
  // Stay visible for middle portion, fade out over last 15 frames
  const fadeInFrames = 15
  const fadeOutStart = totalFrames - 15

  const drawtext = [
    `drawtext=text='${text.replace(/'/g, "\\'").replace(/:/g, '\\:')}':`,
    `fontsize=${fontSize}:`,
    `fontcolor=0x${fontColor}:`,
    `x=(w-text_w)/2:`,
    // y animates from center+50 to center, eased over fadeInFrames
    `y=(h-text_h)/2+50*(1-min(n,${fadeInFrames})/${fadeInFrames}):`,
    // alpha: fade in then fade out
    `alpha=if(lt(n,${fadeInFrames}),n/${fadeInFrames},if(gt(n,${fadeOutStart}),(${totalFrames}-n)/15,1))`,
  ].join('')

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-f', 'lavfi',
      '-i', `color=c=black:size=${width}x${height}:rate=${fps}:duration=${duration}`,
      '-vf', drawtext,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-t', String(duration),
      '-an',
      '-y', output,
    ])
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg generateKineticText exited with code ${code}`))
    })
  })

  return { kineticClip: output }
}
