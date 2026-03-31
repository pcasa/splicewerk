import { NextResponse } from 'next/server'

const BACKEND = 'http://localhost:3000'

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/projects`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error'
    return NextResponse.json({ error: message, projects: [] }, { status: 502 })
  }
}
