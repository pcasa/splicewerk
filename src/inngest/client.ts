import { Inngest } from 'inngest'
import 'dotenv/config'

const isDev = process.env.INNGEST_DEV === '1'

export const inngest = new Inngest({
  id: 'splicewerk',
  // In dev mode use a local dummy key — real key routes to cloud
  eventKey: isDev ? 'local' : process.env.INNGEST_EVENT_KEY,
  isDev,
  ...(isDev && { baseUrl: 'http://localhost:8288' }),
})

export type ApprovalEvent = {
  name: 'brand/approved'
  data: { note?: string }
}

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

export type FootageEnhanceEvent = {
  name: 'footage/enhance-requested'
  data: {
    inputVideoPath: string
    projectDir: string
    introVideoPath?: string
    scrollingLines?: string[]
    endCardTitle?: string
    endCardStats?: string
    fadeInSec?: number
    fadeOutSec?: number
    stabilization?: {
      shakiness?: number
      smoothing?: number
    }
  }
}
