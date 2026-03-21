import { serve } from 'inngest/node'
import { inngest } from './src/inngest/client.js'
import { produceVideo } from './src/inngest/functions/produce-video.js'

export default serve({
  client: inngest,
  functions: [produceVideo],
})
