'use client'

import { useCallback, useRef, useState } from 'react'

type PanelState = 'idle' | 'uploading' | 'ready' | 'enhancing' | 'done' | 'error'

interface Props {
  onRunComplete?: (sessionDirName: string) => void
}

export function EnhanceFootagePanel({ onRunComplete }: Props) {
  const [state, setState] = useState<PanelState>('idle')
  const [uploadedFile, setUploadedFile] = useState<{ sessionDir: string; filePath: string; name: string } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [jobDescription, setJobDescription] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const uploadFile = useCallback(async (file: File) => {
    setState('uploading')
    setError(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)
      const data = await res.json() as { sessionDir: string; files: string[] }
      const safeName = data.files[0]
      if (!safeName) throw new Error('No file returned from upload')
      setUploadedFile({
        sessionDir: data.sessionDir,
        filePath: `${data.sessionDir}/raw/${safeName}`,
        name: file.name,
      })
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setState('error')
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }, [uploadFile])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
  }, [uploadFile])

  const enhance = async () => {
    if (!uploadedFile) return
    setState('enhancing')
    setError(null)

    const userIntent = jobDescription.trim() || 'Enhance this footage with brand elements.'

    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawFootagePath: uploadedFile.filePath,
          projectDir:     uploadedFile.sessionDir,
          userIntent,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { id?: string; error?: string }
      if (data.error) throw new Error(data.error)
      setRunId(data.id ?? null)
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enhancement failed')
      setState('error')
    }
  }

  const reviewWithMaverick = async () => {
    if (!uploadedFile || !runId) return
    setValidating(true)
    setError(null)
    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDir: uploadedFile.sessionDir,
          runId,
          pipeline: { userIntent: jobDescription },
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { validation?: unknown; error?: string }
      if (data.error) throw new Error(data.error)
      const dirName = uploadedFile.sessionDir.split('/').pop() ?? uploadedFile.sessionDir
      onRunComplete?.(dirName)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setValidating(false)
    }
  }

  const reset = () => {
    setState('idle')
    setUploadedFile(null)
    setRunId(null)
    setError(null)
    setValidating(false)
  }

  const inputClass =
    'w-full bg-input border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:outline-none focus:border-border-input'

  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-text-muted">
          Enhance Footage
        </h2>
        {(state === 'done' || state === 'error') && (
          <button onClick={reset} className="text-xs text-text-muted hover:text-text-primary transition-colors">
            Reset
          </button>
        )}
      </div>

      {/* Step 1: Upload */}
      {state === 'idle' || state === 'uploading' || state === 'error' ? (
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
            accept="video/*,.mov,.mp4,.MOV,.MP4"
            className="hidden"
            onChange={onFileChange}
          />
          {state === 'uploading' ? (
            <p className="text-sm text-text-muted">Uploading footage...</p>
          ) : (
            <>
              <p className="text-sm text-text-muted">Drop raw footage here</p>
              <p className="text-xs text-text-subtle mt-1">or click to browse · MOV, MP4</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-input border border-border mb-4">
          <svg className="w-4 h-4 text-brand-orange shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82V15.18a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          <span className="text-xs font-mono text-text-muted truncate flex-1">{uploadedFile?.name}</span>
          <span className="text-xs text-brand-orange font-semibold shrink-0">✓ Uploaded</span>
        </div>
      )}

      {/* Step 2: Job description + options */}
      {(state === 'ready' || state === 'enhancing' || state === 'done') && (
        <div className="flex flex-col gap-4">

          {/* Job description */}
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-text-muted mb-1.5">
              Job Description
            </label>
            <p className="text-xs text-text-subtle mb-2">
              Describe what you want — Maverick will figure out the title card, end card, and order.
            </p>
            <textarea
              value={jobDescription}
              onChange={e => setJobDescription(e.target.value)}
              rows={5}
              placeholder="e.g. Mustang dyno run at Autobahn Syndicate. Show title card with mods: resonator delete, stock cats and mufflers. End card: 452HP / 532 FT-Lbs torque."
              className={`${inputClass} resize-none`}
              disabled={state !== 'ready'}
            />
          </div>

          {/* Error */}
          {error && <p className="text-xs text-brand-red">{error}</p>}

          {/* Done state */}
          {state === 'done' && runId && (
            <div className="flex flex-col gap-2">
              <div className="px-3 py-2.5 rounded bg-input border border-border">
                <p className="text-xs text-text-muted mb-1">Adaptive pipeline started</p>
                <a
                  href={`http://localhost:8288/runs/${runId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-brand-red hover:underline break-all"
                >
                  {runId}
                </a>
              </div>
              <button
                onClick={reviewWithMaverick}
                disabled={validating}
                className="w-full py-2.5 rounded bg-brand-red text-white text-sm font-semibold tracking-wide uppercase hover:bg-[#c02020] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {validating ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner /> Asking Maverick...
                  </span>
                ) : (
                  'Review with Maverick'
                )}
              </button>
            </div>
          )}

          {/* Submit */}
          {state !== 'done' && (
            <button
              onClick={enhance}
              disabled={state === 'enhancing' || !jobDescription.trim()}
              className="w-full py-2.5 rounded bg-brand-orange text-white text-sm font-semibold tracking-wide uppercase hover:bg-[#d85e22] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {state === 'enhancing' ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner /> Starting pipeline...
                </span>
              ) : (
                'Enhance Footage'
              )}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  )
}
