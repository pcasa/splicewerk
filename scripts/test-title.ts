import 'dotenv/config'
import { renderEdit } from '../src/services/shotstack.js'

const edit = {
  timeline: {
    background: '#000000',
    tracks: [{
      clips: [{
        asset: {
          type: 'title',
          text: 'AUTOBAHN SYNDICATE',
          style: 'blockbuster',
          color: '#ffffff',
          size: 'large',
          background: '#000000',
        },
        start: 0,
        length: 5,
      }]
    }]
  },
  output: { format: 'mp4' as const, size: { width: 1920, height: 1080 }, fps: 30, quality: 'high' as const }
}

async function main() {
  const r = await renderEdit(edit, 'projects/cinematic-intro/test.mp4')
  console.log(r)
  if (r.ok) console.log('open "projects/cinematic-intro/test.mp4"')
}
main()
