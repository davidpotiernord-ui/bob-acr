-- Migration complémentaire : configuration OIDC par tenant & sessions utilisateurs
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS sso_issuer_url TEXT,
    ADD COLUMN IF NOT EXISTS sso_client_id TEXT,
    ADD COLUMN IF NOT EXISTS sso_client_secret TEXT,
    ADD COLUMN IF NOT EXISTS sso_authorize_url TEXT,
    ADD COLUMN IF NOT EXISTS sso_token_url TEXT,
    ADD COLUMN IF NOT EXISTS sso_userinfo_url TEXT,
    ADD COLUMN IF NOT EXISTS sso_scopes TEXT NOT NULL DEFAULT 'openid profile email';

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    auth_method VARCHAR(30) NOT NULL, -- 'sso' ou 'local_email'
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash
    ON user_sessions (token_hash)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_tenant_user
    ON user_sessions (tenant_id, user_id);
