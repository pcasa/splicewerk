import { supabase } from './client.js'

export type CostEntry = {
  run_id: string
  service: 'runway' | 'shotstack' | 'nim' | 'elevenlabs' | 'supabase'
  operation: string
  units?: number
  unit_type?: string
  cost_usd?: number
  metadata?: Record<string, unknown>
}

export async function logCost(entry: CostEntry): Promise<void> {
  const { error } = await supabase.from('cost_ledger').insert(entry)
  if (error) throw error
}

export async function getRunCosts(runId: string): Promise<CostEntry[]> {
  const { data, error } = await supabase
    .from('cost_ledger')
    .select('*')
    .eq('run_id', runId)

  if (error) throw error
  return (data ?? []) as CostEntry[]
}
