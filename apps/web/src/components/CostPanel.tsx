'use client'

import { useEffect, useState } from 'react'

type RunCostSummary = {
  run_id: string
  total_usd: number
  by_service: Record<string, number>
  retry_count: number
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`
}

function truncateRunId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id
}

export function CostPanel() {
  const [summary, setSummary] = useState<RunCostSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  async function fetchCosts() {
    try {
      const res = await fetch('/api/costs')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSummary(data.summary ?? [])
      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load costs')
    }
  }

  useEffect(() => {
    fetchCosts()
    const interval = setInterval(fetchCosts, 30000)
    return () => clearInterval(interval)
  }, [])

  const totalAllRuns = summary.reduce((sum, r) => sum + (r.total_usd ?? 0), 0)

  const serviceAggregates: Record<string, number> = {}
  for (const row of summary) {
    for (const [service, usd] of Object.entries(row.by_service ?? {})) {
      serviceAggregates[service] = (serviceAggregates[service] ?? 0) + usd
    }
  }

  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted">
          Cost Monitor
        </h2>
        {lastUpdated && (
          <span className="text-xs text-text-subtle">Updated {lastUpdated}</span>
        )}
      </div>

      {error && (
        <p className="text-xs text-brand-red mb-3">{error}</p>
      )}

      {!error && summary.length === 0 && (
        <p className="text-sm text-text-subtle py-4 text-center">No cost data yet — run the pipeline to see costs</p>
      )}

      {summary.length > 0 && (
        <>
          {/* Totals row */}
          <div className="flex items-baseline justify-between mb-4 px-3 py-2.5 rounded bg-input border border-border">
            <span className="text-xs text-text-muted uppercase tracking-wider">All runs total</span>
            <span className="text-sm font-mono font-semibold text-text-primary">{formatUsd(totalAllRuns)}</span>
          </div>

          {/* Per-service breakdown */}
          {Object.keys(serviceAggregates).length > 0 && (
            <div className="mb-4 space-y-1">
              {Object.entries(serviceAggregates)
                .sort(([, a], [, b]) => b - a)
                .map(([service, usd]) => (
                  <div key={service} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-xs text-text-muted capitalize">{service}</span>
                    <span className="text-xs font-mono text-text-primary">{formatUsd(usd)}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Per-run list */}
          <div className="border-t border-border pt-3">
            <p className="text-xs text-text-subtle uppercase tracking-wider mb-2 px-1">Per run</p>
            <ul className="space-y-1">
              {summary.map((row) => (
                <li key={row.run_id} className="flex items-center justify-between px-3 py-1.5 rounded hover:bg-input transition-colors">
                  <span className="text-xs font-mono text-text-muted">{truncateRunId(row.run_id)}</span>
                  {row.retry_count > 0 && (
                    <span className="text-xs text-brand-orange mx-2">{row.retry_count} retries</span>
                  )}
                  <span className="text-xs font-mono text-text-primary ml-auto">{formatUsd(row.total_usd)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
