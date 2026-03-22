-- =============================================================================
-- Splicewerk Video Production Platform — Initial Schema
-- =============================================================================


-- =============================================================================
-- UTILITY: update_updated_at trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- =============================================================================
-- TABLE: runs
-- Persistent pipeline run history. Mirrors Inngest runs but survives
-- local dev restarts.
-- =============================================================================

CREATE TABLE runs (
  id             bigserial    PRIMARY KEY,
  run_id         text         NOT NULL UNIQUE,
  function_id    text         NOT NULL,
  status         text         NOT NULL
                              CHECK (status IN ('Running', 'Sleeping', 'Completed', 'Failed', 'Cancelled')),
  started_at     timestamptz  NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  prompt_used    text,
  output_url     text,
  cost_estimate  jsonb,
  created_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_runs_started_at ON runs (started_at DESC);
CREATE INDEX idx_runs_status     ON runs (status);


-- =============================================================================
-- TABLE: brand_configs
-- Mirrors brand.json but stored in DB for future multi-brand support.
-- =============================================================================

CREATE TABLE brand_configs (
  id          bigserial    PRIMARY KEY,
  slug        text         NOT NULL UNIQUE,
  name        text         NOT NULL,
  config      jsonb        NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_brand_configs_updated_at
  BEFORE UPDATE ON brand_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();


-- =============================================================================
-- TABLE: assets
-- Every file stored in Supabase Storage.
-- =============================================================================

CREATE TABLE assets (
  id             bigserial    PRIMARY KEY,
  bucket         text         NOT NULL
                              CHECK (bucket IN ('brand-assets', 'generated-outputs', 'mobile-uploads')),
  path           text         NOT NULL,
  url            text         NOT NULL,
  type           text         NOT NULL
                              CHECK (type IN ('logo', 'output', 'raw', 'audio', 'font')),
  mime_type      text,
  size_bytes     bigint,
  duration_ms    integer,
  thumbnail_url  text,
  created_at     timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (bucket, path)
);

CREATE INDEX idx_assets_type   ON assets (type);
CREATE INDEX idx_assets_bucket ON assets (bucket);


-- =============================================================================
-- TABLE: clips
-- Trim points and notes — one asset can have multiple named clips.
-- =============================================================================

CREATE TABLE clips (
  id             bigserial    PRIMARY KEY,
  asset_id       bigint       NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  label          text,
  trim_start_ms  integer,
  trim_end_ms    integer,
  notes          text,
  created_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_clips_asset_id ON clips (asset_id);


-- =============================================================================
-- TABLE: tags
-- Canonical tag registry — single source of truth, no duplicates.
-- =============================================================================

CREATE TABLE tags (
  id          bigserial    PRIMARY KEY,
  name        text         NOT NULL UNIQUE,
  color       text,
  created_at  timestamptz  NOT NULL DEFAULT now()
);


-- =============================================================================
-- TABLE: clip_tags
-- Many-to-many junction: clips <-> tags.
-- =============================================================================

CREATE TABLE clip_tags (
  clip_id  bigint  NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
  tag_id   bigint  NOT NULL REFERENCES tags  (id) ON DELETE CASCADE,

  PRIMARY KEY (clip_id, tag_id)
);

CREATE INDEX idx_clip_tags_tag_id ON clip_tags (tag_id);


-- =============================================================================
-- TABLE: run_clips
-- Junction: which clip was used in which pipeline run.
-- =============================================================================

CREATE TABLE run_clips (
  run_id   text    NOT NULL,
  clip_id  bigint  NOT NULL REFERENCES clips (id),
  role     text    CHECK (role IN ('audio', 'b-roll', 'overlay')),

  PRIMARY KEY (run_id, clip_id)
);


-- =============================================================================
-- TABLE: cost_ledger
-- One row per billable operation in any pipeline run.
-- =============================================================================

CREATE TABLE cost_ledger (
  id         bigserial      PRIMARY KEY,
  run_id     text           NOT NULL,
  service    text           NOT NULL
                            CHECK (service IN ('runway', 'shotstack', 'nim', 'elevenlabs', 'supabase')),
  operation  text           NOT NULL,
  units      numeric,
  unit_type  text,
  cost_usd   numeric(10,4),
  metadata   jsonb,
  created_at timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX idx_cost_ledger_run_id     ON cost_ledger (run_id);
CREATE INDEX idx_cost_ledger_service    ON cost_ledger (service);
CREATE INDEX idx_cost_ledger_created_at ON cost_ledger (created_at DESC);


-- =============================================================================
-- TABLE: prompt_logs
-- Every NIM/Nemotron call logged with full input/output and metadata.
-- =============================================================================

CREATE TABLE prompt_logs (
  id           bigserial    PRIMARY KEY,
  run_id       text,
  source       text         NOT NULL
                            CHECK (source IN ('ui-chat', 'pipeline', 'pipeline-baseline')),
  step         text,
  model        text         NOT NULL,
  messages_in  jsonb        NOT NULL,
  response_out text,
  tokens_used  integer,
  latency_ms   integer,
  metadata     jsonb,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_prompt_logs_run_id     ON prompt_logs (run_id);
CREATE INDEX idx_prompt_logs_source     ON prompt_logs (source);
CREATE INDEX idx_prompt_logs_created_at ON prompt_logs (created_at DESC);


-- =============================================================================
-- VIEW: run_costs
-- Aggregated cost per run from cost_ledger.
-- =============================================================================

CREATE VIEW run_costs AS
WITH service_totals AS (
  SELECT run_id, service, SUM(cost_usd) AS service_usd
  FROM cost_ledger
  GROUP BY run_id, service
),
service_json AS (
  SELECT run_id, jsonb_object_agg(service, service_usd) AS by_service
  FROM service_totals
  GROUP BY run_id
)
SELECT
  cl.run_id,
  SUM(cl.cost_usd)                                            AS total_usd,
  sj.by_service,
  COUNT(*) FILTER (WHERE cl.metadata->>'retried' = 'true')    AS retry_count
FROM cost_ledger cl
JOIN service_json sj ON sj.run_id = cl.run_id
GROUP BY cl.run_id, sj.by_service;
