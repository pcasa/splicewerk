-- =============================================================================
-- Migration: adaptive_pipeline_runs — extended run data for adaptive pipeline
-- Stores full manifest (assets, completedSteps) separate from the lean `runs`
-- table to avoid bloating that table with large JSONB payloads.
-- =============================================================================

CREATE TABLE IF NOT EXISTS adaptive_pipeline_runs (
  id              bigserial    PRIMARY KEY,
  run_id          text         NOT NULL UNIQUE REFERENCES runs (run_id) ON DELETE CASCADE,
  user_intent     text         NOT NULL,
  project_dir     text         NOT NULL,
  completed_at    timestamptz,
  final_output    text,
  assets          jsonb        NOT NULL DEFAULT '{}',
  completed_steps jsonb        NOT NULL DEFAULT '[]',
  total_steps     integer      GENERATED ALWAYS AS (jsonb_array_length(completed_steps)) STORED,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_adaptive_runs_run_id      ON adaptive_pipeline_runs (run_id);
CREATE INDEX idx_adaptive_runs_completed   ON adaptive_pipeline_runs (completed_at DESC);

COMMENT ON TABLE adaptive_pipeline_runs IS
  'Extended manifest for each Maverick-orchestrated adaptive pipeline run. '
  'Pairs with the runs table via run_id FK.';

COMMENT ON COLUMN adaptive_pipeline_runs.total_steps IS
  'Auto-computed from completed_steps array length — no manual update needed.';
