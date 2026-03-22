/**
 * Autobahn Syndicate — Logo Reveal
 * Simple, proven Shotstack clip types only (title + image).
 *
 * Usage: npx tsx scripts/cinematic-intro.ts
 */
import 'dotenv/config'
import { uploadFile, renderEdit } from '../src/services/shotstack.js'

const LOGO_PATH   = 'projects/test-intro/raw/GoalImage.png'
const OUTPUT_PATH = 'projects/cinematic-intro/output.mp4'

async function main() {
  console.log('\n🎬 Autobahn Syndicate — Logo Reveal\n')

  console.log('📤 Uploading logo...')
  const logoResult = await uploadFile(LOGO_PATH)
  if (!logoResult.ok) { console.error('Logo upload failed:', logoResult.error); process.exit(1) }
  const logoUrl = logoResult.value
  console.log('   ✓ Logo ready\n')

  const edit = {
    timeline: {
      background: '#000000',
      tracks: [
        // Track 0 (top): Tagline
        {
          clips: [{
            asset: { type: 'title', text: 'PERFORMANCE DRIVING EXPERIENCE', style: 'minimal', color: '#C0C0C0', size: 'x-small' },
            start: 5.5,
            length: 2.5,
            transition: { in: 'fade', out: 'fade' },
          }],
        },

        // Track 1: Logo image
        {
          clips: [{
            asset: { type: 'image', src: logoUrl },
            start: 3.5,
            length: 4.5,
            fit: 'contain',
            transition: { in: 'fade', out: 'fade' },
            effect: 'zoomIn',
          }],
        },

        // Track 2: "SYNDICATE"
        {
          clips: [{
            asset: { type: 'title', text: 'SYNDICATE', style: 'blockbuster', color: '#F46E2C', size: 'large' },
            start: 2.0,
            length: 3.0,
            transition: { in: 'slideRight', out: 'fade' },
          }],
        },

        // Track 3 (bottom): "AUTOBAHN"
        {
          clips: [{
            asset: { type: 'title', text: 'AUTOBAHN', style: 'blockbuster', color: '#E02828', size: 'large' },
            start: 0.5,
            length: 4.5,
            transition: { in: 'slideLeft', out: 'fade' },
          }],
        },
      ],
    },
    output: {
      format: 'mp4' as const,
      size: { width: 1920, height: 1080 },
      fps: 30,
      quality: 'high' as const,
    },
  }

  console.log('🎞  Rendering...')
  const result = await renderEdit(edit, OUTPUT_PATH)
  if (!result.ok) { console.error('\n✗ Render failed:', result.error); process.exit(1) }

  console.log(`\n✓ Done! → ${result.value}`)
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
