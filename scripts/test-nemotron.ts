import 'dotenv/config'
import { generateCinematicPrompt } from '../src/services/llm.js'
import type { BrandContext } from '../src/services/llm.js'

const BRAND: BrandContext = {
  brandName: 'Autobahn Syndicate',
  tagline: 'Performance Driving Experience',
  industry: 'German automotive performance and luxury driving',
  colors: { primary: '#E02828', secondary: '#F46E2C', accent: '#C0C0C0' },
  mood: 'high-budget AMG / Porsche / BMW M-series commercial',
}

async function main() {
  console.log('Testing Nemotron → Runway prompt pipeline...\n')
  const result = await generateCinematicPrompt(BRAND, 'projects/cinematic-intro/logo-on-black.jpg')
  if (result.ok) {
    console.log('✓ Nemotron generated prompt:\n')
    console.log(result.value)
    console.log(`\nLength: ${result.value.length} chars`)
  } else {
    console.error('✗ Failed:', result.error)
  }
}
main()
