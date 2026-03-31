'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface VideoFile {
  name: string
  path: string
  size: number
  mtime: number
}

interface Project {
  sessionDir: string
  name: string
  files: VideoFile[]
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function ProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeVideo, setActiveVideo] = useState<{ url: string; name: string } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { projects: Project[]; error?: string }
      setProjects(data.projects ?? [])
      if (data.error) setError(data.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openVideo = useCallback((file: VideoFile) => {
    // Backend serves files at /media/{path}
    const url = `http://localhost:3000/media/${file.path}`
    setActiveVideo({ url, name: file.name })
  }, [])

  const closeVideo = useCallback(() => {
    setActiveVideo(null)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.src = ''
    }
  }, [])

  const downloadVideo = useCallback((file: VideoFile) => {
    const url = `http://localhost:3000/media/${file.path}`
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
  }, [])

  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted">
          Output Videos
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

      {/* Video player modal */}
      {activeVideo && (
        <div className="mb-4 rounded-lg overflow-hidden border border-border bg-black relative">
          <div className="flex items-center justify-between px-3 py-2 bg-input border-b border-border">
            <span className="text-xs font-mono text-text-muted truncate">{activeVideo.name}</span>
            <button
              onClick={closeVideo}
              className="text-xs text-text-muted hover:text-text-primary transition-colors ml-3 shrink-0"
            >
              ✕ Close
            </button>
          </div>
          <video
            ref={videoRef}
            src={activeVideo.url}
            controls
            autoPlay
            className="w-full max-h-[360px] bg-black"
          />
        </div>
      )}

      {!loading && projects.length === 0 && !error && (
        <p className="text-xs text-text-subtle text-center py-4">
          No output videos yet — run the enhance pipeline to get started
        </p>
      )}

      <div className="flex flex-col gap-3">
        {projects.map((project) => (
          <div key={project.sessionDir} className="flex flex-col gap-1.5">
            <p className="text-xs text-text-subtle font-mono tracking-wide">
              {project.name}
            </p>
            {project.files.map((file) => {
              const isActive = activeVideo?.name === file.name
              return (
                <div
                  key={file.path}
                  className={`flex items-center gap-2 px-3 py-2 rounded border transition-colors ${
                    isActive
                      ? 'border-brand-orange bg-brand-orange/5'
                      : 'border-border bg-input hover:border-[#555555]'
                  }`}
                >
                  {/* Play / stop icon */}
                  <button
                    onClick={() => isActive ? closeVideo() : openVideo(file)}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded bg-brand-red hover:bg-[#c02020] transition-colors"
                    title={isActive ? 'Stop' : 'Play'}
                  >
                    {isActive ? (
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="4" width="4" height="16" rx="1"/>
                        <rect x="14" y="4" width="4" height="16" rx="1"/>
                      </svg>
                    ) : (
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    )}
                  </button>

                  <span className="text-xs font-mono text-text-primary truncate flex-1">
                    {file.name}
                  </span>

                  <span className="text-xs text-text-subtle shrink-0">
                    {formatBytes(file.size)}
                  </span>

                  <span className="text-xs text-text-subtle shrink-0 hidden sm:block">
                    {formatDate(file.mtime)}
                  </span>

                  {/* Download */}
                  <button
                    onClick={() => downloadVideo(file)}
                    title="Download"
                    className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
