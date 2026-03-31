import { join } from 'node:path'
import { textToImage, downloadFalImage } from '../../services/falai.js'
import type { FalImageModel } from '../../services/falai.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateImageFal',
  description:
    'Generates a high-quality still image from a text prompt using fal.ai. ' +
    'Use for title cards, poster art, end card backgrounds, or any AI-generated image asset. ' +
    'Model options: ' +
    '"fal-ai/flux/dev" (default, ~$0.025, best general quality), ' +
    '"fal-ai/flux/schnell" (~$0.003, 4-step fast, great for drafts), ' +
    '"fal-ai/flux-pro" (~$0.040, pro tier), ' +
    '"fal-ai/flux-pro/v1.1" (~$0.050, improved pro), ' +
    '"fal-ai/flux-pro/v1.1-ultra" (~$0.060, highest quality up to 4MP), ' +
    '"fal-ai/ideogram/v2" (~$0.080, best for text/typography in images — use for title cards with readable text), ' +
    '"fal-ai/ideogram/v2/turbo" (~$0.050, faster Ideogram), ' +
    '"fal-ai/recraft-v3" (~$0.040, best for brand/design/vector-style assets), ' +
    '"fal-ai/fast-sdxl" (~$0.002, budget SDXL). ' +
    'Use Ideogram for any image that must contain readable text. Use Recraft for logos and brand elements.',
  inputs: [
    {
      name: 'prompt',
      type: 'string',
      description: 'Detailed description of the image to generate. Include lighting, style, mood, and any text that should appear.',
      required: true,
    },
    {
      name: 'model',
      type: 'string',
      description: 'fal.ai image model (see function description for full list). Default: "fal-ai/flux/dev".',
      required: false,
    },
    {
      name: 'width',
      type: 'number',
      description: 'Image width in pixels. Default: 1920. Note: Ideogram uses aspect ratio instead of explicit dimensions.',
      required: false,
    },
    {
      name: 'height',
      type: 'number',
      description: 'Image height in pixels. Default: 1080.',
      required: false,
    },
  ],
  outputs: [
    { name: 'generatedImage', description: 'Path to the generated image file (JPG).' },
  ],
  estimatedSeconds: 30,
}

export const execute: ExecuteFn = async (inputs, _assets, projectDir) => {
  const prompt = inputs.prompt as string
  if (!prompt?.trim()) throw new Error('prompt is required')

  const model = (inputs.model as FalImageModel | undefined) ?? 'fal-ai/flux/dev'
  const width = inputs.width ? Number(inputs.width) : 1920
  const height = inputs.height ? Number(inputs.height) : 1080

  const result = await textToImage({ model, prompt: prompt.trim(), width, height })
  if (!result.ok) throw new Error(`fal.ai textToImage failed: ${result.error}`)

  const outputPath = join(projectDir, `generated-image-${Date.now()}.jpg`)
  const download = await downloadFalImage(result.value.imageUrl, outputPath)
  if (!download.ok) throw new Error(`Failed to download fal.ai image: ${download.error}`)

  return { generatedImage: outputPath }
}
