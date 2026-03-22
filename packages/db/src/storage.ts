import { supabase } from './client.js'

export type UploadResult = { ok: true; url: string } | { ok: false; error: string }
export type AssetType = 'logo' | 'output' | 'raw' | 'audio' | 'font'

export async function uploadAsset(
  bucket: string,
  path: string,
  file: Buffer | Blob,
  mimeType: string
): Promise<UploadResult> {
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: mimeType, upsert: true })

  if (uploadError) {
    return { ok: false, error: uploadError.message }
  }

  const url = getPublicUrl(bucket, path)

  const { error: upsertError } = await supabase
    .from('assets')
    .upsert({ bucket, path, url, mime_type: mimeType }, { onConflict: 'bucket,path' })

  if (upsertError) {
    return { ok: false, error: upsertError.message }
  }

  return { ok: true, url }
}

export function getPublicUrl(bucket: string, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

export async function assetExists(bucket: string, path: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('assets')
    .select('path')
    .eq('bucket', bucket)
    .eq('path', path)
    .maybeSingle()

  if (error) throw error
  return data !== null
}
