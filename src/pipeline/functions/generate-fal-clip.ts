import { join } from 'node:path'
import { imageToVideo, downloadFalVideo } from '../../services/falai.js'
import type { FalVideoModel } from '../../services/falai.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateFalClip',
  description:
    'Generates an AI video clip from a static image using fal.ai. Defaults to Kling 3.0 Pro (~$0.03/sec). ' +
    'Model options — image-to-video: ' +
    '"fal-ai/kling-video/v3/pro/image-to-video" (default, film-grade motion physics), ' +
    '"fal-ai/kling-video/v2.1/standard/image-to-video" (standard tier, cheaper), ' +
    '"fal-ai/veo3.1-fast/image-to-video" (Google Veo, native audio, ~$0.05/s), ' +
    '"fal-ai/wan-25-preview/image-to-video" (budget, ~$0.008/s), ' +
    '"fal-ai/minimax/video-01-live" (MiniMax Hailuo-02, strong motion, ~$0.025/s), ' +
    '"fal-ai/ltx-video/image-to-video" (fastest generation ~10s, draft quality), ' +
    '"fal-ai/hunyuan-video/image-to-video" (Tencent, excellent consistency, ~$0.015/s), ' +
    '"fal-ai/cogvideox-5b/image-to-video" (open-weight, stylized, ~$0.010/s). ' +
    'Use Kling for car/action content. Use Veo for audio-native. Use LTX for fast iteration.',
  inputs: [
    {
      name: 'imagePath',
      type: 'asset',
      description: 'Asset name of the source image to animate.',
      required: true,
    },
    {
      name: 'prompt',
      type: 'string',
      description:
        'Cinematic description of motion and atmosphere. Example: "Slow dolly forward, rain droplets on hood, neon reflections rippling on wet asphalt, atmospheric particles drifting, subtle camera shake".',
      required: true,
    },
    {
      name: 'model',
      type: 'string',
      description:
        'fal.ai model endpoint (see function description for full list). Default: "fal-ai/kling-video/v3/pro/image-to-video".',
      required: false,
    },
    {
      name: 'durationSeconds',
      type: 'number',
      description: 'Clip duration in seconds. Most models support 5 or 10. MiniMax supports 6 or 9. Default: 5.',
      required: false,
    },
    {
      name: 'aspectRatio',
      type: 'string',
      description: 'Aspect ratio: "16:9" (default), "9:16", "1:1", "4:3".',
      required: false,
    },
  ],
  outputs: [
    { name: 'falClip', description: 'Path to the generated fal.ai video clip.' },
  ],
  estimatedSeconds: 120,
}

export const execute: ExecuteFn = async (inputs, assets, projectDir) => {
  const imageAsset = inputs.imagePath as string
  const imagePath = assets[imageAsset]
  if (!imagePath) {
    throw new Error(`Asset "${imageAsset}" not found. Available: ${Object.keys(assets).join(', ')}`)
  }

  const prompt = inputs.prompt as string
  if (!prompt?.trim()) throw new Error('prompt is required')

  const model = (inputs.model as FalVideoModel | undefined) ?? 'fal-ai/kling-video/v3/pro/image-to-video'
  const duration = (Number(inputs.durationSeconds ?? 5) === 10 ? 10 : 5) as 5 | 10
  const aspectRatio = (inputs.aspectRatio as string | undefined) ?? '16:9'

  // Convert local file path to data URL for fal.ai
  const { readFile } = await import('node:fs/promises')
  const { extname } = await import('node:path')
  const ext = extname(imagePath).toLowerCase()
  const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
  const mime = mimeMap[ext] ?? 'image/jpeg'
  const buffer = await readFile(imagePath)
  const imageUrl = `data:${mime};base64,${buffer.toString('base64')}`

  const result = await imageToVideo({
    model,
    prompt: prompt.trim(),
    image_url: imageUrl,
    duration,
    aspect_ratio: aspectRatio as '16:9' | '9:16' | '1:1' | '4:3',
  })
  if (!result.ok) throw new Error(`fal.ai imageToVideo failed: ${result.error}`)

  const outputPath = join(projectDir, `fal-clip-${Date.now()}.mp4`)
  const download = await downloadFalVideo(result.value.videoUrl, outputPath)
  if (!download.ok) throw new Error(`Failed to download fal.ai clip: ${download.error}`)

  return { falClip: outputPath }
}
