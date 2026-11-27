-- Journal d'erreurs techniques par tenant pour la maintenance Console Provider
-- Aucune PII salarié ni prompt/réponse : uniquement codes techniques et diagnostics système

CREATE TABLE IF NOT EXISTS provider_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL,        -- 'rag_query', 'embedding_ingestion', 'sso_auth', 'database', 'api_gateway'
    severity VARCHAR(20) NOT NULL DEFAULT 'error', -- 'warning', 'error', 'critical'
    error_code VARCHAR(100),              -- Ex. 'MISTRAL_TIMEOUT', 'PGVECTOR_ERROR', 'OIDC_CALLBACK_FAIL'
    summary VARCHAR(500) NOT NULL,        -- Message technique sanitizé (sans PII ni contenu prompt)
    endpoint VARCHAR(150),                -- Route concernée (ex. 'POST /api/query')
    resolved_at TIMESTAMPTZ,              -- NULL = incident ouvert, horodaté = acquitté en maintenance
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_error_logs_tenant_date
  ON provider_error_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_error_logs_unresolved
  ON provider_error_logs (resolved_at) WHERE resolved_at IS NULL;

ALTER TABLE provider_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_error_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_only_error_logs ON provider_error_logs;
CREATE POLICY provider_only_error_logs ON provider_error_logs
  FOR ALL
  USING (current_setting('app.provider_mode', true) = 'on')
  WITH CHECK (current_setting('app.provider_mode', true) = 'on');
