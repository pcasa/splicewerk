'use client'

import { useState } from 'react'

type ApprovalState = {
  runId: string
  prompt: string
} | null

type TriggerMode = 'pipeline' | 'runway' | 'force'

export function PipelineControls() {
  const [loading, setLoading] = useState<TriggerMode | null>(null)
  const [approval, setApproval] = useState<ApprovalState>(null)
  const [approvalLoading, setApprovalLoading] = useState<'approve' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function triggerPipeline(mode: TriggerMode) {
    setLoading(mode)
    setError(null)
    try {
      const res = await fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // If the run immediately returns an approval prompt, surface it
      if (data.awaitingApproval) {
        setApproval({ runId: data.runId, prompt: data.prompt })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trigger failed')
    } finally {
      setLoading(null)
    }
  }

  async function handleApproval(action: 'approve' | 'cancel') {
    if (!approval) return
    setApprovalLoading(action)
    setError(null)
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: approval.runId, action }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setApproval(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval action failed')
    } finally {
      setApprovalLoading(null)
    }
  }

  const btnBase =
    'inline-flex items-center justify-center gap-2 px-4 py-2 rounded text-sm font-semibold tracking-wide uppercase transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted mb-4">
        Pipeline Controls
      </h2>

      {/* Trigger buttons */}
      <div className="flex flex-wrap gap-3 mb-4">
        <button
          className={`${btnBase} bg-brand-red hover:bg-[#c41f1f] text-white`}
          onClick={() => triggerPipeline('pipeline')}
          disabled={loading !== null}
        >
          {loading === 'pipeline' ? (
            <Spinner />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <polygon points="5,3 19,12 5,21" fill="currentColor" />
            </svg>
          )}
          Run Pipeline
        </button>

        <button
          className={`${btnBase} bg-brand-orange hover:bg-[#d85e22] text-white`}
          onClick={() => triggerPipeline('runway')}
          disabled={loading !== null}
        >
          {loading === 'runway' ? <Spinner /> : null}
          New Runway FX
        </button>

        <button
          className={`${btnBase} border border-border text-text-muted hover:border-text-subtle hover:text-text-primary`}
          onClick={() => triggerPipeline('force')}
          disabled={loading !== null}
        >
          {loading === 'force' ? <Spinner /> : null}
          Force All
        </button>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-brand-red mb-4">{error}</p>
      )}

      {/* Approval gate */}
      {approval && (
        <div className="border border-brand-orange/30 bg-brand-orange/5 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" />
            <span className="text-xs font-semibold tracking-widest uppercase text-brand-orange">
              Awaiting Approval
            </span>
          </div>

          <p className="text-sm text-text-muted mb-1">
            <span className="text-text-subtle text-xs uppercase tracking-wider font-semibold">
              Nemotron Prompt
            </span>
          </p>
          <blockquote className="text-sm text-text-primary bg-input border border-border-input rounded px-3 py-2 mb-4 font-mono leading-relaxed">
            {approval.prompt}
          </blockquote>

          <div className="flex gap-3">
            <button
              className={`${btnBase} bg-brand-red hover:bg-[#c41f1f] text-white`}
              onClick={() => handleApproval('approve')}
              disabled={approvalLoading !== null}
            >
              {approvalLoading === 'approve' ? <Spinner /> : null}
              Approve
            </button>
            <button
              className={`${btnBase} border border-border text-text-muted hover:border-text-subtle hover:text-text-primary`}
              onClick={() => handleApproval('cancel')}
              disabled={approvalLoading !== null}
            >
              {approvalLoading === 'cancel' ? <Spinner /> : null}
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Spinner() {
  return (
    <svg
      className="w-3.5 h-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
      />
    </svg>
  )
}
