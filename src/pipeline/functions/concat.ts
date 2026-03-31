import { join } from 'node:path'
import { access } from 'node:fs/promises'
import { concatClips } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'concatClips',
  description: 'Joins multiple video segments together in the specified order into one final video. This is always the LAST step — run it only after all segments are ready. Segments must all exist as assets.',
  inputs: [
    {
      name: 'segments',
      type: 'string[]',
      description: 'Ordered list of asset NAMES (not paths) to concatenate, e.g. ["brandIntro", "titleCard", "faded", "endCard"]. Only include assets that actually exist.',
      required: true,
    },
  ],
  outputs: [
    { name: 'final', description: 'Path to the final assembled video' },
  ],
  estimatedSeconds: 20,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const segmentNames = inputs.segments as string[]
  const output = join(projectDir, 'enhanced-final.mp4')

  // Resolve asset names to paths and verify they exist
  const paths: string[] = []
  for (const name of segmentNames) {
    const path = assets[name]
    if (!path) throw new Error(`Asset "${name}" not found in asset state. Available: ${Object.keys(assets).join(', ')}`)
    try {
      await access(path)
    } catch {
      throw new Error(`Asset "${name}" path does not exist on disk: ${path}`)
    }
    paths.push(path)
  }

  if (paths.length === 0) throw new Error('No segments to concatenate')

  if (paths.length === 1) {
    // Single segment — just copy it to final output name
    const { copyFile } = await import('node:fs/promises')
    await copyFile(paths[0]!, output)
    return { final: output }
  }

  const result = await concatClips(paths, output)
  if (!result.ok) throw new Error(`concatClips failed: ${result.error}`)
  return { final: output }
}
