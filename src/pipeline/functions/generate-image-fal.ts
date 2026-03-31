import { join } from 'node:path'
import { textToImage, downloadFalImage } from '../../services/falai.js'
import type { FalImageModel } from '../../services/falai.js'
import type { FunctionManifest, ExecuteFn } from '../types.js'

export const manifest: FunctionManifest = {
  name: 'generateImageFal',
  description:
    'Generates a high-quality still image from a text prompt using fal.ai Flux. Use for title cards, poster art, end card backgrounds, or any AI-generated image asset. Flux Dev is the default (high quality, ~$0.025/image). Flux Schnell is faster/cheaper.',
  inputs: [
    {
      name: 'prompt',
      type: 'string',
      description: 'Detailed description of the image to generate. Include lighting, style, mood.',
      required: true,
    },
    {
      name: 'model',
      type: 'string',
      description: 'fal.ai model: "fal-ai/flux/dev" (default), "fal-ai/flux/schnell" (fast/cheap), "fal-ai/flux-pro/v1.1-ultra" (best quality).',
      required: false,
    },
    {
      name: 'width',
      type: 'number',
      description: 'Image width in pixels. Default: 1920.',
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
