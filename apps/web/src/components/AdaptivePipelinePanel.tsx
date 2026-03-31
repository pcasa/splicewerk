'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface PipelineRun {
  runId: string
  userIntent: string
  completedAt: string
  assets: Record<string, string>
  completedSteps: Array<{ id: string; functionName: string; durationMs: number }>
  finalOutput: string | null
}

interface Project {
  name: string
  sessionDir: string
  pipelineRuns: PipelineRun[]
}

const DEFAULT_PROJECT_DIR = '/Users/petercasanova/Projects/splicewerk/projects/test-intro'
const DEFAULT_RAW_FOOTAGE = '/Users/petercasanova/Projects/splicewerk/projects/test-intro/raw/IMG_0295.MOV'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function AdaptivePipelinePanel() {
  const [projectDir, setProjectDir] = useState(DEFAULT_PROJECT_DIR)
  const [rawFootagePath, setRawFootagePath] = useState(DEFAULT_RAW_FOOTAGE)
  const [userIntent, setUserIntent] = useState(
    "Stabilize the raw footage, add a fade in and fade out, add a scrolling title card with the text 'Autobahn Syndicate', generate an end card, then combine the brand intro, title card, faded footage, and end card into a final video."
  )
  const [firing, setFiring] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeVideo, setActiveVideo] = useState<{ url: string; label: string } | null>(null)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) return
      const data = await res.json() as { projects: Project[] }
      setProjects((data.projects ?? []).filter(p => p.pipelineRuns.length > 0))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  const fire = useCallback(async () => {
    if (!projectDir.trim() || !rawFootagePath.trim() || !userIntent.trim()) return
    setFiring(true)
    setError(null)
    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir, rawFootagePath, userIntent }),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fire pipeline')
    } finally {
      setFiring(false)
    }
  }, [projectDir, rawFootagePath, userIntent])

  const openVideo = useCallback((path: string, label: string) => {
    const url = `http://localhost:3000/media/${path}`
    setActiveVideo({ url, label })
  }, [])

  const closeVideo = useCallback(() => {
    setActiveVideo(null)
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = '' }
  }, [])

  return (
    <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-5">
      <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted">
        Adaptive AI Pipeline
      </h2>

      {/* Fire form */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-subtle">Project Directory</label>
          <input
            className="w-full bg-input border border-border rounded px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-brand-orange"
            value={projectDir}
            onChange={e => setProjectDir(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-subtle">Raw Footage Path</label>
          <input
            className="w-full bg-input border border-border rounded px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-brand-orange"
            value={rawFootagePath}
            onChange={e => setRawFootagePath(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-subtle">Intent</label>
          <textarea
            rows={3}
            className="w-full bg-input border border-border rounded px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-brand-orange resize-none"
            value={userIntent}
            onChange={e => setUserIntent(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fire}
            disabled={firing}
            className="px-4 py-2 text-xs font-semibold tracking-widest uppercase bg-brand-red hover:bg-[#c02020] disabled:opacity-40 text-white rounded transition-colors"
          >
            {firing ? 'Firing...' : 'Run Pipeline'}
          </button>
          <button
            onClick={loadProjects}
            disabled={loading}
            className="text-xs text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {error && <p className="text-xs text-brand-red">{error}</p>}
      </div>

      {/* Video player */}
      {activeVideo && (
        <div className="rounded-lg overflow-hidden border border-border bg-black">
          <div className="flex items-center justify-between px-3 py-2 bg-input border-b border-border">
            <span className="text-xs font-mono text-text-muted truncate">{activeVideo.label}</span>
            <button onClick={closeVideo} className="text-xs text-text-muted hover:text-text-primary ml-3 shrink-0">✕ Close</button>
          </div>
          <video ref={videoRef} src={activeVideo.url} controls autoPlay className="w-full max-h-[360px] bg-black" />
        </div>
      )}

      {/* Projects with runs */}
      {projects.length === 0 && !loading && (
        <p className="text-xs text-text-subtle text-center py-3">No pipeline runs yet</p>
      )}

      <div className="flex flex-col gap-4">
        {projects.map(project => (
          <div key={project.sessionDir} className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-text-subtle uppercase tracking-wider">{project.name}</p>

            {project.pipelineRuns.map(run => {
              const isExpanded = expandedRun === run.runId
              return (
                <div key={run.runId} className="border border-border rounded-lg overflow-hidden">
                  {/* Run header */}
                  <button
                    onClick={() => setExpandedRun(isExpanded ? null : run.runId)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-input hover:bg-[#2a2a2a] transition-colors text-left"
                  >
                    <span className="text-green-400 text-xs shrink-0">✓</span>
                    <span className="text-xs font-mono text-text-muted truncate flex-1">{run.runId}</span>
                    <span className="text-xs text-text-subtle shrink-0">{formatDate(run.completedAt)}</span>
                    <span className="text-xs text-text-muted shrink-0">{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {isExpanded && (
                    <div className="px-3 py-3 flex flex-col gap-3 border-t border-border">
                      {/* Intent */}
                      <p className="text-xs text-text-muted italic">"{run.userIntent}"</p>

                      {/* Final output */}
                      {run.finalOutput && (
                        <button
                          onClick={() => openVideo(run.finalOutput!, 'Final Output')}
                          className="self-start px-3 py-1.5 text-xs font-semibold bg-brand-orange hover:bg-[#d45e1c] text-white rounded transition-colors"
                        >
                          ▶ Play Final Output
                        </button>
                      )}

                      {/* Assets */}
                      <div className="flex flex-col gap-1">
                        <p className="text-xs text-text-subtle uppercase tracking-wider">Assets</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(run.assets)
                            .filter(([, v]) => v && (v.endsWith('.mp4') || v.endsWith('.MOV') || v.endsWith('.mov')))
                            .map(([key, filePath]) => (
                              <button
                                key={key}
                                onClick={() => openVideo(filePath, key)}
                                className="px-2 py-1 text-xs bg-input border border-border hover:border-brand-orange rounded font-mono text-text-muted hover:text-text-primary transition-colors"
                              >
                                {key}
                              </button>
                            ))}
                        </div>
                      </div>

                      {/* Steps */}
                      <div className="flex flex-col gap-1">
                        <p className="text-xs text-text-subtle uppercase tracking-wider">Steps ({run.completedSteps.length})</p>
                        <div className="flex flex-col gap-0.5">
                          {run.completedSteps.map((s, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-text-muted font-mono">
                              <span className="text-green-400 shrink-0">✓</span>
                              <span className="flex-1">{s.functionName}</span>
                              <span className="text-text-subtle shrink-0">{(s.durationMs / 1000).toFixed(1)}s</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
