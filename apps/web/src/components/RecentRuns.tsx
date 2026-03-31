'use client'

import { useEffect, useState, useCallback } from 'react'
import { ValidationPanel } from './ValidationPanel'

type RunStatus = 'Running' | 'Sleeping' | 'Completed' | 'Failed' | 'Cancelled'

type Run = {
  id: string
  functionId: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  run_id?: string
  function_id?: string
  started_at?: string
  ended_at?: string
  prompt_used?: string
  output_url?: string
  totalSteps?: number
}

type RunStep = {
  functionName: string
  durationMs: number
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
}

type RunDetail = {
  run: Run | null
  steps: RunStep[]
  costs: Array<{ service: string; operation: string; cost_usd: number; units?: number; unit_type?: string }>
  prompts: Array<{ step?: string; model: string; response_out?: string; latency_ms?: number }>
}

const STATUS_META: Record<RunStatus, { label: string; dotClass: string }> = {
  Running:   { label: 'Running',   dotClass: 'status-dot--running' },
  Sleeping:  { label: 'Waiting',   dotClass: 'status-dot--sleeping' },
  Completed: { label: 'Completed', dotClass: 'status-dot--completed' },
  Failed:    { label: 'Failed',    dotClass: 'status-dot--failed' },
  Cancelled: { label: 'Cancelled', dotClass: 'status-dot--completed' },
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
  catch { return iso }
}

function formatDuration(startedAt: string, endedAt?: string): string {
  try {
    const start = new Date(startedAt).getTime()
    const end = endedAt ? new Date(endedAt).getTime() : Date.now()
    const secs = Math.floor((end - start) / 1000)
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m ${secs % 60}s`
  } catch { return '' }
}

function slugifyFunctionId(id: string): string {
  return id.split('/').pop() ?? id
}

function normalizeRun(r: Run): Run {
  return {
    id: r.run_id ?? r.id,
    functionId: r.function_id ?? r.functionId,
    status: r.status,
    startedAt: r.started_at ?? r.startedAt,
    endedAt: r.ended_at ?? r.endedAt,
    prompt_used: r.prompt_used,
    output_url: r.output_url,
    totalSteps: r.totalSteps,
  }
}

function videoUrl(filePath: string): string {
  return `http://localhost:3000/api/video?path=${encodeURIComponent(filePath)}`
}

export function RecentRuns() {
  const [runs, setRuns] = useState<Run[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  async function fetchRuns() {
    try {
      const res = await fetch('/api/runs')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.runs) ? data.runs : [])
      setRuns(arr.slice(0, 10).map(normalizeRun))
      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs')
    }
  }

  const fetchDetail = useCallback(async (runId: string) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/runs/${runId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDetail({ run: data.run, steps: data.steps ?? [], costs: data.costs ?? [], prompts: data.prompts ?? [] })
    } catch {
      setDetail({ run: null, steps: [], costs: [], prompts: [] })
    } finally {
      setDetailLoading(false)
    }
  }, [])

  function toggleExpand(runId: string) {
    if (expandedId === runId) {
      setExpandedId(null)
      setDetail(null)
    } else {
      setExpandedId(runId)
      fetchDetail(runId)
    }
  }

  useEffect(() => {
    fetchRuns()
    const interval = setInterval(fetchRuns, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted">Recent Runs</h2>
        {lastUpdated && <span className="text-xs text-text-subtle">Updated {lastUpdated}</span>}
      </div>

      {error && <p className="text-xs text-brand-red">{error}</p>}
      {!error && runs.length === 0 && (
        <p className="text-sm text-text-subtle py-4 text-center">No runs found</p>
      )}

      {runs.length > 0 && (
        <ul className="space-y-2">
          {runs.map((run) => {
            const meta = STATUS_META[run.status] ?? STATUS_META.Completed
            const isExpanded = expandedId === run.id

            return (
              <li key={run.id} className="rounded border border-border overflow-hidden">
                {/* Run row */}
                <button
                  onClick={() => toggleExpand(run.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 bg-input hover:bg-input/80 transition-colors text-left"
                >
                  <span className={`status-dot ${meta.dotClass}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {slugifyFunctionId(run.functionId)}
                    </p>
                    {run.prompt_used && (
                      <p className="text-xs text-text-subtle truncate mt-0.5">{run.prompt_used}</p>
                    )}
                  </div>
                  {run.totalSteps ? (
                    <span className="text-xs text-text-subtle shrink-0">{run.totalSteps} steps</span>
                  ) : null}
                  <span className="text-xs text-text-muted shrink-0">{meta.label}</span>
                  <span className="text-xs text-text-subtle font-mono shrink-0 w-14 text-right">
                    {formatDuration(run.startedAt, run.endedAt)}
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 text-text-subtle shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Detail panel */}
                {isExpanded && (
                  <div className="border-t border-border bg-background px-4 py-4 space-y-4">
                    {detailLoading && (
                      <p className="text-xs text-text-subtle">Loading...</p>
                    )}

                    {!detailLoading && detail && (
                      <>
                        {/* Prompt */}
                        {detail.run?.prompt_used && (
                          <div>
                            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Prompt</p>
                            <p className="text-xs text-text-primary leading-relaxed bg-input border border-border rounded p-3 whitespace-pre-wrap">
                              {detail.run.prompt_used}
                            </p>
                          </div>
                        )}

                        {/* Final video output */}
                        {detail.run?.output_url && (
                          <div>
                            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Final Output</p>
                            <video
                              src={videoUrl(detail.run.output_url)}
                              controls
                              className="w-full rounded border border-border"
                              style={{ maxHeight: '300px' }}
                            />
                            <p className="text-[10px] font-mono text-text-subtle mt-1 truncate">{detail.run.output_url}</p>
                          </div>
                        )}

                        {/* Pipeline steps */}
                        {detail.steps.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Steps</p>
                            <div className="space-y-1">
                              {detail.steps.map((s, i) => (
                                <div key={i} className="flex justify-between items-center text-xs px-2 py-1.5 rounded bg-input border border-border">
                                  <span className="text-text-primary font-mono">{s.functionName}</span>
                                  <span className="text-text-subtle shrink-0 ml-2">{(s.durationMs / 1000).toFixed(1)}s</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Costs */}
                        {detail.costs.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Costs</p>
                            <div className="space-y-1">
                              {detail.costs.map((c, i) => (
                                <div key={i} className="flex justify-between text-xs px-2 py-1 rounded bg-input">
                                  <span className="text-text-muted capitalize">{c.service} — {c.operation}</span>
                                  <span className="font-mono text-text-primary">${(c.cost_usd ?? 0).toFixed(4)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Prompt logs */}
                        {detail.prompts.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">AI Calls</p>
                            <div className="space-y-1">
                              {detail.prompts.map((p, i) => (
                                <div key={i} className="text-xs px-2 py-1.5 rounded bg-input border border-border">
                                  <div className="flex justify-between mb-1">
                                    <span className="text-text-muted">{p.step ?? 'ui-chat'}</span>
                                    {p.latency_ms && <span className="font-mono text-text-subtle">{p.latency_ms}ms</span>}
                                  </div>
                                  {p.response_out && (
                                    <p className="text-text-primary leading-relaxed line-clamp-3">{p.response_out}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Validation recommendations */}
                        {run.status === 'Completed' && (
                          <ValidationPanel runId={run.id} />
                        )}

                        {/* No detail available */}
                        {!detail.run && detail.steps.length === 0 && detail.costs.length === 0 && (
                          <p className="text-xs text-text-subtle">No detail available for this run.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
