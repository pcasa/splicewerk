import { supabase } from './client.js'

export type RunStatus = 'Running' | 'Sleeping' | 'Completed' | 'Failed' | 'Cancelled'

export type RunRow = {
  run_id: string
  function_id: string
  status: RunStatus
  started_at: string
  ended_at?: string
  prompt_used?: string
  output_url?: string
  cost_estimate?: Record<string, unknown>
}

export async function upsertRun(data: RunRow): Promise<void> {
  const { error } = await supabase
    .from('runs')
    .upsert(data, { onConflict: 'run_id' })

  if (error) throw error
}

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  endedAt?: string
): Promise<void> {
  const update: Partial<RunRow> = { status }
  if (endedAt !== undefined) update.ended_at = endedAt

  const { error } = await supabase
    .from('runs')
    .update(update)
    .eq('run_id', runId)

  if (error) throw error
}

export async function getRecentRuns(limit: number): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from('runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as RunRow[]
}
