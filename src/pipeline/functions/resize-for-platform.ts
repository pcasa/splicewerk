import { join } from 'node:path'
import { reformat } from '../../services/ffmpeg.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

const PLATFORM_MAP: Record<string, string> = {
  youtube: 'youtube',
  'instagram-reels': 'instagram-reels',
  reels: 'instagram-reels',
  instagram: 'instagram-reels',
  tiktok: 'tiktok',
  'instagram-square': 'instagram-square',
  square: 'instagram-square',
}

function normalisePlatform(raw: string): string {
  const key = raw.toLowerCase().trim()
  return PLATFORM_MAP[key] ?? key
}

export const manifest: FunctionManifest = {
  name: 'resizeForPlatform',
  description:
    'Reformats a video for a specific social media platform. Creates platform-optimized versions with correct aspect ratio and resolution.',
  inputs: [
    {
      name: 'videoPath',
      type: 'asset',
      description: 'Asset name of the source video to reformat.',
      required: true,
    },
    {
      name: 'platform',
      type: 'string',
      description:
        'Target platform. Accepted values: "youtube" (16:9 1080p), "instagram-reels" (9:16 1080×1920), "tiktok" (9:16 1080×1920), "instagram-square" (1:1 1080×1080).',
      required: true,
    },
  ],
  outputs: [
    { name: 'reformatted', description: 'Path to the platform-optimized video.' },
  ],
  estimatedSeconds: 20,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const videoAsset = inputs.videoPath as string
  const input = assets[videoAsset]
  if (!input) {
    throw new Error(
      `Asset "${videoAsset}" not found. Available: ${Object.keys(assets).join(', ')}`
    )
  }

  const rawPlatform = inputs.platform as string
  if (!rawPlatform || rawPlatform.trim() === '') {
    throw new Error('platform input is required and must be a non-empty string')
  }

  const formatName = normalisePlatform(rawPlatform)
  const output = join(projectDir, `reformatted-${formatName}-${Date.now()}.mp4`)

  const result = await reformat(input, formatName, output)
  if (!result.ok) throw new Error(`reformat failed for platform "${formatName}": ${result.error}`)

  return { reformatted: output }
}
