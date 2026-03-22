import { NextRequest, NextResponse } from 'next/server'

const BACKEND = 'http://localhost:3000'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const backendForm = new FormData()
    for (const [key, value] of formData.entries()) {
      backendForm.append(key, value)
    }
    const res = await fetch(`${BACKEND}/api/upload`, {
      method: 'POST',
      body: backendForm,
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const config = { api: { bodyParser: false } }
