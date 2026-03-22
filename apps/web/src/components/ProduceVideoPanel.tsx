'use client'

import { useCallback, useRef, useState } from 'react'

type UploadState = 'idle' | 'uploading' | 'ready' | 'producing' | 'done' | 'error'

export function ProduceVideoPanel() {
  const [files, setFiles] = useState<File[]>([])
  const [sessionDir, setSessionDir] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [projectName, setProjectName] = useState('')
  const [state, setState] = useState<UploadState>('idle')
  const [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const uploadFiles = useCallback(async (newFiles: File[]) => {
    if (newFiles.length === 0) return
    setState('uploading')
    setError(null)
    const form = new FormData()
    for (const f of newFiles) form.append('file', f)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)
      const data = await res.json()
      setSessionDir(data.sessionDir)
      setFiles(prev => [...prev, ...newFiles])
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setState('error')
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = Array.from(e.dataTransfer.files)
    uploadFiles(dropped)
  }, [uploadFiles])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    uploadFiles(selected)
  }, [uploadFiles])

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const produce = async () => {
    if (!sessionDir || !prompt.trim()) return
    setState('producing')
    setError(null)
    try {
      const res = await fetch('/api/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionDir,
          prompt: prompt.trim(),
          projectName: projectName.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRunId(data.id)
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Production failed')
      setState('error')
    }
  }

  const reset = () => {
    setFiles([])
    setSessionDir(null)
    setPrompt('')
    setProjectName('')
    setState('idle')
    setRunId(null)
    setError(null)
  }

  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted">
          Produce Video
        </h2>
        {(state === 'done' || state === 'error') && (
          <button onClick={reset} className="text-xs text-text-muted hover:text-text-primary transition-colors">
            Reset
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4
          ${isDragging ? 'border-brand-red bg-brand-red/5' : 'border-[#3A3A3A] hover:border-[#555555]'}
          ${state === 'uploading' ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,image/*"
          className="hidden"
          onChange={onFileChange}
        />
        {state === 'uploading' ? (
          <p className="text-sm text-text-muted">Uploading...</p>
        ) : (
          <>
            <p className="text-sm text-text-muted">Drop videos &amp; images here</p>
            <p className="text-xs text-text-subtle mt-1">or click to browse</p>
          </>
        )}
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-1 mb-4">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between px-3 py-1.5 rounded bg-input border border-border">
              <span className="text-xs font-mono text-text-muted truncate">{f.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="text-xs text-text-subtle hover:text-brand-red ml-3 shrink-0 transition-colors"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Project name */}
      <input
        type="text"
        value={projectName}
        onChange={e => setProjectName(e.target.value)}
        placeholder="Project name (optional)"
        className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle mb-3 focus:outline-none focus:border-border-input"
      />

      {/* Prompt */}
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder={`Describe what you want...\n\nExample: Use clip1.mov from 0:15 to 0:47, then clip2.mov from 1:00 to 1:30. Add our brand intro at the start. Show the product image at the end for 5 seconds with the text "Shop now at autobahnsyndicate.com".`}
        rows={6}
        className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle mb-4 focus:outline-none focus:border-border-input resize-none"
      />

      {/* Error */}
      {error && <p className="text-xs text-brand-red mb-3">{error}</p>}

      {/* Done state */}
      {state === 'done' && runId && (
        <div className="mb-4 px-3 py-2.5 rounded bg-input border border-border">
          <p className="text-xs text-text-muted mb-1">Pipeline started</p>
          <a
            href={`http://localhost:8288/runs/${runId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-brand-red hover:underline break-all"
          >
            {runId}
          </a>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={produce}
        disabled={!sessionDir || !prompt.trim() || state === 'producing' || state === 'uploading'}
        className="w-full py-2.5 rounded bg-brand-red text-white text-sm font-semibold tracking-wide uppercase hover:bg-brand-red/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {state === 'producing' ? 'Starting pipeline...' : 'Produce Video'}
      </button>
    </section>
  )
}
