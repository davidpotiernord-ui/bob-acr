-- Migration : activation / désactivation du socle mutualisé A.C.R. par tenant
-- avec cloisonnement strict via PostgreSQL Row Level Security (RLS)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS use_shared_base BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_documents ON documents;
CREATE POLICY tenant_isolation_documents ON documents
  FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR (
      is_shared_base = true
      AND EXISTS (
        SELECT 1
        FROM tenants t
        WHERE t.id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          AND COALESCE(t.use_shared_base, true) = true
      )
    )
  );

DROP POLICY IF EXISTS tenant_isolation_chunks ON document_chunks;
CREATE POLICY tenant_isolation_chunks ON document_chunks
  FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR (
      is_shared_base = true
      AND EXISTS (
        SELECT 1
        FROM tenants t
        WHERE t.id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          AND COALESCE(t.use_shared_base, true) = true
      )
    )
  );
