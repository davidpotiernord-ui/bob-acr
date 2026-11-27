-- Enrichissement du journal d'erreurs Provider :
-- regroupement des incidents répétitifs, code HTTP et remédiation recommandée

ALTER TABLE provider_error_logs
  ADD COLUMN IF NOT EXISTS http_status INTEGER,
  ADD COLUMN IF NOT EXISTS occurrences_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS recommended_action VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_provider_error_logs_dedup
  ON provider_error_logs (tenant_id, category, error_code, endpoint)
  WHERE resolved_at IS NULL;
