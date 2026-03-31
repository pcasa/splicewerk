'use client'

import { useCallback, useEffect, useState } from 'react'

type VideoValidation = {
  verdict: 'pass' | 'needs-work'
  summary: string
  issues: string[]
  promptFix?: string
  runwayPromptFix?: string
  runId?: string
  projectName?: string
  timestamp?: string
}

interface Props {
  projectName: string
}

function VerdictBadge({ verdict }: { verdict: VideoValidation['verdict'] }) {
  if (verdict === 'pass') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase bg-green-900/40 text-green-400 border border-green-800/60">
        Pass
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase bg-brand-orange/10 text-brand-orange border border-brand-orange/30">
      Needs Work
    </span>
  )
}

function FixBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-text-subtle mb-1.5">
        {label}
      </p>
      <div className="px-3 py-2.5 rounded bg-input border border-border">
        <p className="text-xs text-text-muted font-mono leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </p>
      </div>
    </div>
  )
}

function ValidationCard({ validation }: { validation: VideoValidation }) {
  const [expanded, setExpanded] = useState(true)

  const hasDetails =
    validation.issues.length > 0 ||
    validation.promptFix ||
    validation.runwayPromptFix

  return (
    <div className="rounded border border-border bg-input overflow-hidden">
      {/* Card header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#2a2a2a] transition-colors"
        aria-expanded={expanded}
      >
        <VerdictBadge verdict={validation.verdict} />
        <p className="flex-1 text-sm text-text-primary leading-snug min-w-0">
          {validation.summary}
        </p>
        {hasDetails && (
          <svg
            className={`w-3.5 h-3.5 shrink-0 text-text-subtle transition-transform mt-0.5 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Expanded details */}
      {expanded && hasDetails && (
        <div className="px-4 pb-4 border-t border-border/50">
          {/* Issues */}
          {validation.issues.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-text-subtle mb-1.5">
                Issues
              </p>
              <ul className="flex flex-col gap-1">
                {validation.issues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="shrink-0 mt-[5px] w-1 h-1 rounded-full bg-brand-red" />
                    <span className="text-xs text-text-muted leading-relaxed">{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Prompt fix */}
          {validation.promptFix && (
            <FixBlock label="Prompt Fix" text={validation.promptFix} />
          )}

          {/* Runway prompt fix */}
          {validation.runwayPromptFix && (
            <FixBlock label="Runway Prompt Fix" text={validation.runwayPromptFix} />
          )}
        </div>
      )}

      {/* Footer meta */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-border/40">
        {validation.runId && (
          <span className="text-[10px] font-mono text-text-subtle truncate">
            run: {validation.runId}
          </span>
        )}
        {validation.timestamp && (
          <span className="text-[10px] text-text-subtle shrink-0 ml-auto">
            {new Date(validation.timestamp).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  )
}

export function ValidationPanel({ projectName }: Props) {
  const [validations, setValidations] = useState<VideoValidation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectName) {
      setValidations([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/validations/${encodeURIComponent(projectName)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { validations: VideoValidation[]; error?: string }
      // Sort newest first — prefer timestamp, fall back to array order
      const sorted = [...(data.validations ?? [])].sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0
        if (!a.timestamp) return 1
        if (!b.timestamp) return -1
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      })
      setValidations(sorted)
      if (data.error) setError(data.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load validations')
    } finally {
      setLoading(false)
    }
  }, [projectName])

  useEffect(() => { load() }, [load])

  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted">
          Validations
          {projectName && (
            <span className="ml-2 font-mono font-normal normal-case text-text-subtle">
              — {projectName}
            </span>
          )}
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-brand-red mb-3">{error}</p>
      )}

      {!projectName && (
        <p className="text-xs text-text-subtle text-center py-4">
          No project selected — upload footage to get started
        </p>
      )}

      {projectName && !loading && validations.length === 0 && !error && (
        <p className="text-xs text-text-subtle text-center py-4">
          No validations yet for this project
        </p>
      )}

      {loading && validations.length === 0 && (
        <p className="text-xs text-text-subtle text-center py-4">Loading...</p>
      )}

      {validations.length > 0 && (
        <div className="flex flex-col gap-3">
          {validations.map((v, i) => (
            <ValidationCard key={v.runId ?? `validation-${i}`} validation={v} />
          ))}
        </div>
      )}
    </section>
  )
}
