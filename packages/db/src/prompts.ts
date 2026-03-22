import { supabase } from './client.js'

export type PromptLogEntry = {
  run_id?: string
  source: 'ui-chat' | 'pipeline' | 'pipeline-baseline' | 'generate-edl'
  step?: string
  model: string
  messages_in: Array<{ role: string; content: string | unknown[] }>
  response_out?: string
  tokens_used?: number
  latency_ms?: number
  metadata?: Record<string, unknown>
}

export async function logPrompt(entry: PromptLogEntry): Promise<void> {
  const { error } = await supabase.from('prompt_logs').insert(entry)
  if (error) throw error
}

export async function getPromptLogs(
  limit: number,
  runId?: string
): Promise<PromptLogEntry[]> {
  let query = supabase
    .from('prompt_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (runId !== undefined) {
    query = query.eq('run_id', runId)
  }

  const { data, error } = await query

  if (error) throw error
  return (data ?? []) as PromptLogEntry[]
}
