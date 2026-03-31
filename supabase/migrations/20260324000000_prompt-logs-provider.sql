-- =============================================================================
-- Migration: enrich prompt_logs with provider column
-- Adds provider ('nim' | 'ollama') and fixes the source CHECK constraint
-- to include the 'generate-edl' value already used by the application.
-- =============================================================================

-- Add provider column
ALTER TABLE prompt_logs
  ADD COLUMN IF NOT EXISTS provider text
    CHECK (provider IN ('nim', 'ollama'));

-- Fix source constraint to include 'generate-edl'
ALTER TABLE prompt_logs
  DROP CONSTRAINT IF EXISTS prompt_logs_source_check;

ALTER TABLE prompt_logs
  ADD CONSTRAINT prompt_logs_source_check
    CHECK (source IN ('ui-chat', 'pipeline', 'pipeline-baseline', 'generate-edl'));

CREATE INDEX IF NOT EXISTS idx_prompt_logs_provider ON prompt_logs (provider);
