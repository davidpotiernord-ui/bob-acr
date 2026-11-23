-- ============================================================================
-- SCHÉMA DE BASE DE DONNÉES — PROJET BOB (A.C.R.)
-- Environnement : PostgreSQL 15+ avec extension pgvector (Hébergement Scalingo)
-- ============================================================================

-- 1. EXTENSIONS REQUISES
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- Génération d'UUID v4 sécurisés
CREATE EXTENSION IF NOT EXISTS "vector";   -- Recherche sémantique RAG (pgvector)

-- 2. ENTREPRISES CLIENTES (TENANTS) & MODULES SOUSCRITS
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    country_code VARCHAR(2) NOT NULL DEFAULT 'FR', -- FR, BE, LU, CH, DE
    sso_provider VARCHAR(50),                      -- 'microsoft_entra', 'google_workspace', etc.
    sso_tenant_identifier VARCHAR(255) UNIQUE,     -- ID annuaire client pour routage automatique
    plan_tier VARCHAR(50) NOT NULL DEFAULT 'essentiel', -- 'essentiel', 'conformite_plus', 'sur_mesure'
    active_modules JSONB NOT NULL DEFAULT '{
        "socle_ri": true,
        "rgpd": false,
        "cyber": false,
        "sapin_ii": false,
        "lcb_ft": false
    }'::jsonb,
    escalation_contacts JSONB NOT NULL DEFAULT '{}'::jsonb, -- Ex: {"rgpd": "dpo@client.fr", "cyber": "rssi@client.fr"}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. UTILISATEURS & ADMINISTRATEURS (AUTHENTIFIÉS VIA SSO)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sso_subject_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'employee', -- 'employee', 'admin_rh', 'admin_dpo', 'admin_rssi', 'super_admin'
    department VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, sso_subject_id)
);

-- 4. COFFRE-FORT DOCUMENTAIRE & TRAÇABILITÉ DES VERSIONS (ART. R. 1321-1)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = document du socle légal mutualisé A.C.R.
    is_shared_base BOOLEAN NOT NULL DEFAULT FALSE,
    module_code VARCHAR(50) NOT NULL, -- 'socle_ri', 'rgpd', 'cyber', 'sapin_ii', 'lcb_ft'
    title VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL DEFAULT '1.0',
    sha256_hash CHAR(64) NOT NULL,    -- Empreinte cryptographique prouvant l'intégrité du fichier
    file_url TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'draft', -- 'draft', 'active', 'archived'
    audience_scope VARCHAR(100) NOT NULL DEFAULT 'all', -- 'all', 'managers', 'it', 'sales'
    requires_acknowledgment BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. SEGMENTS VECTORISÉS POUR LE MOTEUR RAG (PGVECTOR)
-- Dimension 1536 (standard OpenAI text-embedding-3-small) ou 1024 (Mistral Embed)
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- Dupliqué pour filtrage ultra-rapide
    is_shared_base BOOLEAN NOT NULL DEFAULT FALSE,
    module_code VARCHAR(50) NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    page_number INTEGER,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index vectoriel HNSW pour des recherches sémantiques en quelques millisecondes
CREATE INDEX idx_document_chunks_embedding ON document_chunks 
USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_document_chunks_tenant ON document_chunks (tenant_id, module_code);

-- 6. ACCUSÉS DE PRISE DE CONNAISSANCE (OPTIONNEL PAR DOCUMENT MAJEUR)
CREATE TABLE acknowledgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_version VARCHAR(50) NOT NULL,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, user_id, document_version)
);

-- 7. JOURNAL DES CONSULTATIONS & ZONES DE FRICTION (100 % ANONYMISÉ RGPD)
-- Aucune colonne user_id ici : garantit l'anonymat total des questions des salariés
CREATE TABLE query_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL,      -- 'teams', 'chrome_extension', 'edge_extension'
    module_code VARCHAR(50),           -- Thème détecté ('socle_ri', 'rgpd', 'cyber', etc.)
    question_topic VARCHAR(255),       -- Résumé thématique ou question anonymisée
    cited_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    confidence_score NUMERIC(4,3),     -- Score de similarité RAG (0.000 à 1.000)
    unanswered_flag BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = hors documentation (remonte au Radar Admin)
    was_escalated BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE = mis en relation avec un référent métier
    escalated_to_role VARCHAR(50),     -- 'dpo', 'rssi', 'drh', 'juridique'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_query_logs_tenant_date ON query_logs (tenant_id, created_at DESC);
CREATE INDEX idx_query_logs_unanswered ON query_logs (tenant_id, unanswered_flag) WHERE unanswered_flag = TRUE;

-- 8. JOURNAL D'AUDIT DES ACTIONS ADMINISTRATEURS (PREUVE DE GOUVERNANCE)
CREATE TABLE admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action_type VARCHAR(100) NOT NULL, -- 'DOCUMENT_PUBLISHED', 'DOCUMENT_ARCHIVED', 'PROOF_EXPORTED', 'MODULE_UPDATED'
    target_entity_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- Contient le hash SHA-256, la version, l'IP, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 9. VERROU DE SÉCURITÉ MULTI-TENANT (ROW-LEVEL SECURITY)
-- Empêche toute lecture/écriture hors du tenant_id actif dans la session SQL
-- ============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Politique stricte sur les utilisateurs, accusés, logs et audits
CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_acknowledgments ON acknowledgments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_query_logs ON query_logs
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_admin_audit ON admin_audit_logs
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Politique hybride sur les documents et chunks :
-- Le client voit SES documents privés + uniquement les documents du socle mutualisé (is_shared_base = true)
CREATE POLICY tenant_isolation_documents ON documents
    USING (
        is_shared_base = TRUE 
        OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
    );

CREATE POLICY tenant_isolation_chunks ON document_chunks
    USING (
        is_shared_base = TRUE 
        OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
    );
