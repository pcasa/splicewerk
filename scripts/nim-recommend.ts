import 'dotenv/config'
import { callLLM } from '../src/services/llm.js'

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) { console.error('NVIDIA_API_KEY not set'); process.exit(1) }

  const brandContext = `
Brand: Autobahn Syndicate
Industry: German automotive performance and luxury driving experiences
Tagline: Performance Driving Experience
Primary color: #E02828 (deep red)
Accent color: #F46E2C (turbo orange)
Text color: #F7F6F5 (off-white)
Background: #0A0A0A (near black)
Font: Montserrat, letter-spacing 6px
Website layout: Logo centered, tagline stacked directly below logo with 30px gap, 0.85 opacity

Current pipeline:
- sharp removes logo background, composites logo centered on pure black 1920x1080 JPEG
- That JPEG + text prompt sent to Runway Gen-4 Turbo image-to-video, 10s
- Runway output + audio assembled in Shotstack
- Tagline added as post-process overlay

Current problem:
Runway prompt includes camera push-in zoom. By seconds 7-8 the logo fills the entire frame.
Post-process tagline overlay ends up overlapping the logo, unreadable and mispositioned.

Two options to evaluate:
A) Bake tagline into the source JPEG using sharp before sending to Runway, so Runway animates logo+tagline as one complete composition
B) Remove camera push-in from Runway prompt entirely, static wide shot, logo positioned upper-center, tagline post-processed cleanly below

Respond with valid JSON only:
{
  "recommendation": "A or B",
  "reasoning": "concise explanation",
  "runwayPrompt": "exact Runway Gen-4 prompt under 950 chars",
  "sourceImageLayout": "if A: describe logo height as % of canvas, tagline y position px, font size px, letter-spacing px, color, vertical gap from logo bottom",
  "taglinePostProcess": "if B: y position px from top, fade in/out timing seconds, font size px, color",
  "otherChanges": "any other pipeline recommendations"
}`

  console.log('[NIM] Asking for brand video recommendation...\n')

  const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1'
  const result = await callLLM(
    [
      { role: 'system', content: 'You are a creative director and video pipeline architect. Give precise actionable recommendations. Output only valid JSON, no markdown fences.' },
      { role: 'user', content: brandContext }
    ],
    { model: 'meta/llama-3.3-70b-instruct', temperature: 0.7, maxTokens: 1500 },
    NIM_BASE_URL,
    `Bearer ${apiKey}`
  )

  if (result.ok) {
    console.log('NIM recommendation:\n')
    try {
      const cleaned = result.value.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim()
      const parsed = JSON.parse(cleaned)
      console.log(JSON.stringify(parsed, null, 2))
    } catch {
      console.log(result.value)
    }
  } else {
    console.error('LLM failed:', result.error)
  }
}

main()
