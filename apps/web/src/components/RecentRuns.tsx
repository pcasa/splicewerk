'use client'

import { useEffect, useState } from 'react'

type RunStatus = 'Running' | 'Sleeping' | 'Completed' | 'Failed' | 'Cancelled'

type Run = {
  id: string
  functionId: string
  status: RunStatus
  startedAt: string
  endedAt?: string
}

const STATUS_META: Record<RunStatus, { label: string; dotClass: string }> = {
  Running: { label: 'Running', dotClass: 'status-dot--running' },
  Sleeping: { label: 'Waiting', dotClass: 'status-dot--sleeping' },
  Completed: { label: 'Completed', dotClass: 'status-dot--completed' },
  Failed: { label: 'Failed', dotClass: 'status-dot--failed' },
  Cancelled: { label: 'Cancelled', dotClass: 'status-dot--completed' },
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

function formatDuration(startedAt: string, endedAt?: string): string {
  try {
    const start = new Date(startedAt).getTime()
    const end = endedAt ? new Date(endedAt).getTime() : Date.now()
    const secs = Math.floor((end - start) / 1000)
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    return `${mins}m ${secs % 60}s`
  } catch {
    return ''
  }
}

function slugifyFunctionId(id: string): string {
  // e.g. "splicewerk/logo-reveal" → "logo-reveal"
  return id.split('/').pop() ?? id
}

export function RecentRuns() {
  const [runs, setRuns] = useState<Run[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  async function fetchRuns() {
    try {
      const res = await fetch('/api/runs')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.runs) ? data.runs : []))
      setRuns(arr.slice(0, 5))
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs')
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
        <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted">
          Recent Runs
        </h2>
        {lastUpdated && (
          <span className="text-xs text-text-subtle">
            Updated {lastUpdated}
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-brand-red">{error}</p>
      )}

      {!error && runs.length === 0 && (
        <p className="text-sm text-text-subtle py-4 text-center">No runs found</p>
      )}

      {runs.length > 0 && (
        <ul className="space-y-2">
          {runs.map((run) => {
            const meta = STATUS_META[run.status] ?? STATUS_META.Completed
            return (
              <li key={run.id}>
                <a
                  href={`http://localhost:8288/runs/${run.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 rounded bg-input border border-border hover:border-border-input transition-colors group"
                >
                  {/* Status dot */}
                  <span className={`status-dot ${meta.dotClass}`} />

                  {/* Function name */}
                  <span className="flex-1 text-sm font-medium text-text-primary group-hover:text-white transition-colors truncate">
                    {slugifyFunctionId(run.functionId)}
                  </span>

                  {/* Status label */}
                  <span className="text-xs text-text-muted shrink-0">{meta.label}</span>

                  {/* Duration */}
                  <span className="text-xs text-text-subtle font-mono shrink-0 w-14 text-right">
                    {formatDuration(run.startedAt, run.endedAt)}
                  </span>

                  {/* Arrow */}
                  <svg
                    className="w-3.5 h-3.5 text-text-subtle group-hover:text-text-muted transition-colors shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
