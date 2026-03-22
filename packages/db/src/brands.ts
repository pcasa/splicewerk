import { supabase } from './client.js'

export type BrandConfig = {
  name: string
  tagline: string
  industry: string
  mood: string
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
  }
  fonts: {
    heading: string
    body: string
    weight: string
    letterSpacing: string
    taglineOpacity: number
  }
  assets: {
    logo: string
  }
  nemotronContext: string
}

export async function getBrandConfig(slug: string): Promise<BrandConfig | null> {
  const { data, error } = await supabase
    .from('brand_configs')
    .select('config')
    .eq('slug', slug)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  return (data?.config ?? null) as BrandConfig | null
}

export async function upsertBrandConfig(
  slug: string,
  name: string,
  config: BrandConfig
): Promise<void> {
  const { error } = await supabase
    .from('brand_configs')
    .upsert({ slug, name, config }, { onConflict: 'slug' })

  if (error) throw error
}
