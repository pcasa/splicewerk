import { Inngest } from 'inngest'
import 'dotenv/config'

export const inngest = new Inngest({
  id: 'splicewerk',
  eventKey: process.env.INNGEST_EVENT_KEY,
})

export type ProductionRequestedEvent = {
  name: 'video/production-requested'
  data: {
    prompt: string
    assetsDir: string
    formats: string[]
    projectName: string
    dryRun?: boolean
  }
}
