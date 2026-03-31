import { NextRequest, NextResponse } from 'next/server'

const BACKEND = 'http://localhost:3000'

export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const res = await fetch(
      `${BACKEND}/api/validation/${encodeURIComponent(params.runId)}`
    )
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
