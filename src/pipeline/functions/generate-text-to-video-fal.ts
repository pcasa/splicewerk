import { join } from 'node:path'
import { textToVideo, downloadFalVideo } from '../../services/falai.js'
import type { FalVideoModel } from '../../services/falai.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateTextToVideoFal',
  description:
    'Generates a video clip from a text prompt only — no source image needed. ' +
    'Use to create fully synthetic b-roll, atmospheric loops, abstract backgrounds, or concept visualizations. ' +
    'Model options: ' +
    '"fal-ai/kling-video/v3/pro/text-to-video" (default, ~$0.03/s, best motion physics), ' +
    '"fal-ai/kling-video/v2.1/standard/text-to-video" (standard tier, cheaper), ' +
    '"fal-ai/veo3.1-fast/text-to-video" (Google Veo, native audio generation, ~$0.05/s), ' +
    '"fal-ai/wan-25-preview/text-to-video" (budget, ~$0.008/s), ' +
    '"fal-ai/minimax/video-01" (MiniMax, strong motion, ~$0.025/s), ' +
    '"fal-ai/ltx-video" (fastest T2V ~10s, great for rapid iteration), ' +
    '"fal-ai/hunyuan-video" (Tencent, excellent temporal consistency, ~$0.015/s), ' +
    '"fal-ai/cogvideox-5b" (open-weight, good for stylized/cinematic). ' +
    'Prefer Veo for content that needs synchronized audio. Use LTX for fast drafts.',
  inputs: [
    {
      name: 'prompt',
      type: 'string',
      description:
        'Cinematic text description of the video to generate. Be specific about camera movement, lighting, subject, and atmosphere. Example: "Cinematic slow-motion shot of rain hitting a black sports car hood, neon city reflections, depth of field, 4K film grain".',
      required: true,
    },
    {
      name: 'model',
      type: 'string',
      description: 'fal.ai text-to-video model (see function description for full list). Default: "fal-ai/kling-video/v3/pro/text-to-video".',
      required: false,
    },
    {
      name: 'durationSeconds',
      type: 'number',
      description: 'Clip duration in seconds. Most models: 5 or 10. MiniMax: 6 or 9. Default: 5.',
      required: false,
    },
    {
      name: 'aspectRatio',
      type: 'string',
      description: 'Aspect ratio: "16:9" (default, landscape), "9:16" (vertical/Reels), "1:1" (square).',
      required: false,
    },
  ],
  outputs: [
    { name: 'generatedClip', description: 'Path to the generated video clip.' },
  ],
  estimatedSeconds: 120,
}

export const execute: ExecuteFn = async (inputs, _assets, projectDir) => {
  const prompt = inputs.prompt as string
  if (!prompt?.trim()) throw new Error('prompt is required')

  const model = (inputs.model as FalVideoModel | undefined) ?? 'fal-ai/kling-video/v3/pro/text-to-video'
  const duration = (Number(inputs.durationSeconds ?? 5) === 10 ? 10 : 5) as 5 | 10
  const aspectRatio = (inputs.aspectRatio as string | undefined) ?? '16:9'

  const result = await textToVideo({
    model,
    prompt: prompt.trim(),
    duration,
    aspect_ratio: aspectRatio as '16:9' | '9:16' | '1:1',
  })
  if (!result.ok) throw new Error(`fal.ai textToVideo failed: ${result.error}`)

  const outputPath = join(projectDir, `t2v-clip-${Date.now()}.mp4`)
  const download = await downloadFalVideo(result.value.videoUrl, outputPath)
  if (!download.ok) throw new Error(`Failed to download fal.ai clip: ${download.error}`)

  return { generatedClip: outputPath }
}
