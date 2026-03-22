'use client'

import { useEffect, useState } from 'react'

type ServiceData = {
  name: string
  configured: boolean
  status: string
  note: string
  url: string
  costPerRun?: string
  charactersUsed?: number | null
  charactersLimit?: number | null
}

export function ServicesPanel() {
  const [services, setServices] = useState<ServiceData[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/credits')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: { services: ServiceData[] }) => {
        setServices(data.services ?? [])
        setError(null)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load credits')
      })
  }, [])

  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted mb-4">
        Services
      </h2>

      {error && (
        <p className="text-xs text-brand-red mb-3">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {services.map((service) => {
          const elevenlabsBalance =
            service.charactersUsed != null && service.charactersLimit != null
              ? `${service.charactersUsed.toLocaleString()} / ${service.charactersLimit.toLocaleString()} chars`
              : null

          return (
            <a
              key={service.name}
              href={service.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block bg-input border border-border hover:border-border-input rounded-lg p-4 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-text-primary group-hover:text-white transition-colors truncate pr-2">
                  {service.name}
                </span>
                <span
                  className={`status-dot shrink-0 ${service.configured ? 'status-dot--configured' : 'status-dot--unconfigured'}`}
                  title={service.configured ? 'Configured' : 'Not configured'}
                />
              </div>

              <p className="text-xs text-text-muted mb-3">{service.note}</p>

              <div className="flex items-end justify-between gap-2">
                {service.costPerRun && (
                  <div>
                    <p className="text-xs text-text-subtle uppercase tracking-wider mb-0.5">Per Run</p>
                    <p className="text-sm font-mono font-medium text-text-primary">{service.costPerRun}</p>
                  </div>
                )}
                {elevenlabsBalance && (
                  <div className={service.costPerRun ? 'text-right' : ''}>
                    <p className="text-xs text-text-subtle uppercase tracking-wider mb-0.5">Usage</p>
                    <p className="text-xs font-mono font-medium text-text-primary">{elevenlabsBalance}</p>
                  </div>
                )}
                {!service.costPerRun && !elevenlabsBalance && (
                  <p className="text-xs text-text-subtle">{service.status}</p>
                )}
              </div>
            </a>
          )
        })}
      </div>
    </section>
  )
}
