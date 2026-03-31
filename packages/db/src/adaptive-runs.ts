import { supabase } from './client.js'

export type AdaptivePipelineRunRow = {
  run_id: string
  user_intent: string
  project_dir: string
  completed_at?: string
  final_output?: string
  assets: Record<string, string>
  completed_steps: Array<{
    id: string
    functionName: string
    inputs: Record<string, unknown>
    outputs: Record<string, string>
    durationMs: number
  }>
}

export async function upsertAdaptivePipelineRun(data: AdaptivePipelineRunRow): Promise<void> {
  const { error } = await supabase
    .from('adaptive_pipeline_runs')
    .upsert(data, { onConflict: 'run_id' })

  if (error) throw error
}

export async function getAdaptivePipelineRun(runId: string): Promise<AdaptivePipelineRunRow | null> {
  const { data, error } = await supabase
    .from('adaptive_pipeline_runs')
    .select('*')
    .eq('run_id', runId)
    .single()

  if (error) return null
  return data as AdaptivePipelineRunRow
}

export async function listAdaptivePipelineRuns(limit = 20): Promise<AdaptivePipelineRunRow[]> {
  const { data, error } = await supabase
    .from('adaptive_pipeline_runs')
    .select('*')
    .order('completed_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as AdaptivePipelineRunRow[]
}
