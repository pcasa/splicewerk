-- =============================================================================
-- Storage Buckets
-- =============================================================================
-- Three buckets matching the CHECK constraint in the assets table:
--   brand-assets      — logos, fonts, brand files (private)
--   generated-outputs — final rendered videos (private)
--   mobile-uploads    — raw iPhone footage via iCloud ingest (private)
--
-- All buckets are private by default. Public URLs are generated via
-- signed URLs or the storage.getPublicUrl() helper with service role key.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'brand-assets',
    'brand-assets',
    false,
    52428800,  -- 50 MB limit (logos, fonts — should be small)
    ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'font/ttf', 'font/otf', 'application/octet-stream']
  ),
  (
    'generated-outputs',
    'generated-outputs',
    false,
    2147483648,  -- 2 GB limit (final rendered 1080p videos)
    ARRAY['video/mp4', 'video/quicktime', 'video/x-msvideo']
  ),
  (
    'mobile-uploads',
    'mobile-uploads',
    false,
    5368709120,  -- 5 GB limit (raw 4K iPhone footage)
    ARRAY['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']
  )
ON CONFLICT (id) DO NOTHING;
