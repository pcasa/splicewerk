import { NextRequest } from 'next/server'

const BACKEND = 'http://localhost:3000'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await fetch(`${BACKEND}/api/nemotron`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return new Response(res.body, {
      status: res.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error'
    return new Response(
      `event: error\ndata: ${JSON.stringify(message)}\n\n`,
      { status: 502, headers: { 'Content-Type': 'text/event-stream' } }
    )
  }
}
