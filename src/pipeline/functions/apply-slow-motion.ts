import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'applySlowMotion',
  description:
    'Slows down or speeds up a video clip using FFmpeg. Factor 0.5 = half speed (slow-mo), 2.0 = double speed. Use when user asks for slow-motion effects or time-lapse.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video to retime.',
      required: true,
    },
    {
      name: 'speedFactor',
      type: 'number',
      description:
        'Playback speed multiplier. 0.5 = half speed (slow-mo), 1.0 = normal, 2.0 = double speed.',
      required: true,
    },
  ],
  outputs: [
    { name: 'retimed', description: 'Path to the retimed video with synced audio.' },
  ],
  estimatedSeconds: 45,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const input = assets[videoAsset]
  if (!input) {
    throw new Error(`Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const speed = Number(inputs.speedFactor)
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`speedFactor must be a positive number, got: ${inputs.speedFactor}`)
  }

  const output = join(projectDir, `retimed-${Date.now()}.mp4`)

  // Video: setpts=(1/speed)*PTS
  // Audio: atempo supports 0.5–2.0 range; chain multiple for extreme values
  const videoFilter = `setpts=${(1 / speed).toFixed(6)}*PTS`

  // Build atempo chain (each pass limited to 0.5–2.0)
  const audioFilters: string[] = []
  let remaining = speed
  while (remaining > 2.0) {
    audioFilters.push('atempo=2.0')
    remaining /= 2.0
  }
  while (remaining < 0.5) {
    audioFilters.push('atempo=0.5')
    remaining /= 0.5
  }
  audioFilters.push(`atempo=${remaining.toFixed(6)}`)
  const audioFilter = audioFilters.join(',')

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', input,
      '-filter:v', videoFilter,
      '-filter:a', audioFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-y', output,
    ])
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg applySlowMotion exited with code ${code}`))
    })
  })

  return { retimed: output }
}
