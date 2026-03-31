-- =============================================================================
-- Migration: add fal-ai to cost_ledger service constraint
-- =============================================================================

-- Drop existing CHECK and re-add with fal-ai included
ALTER TABLE cost_ledger
  DROP CONSTRAINT IF EXISTS cost_ledger_service_check;

ALTER TABLE cost_ledger
  ADD CONSTRAINT cost_ledger_service_check
    CHECK (service IN ('runway', 'shotstack', 'nim', 'elevenlabs', 'fal-ai', 'supabase'));
