-- Sécurisation RLS : évite le cast ::uuid sur chaîne vide ('') et autorise le mode Provider agrégé

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename IN ('users', 'documents', 'document_chunks', 'acknowledgments', 'query_logs', 'admin_audit_logs')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

CREATE POLICY tenant_isolation_users ON users
  FOR ALL
  USING (
    current_setting('app.provider_mode', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_acknowledgments ON acknowledgments
  FOR ALL
  USING (
    current_setting('app.provider_mode', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_query_logs ON query_logs
  FOR ALL
  USING (
    current_setting('app.provider_mode', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_admin_audit ON admin_audit_logs
  FOR ALL
  USING (
    current_setting('app.provider_mode', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_documents ON documents
  FOR ALL
  USING (
    current_setting('app.provider_mode', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR (
      is_shared_base = true
      AND EXISTS (
        SELECT 1 FROM tenants t
        WHERE t.id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          AND COALESCE(t.use_shared_base, true) = true
      )
    )
  );

CREATE POLICY tenant_isolation_chunks ON document_chunks
  FOR ALL
  USING (
    current_setting('app.provider_mode', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR (
      is_shared_base = true
      AND EXISTS (
        SELECT 1 FROM tenants t
        WHERE t.id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          AND COALESCE(t.use_shared_base, true) = true
      )
    )
  );
