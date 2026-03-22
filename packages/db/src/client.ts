import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null
let _supabaseAnon: SupabaseClient | null = null

function getServiceClient(): SupabaseClient {
  if (_supabase) return _supabase

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url) {
    throw new Error(
      '[db] Missing required environment variable: SUPABASE_URL'
    )
  }
  if (!key) {
    throw new Error(
      '[db] Missing required environment variable: SUPABASE_SERVICE_KEY'
    )
  }

  _supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return _supabase
}

function getAnonClient(): SupabaseClient {
  if (_supabaseAnon) return _supabaseAnon

  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) {
    throw new Error(
      '[db] Missing required environment variable: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL'
    )
  }
  if (!key) {
    throw new Error(
      '[db] Missing required environment variable: SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  _supabaseAnon = createClient(url, key)

  return _supabaseAnon
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getServiceClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

export const supabaseAnon: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getAnonClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})
