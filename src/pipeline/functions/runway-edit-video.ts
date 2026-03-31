import { editVideo } from '../../services/runway.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'runwayEditVideo',
  description:
    'Edit or stylize an existing video clip using Runway Gen-4 Aleph (video-to-video). Use for applying cinematic color grades, style transfers, atmospheric effects, or transforming footage aesthetics. ~25 Runway credits per 5-second clip.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video to edit.',
      required: true,
    },
    {
      name: 'editPrompt',
      type: 'string',
      description: 'Natural language description of the desired edit or style. Example: "cinematic teal and orange color grade, film grain, lens flare on headlights".',
      required: true,
    },
  ],
  outputs: [
    { name: 'editedClip', description: 'Path to the edited video clip.' },
  ],
  estimatedSeconds: 90,
}

export const execute: ExecuteFn = async (inputs, assets, _projectDir) => {
  const videoAsset = inputs.videoPath as string
  const videoPath = assets[videoAsset]
  if (!videoPath) {
    throw new Error(`Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const editPrompt = inputs.editPrompt as string
  if (!editPrompt?.trim()) throw new Error('editPrompt is required')

  const result = await editVideo(videoPath, editPrompt.trim())
  if (!result.ok) throw new Error(`Runway editVideo failed: ${result.error}`)

  // result.value is the downloaded output path from runway.ts
  return { editedClip: result.value }
}
