import { join } from 'node:path'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { imageToVideo } from '../../services/runway.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateRunwayClip',
  description:
    'Generates an AI video clip from a static image using Runway Gen-4 Turbo (~$0.25/5s). Use for high-quality cinematic animation of car photos, atmospheric scene animation, or when Runway\'s unique reference-tagging and Aleph video editing capabilities are needed. Use generateFalClip for cheaper generation.',
  inputs: [
    {
      name: 'imagePath',
      type: 'asset',
      description: 'Asset name of the source image (JPEG/PNG/WebP) to animate.',
      required: true,
    },
    {
      name: 'prompt',
      type: 'string',
      description:
        'Cinematic description of the desired motion and atmosphere. Use film terminology: "slow dolly forward, rain droplets on lens, neon reflections on wet pavement, subtle parallax". Be specific about camera movement and environment.',
      required: true,
    },
    {
      name: 'durationSeconds',
      type: 'number',
      description: 'Clip duration: 5 or 10 seconds. Default: 5.',
      required: false,
    },
  ],
  outputs: [
    { name: 'runwayClip', description: 'Path to the generated Runway video clip.' },
  ],
  estimatedSeconds: 180,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const imageAsset = inputs.imagePath as string
  const imagePath = assets[imageAsset]
  if (!imagePath) {
    throw new Error(`Asset "${imageAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const prompt = inputs.prompt as string
  if (!prompt?.trim()) throw new Error('prompt is required')

  const duration = (Number(inputs.durationSeconds ?? 5) === 10 ? 10 : 5) as 5 | 10

  // imageToVideo saves locally in its output dir and returns the path
  const result = await imageToVideo(imagePath, prompt.trim(), duration)
  if (!result.ok) throw new Error(`Runway imageToVideo failed: ${result.error}`)

  // Copy into projectDir so all pipeline assets live in one place
  const outputPath = join(projectDir, `runway-clip-${Date.now()}.mp4`)
  await pipeline(createReadStream(result.value), createWriteStream(outputPath))

  return { runwayClip: outputPath }
}
