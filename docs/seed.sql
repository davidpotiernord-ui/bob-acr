-- ============================================================================
-- JEU DE DONNÉES DE TEST (SEED) — PROJET BOB (A.C.R.)
-- Entreprise fictive : Atelier Métal & Industrie du Sud SAS (80 salariés)
-- ============================================================================

BEGIN;

-- 1. CRÉATION DE L'ENTREPRISE CLIENTE (TENANT)
INSERT INTO tenants (
    id,
    name,
    slug,
    country_code,
    sso_provider,
    sso_tenant_identifier,
    plan_tier,
    active_modules,
    escalation_contacts
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Atelier Métal & Industrie du Sud SAS',
    'atelier-metal-sud',
    'FR',
    'microsoft_entra',
    'entra-tenant-amis-83000',
    'essentiel',
    '{
        "socle_ri": true,
        "rgpd": true,
        "cyber": false,
        "sapin_ii": false,
        "lcb_ft": false
    }'::jsonb,
    '{
        "socle_ri": "drh@atelier-metal-sud.fr",
        "rgpd": "dpo@atelier-metal-sud.fr",
        "cyber": "it-securite@atelier-metal-sud.fr"
    }'::jsonb
);

-- Activation du contexte Row-Level Security pour la session d'insertion
SELECT set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

-- 2. CRÉATION DES UTILISATEURS (ADMINISTRATEURS & SALARIÉS)
INSERT INTO users (id, tenant_id, sso_subject_id, email, full_name, role, department) VALUES
    ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111111', 'entra-sub-001', 'claire.moreau@atelier-metal-sud.fr', 'Claire Moreau', 'admin_rh', 'Ressources Humaines'),
    ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111111', 'entra-sub-002', 'marc.lefevre@atelier-metal-sud.fr', 'Marc Lefèvre', 'admin_dpo', 'Juridique & Conformité'),
    ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111111', 'entra-sub-003', 'julien.bernard@atelier-metal-sud.fr', 'Julien Bernard', 'employee', 'Production & Atelier'),
    ('22222222-2222-2222-2222-222222222204', '11111111-1111-1111-1111-111111111111', 'entra-sub-004', 'sophie.laurent@atelier-metal-sud.fr', 'Sophie Laurent', 'employee', 'Commercial & Devis');

-- 3. INSERTION DES DOCUMENTS (PRIVÉ CLIENT + SOCLE LÉGAL MUTUALISÉ)

-- 3A. Document privé : Règlement Intérieur v1.2 de l'entreprise
INSERT INTO documents (
    id,
    tenant_id,
    is_shared_base,
    module_code,
    title,
    version,
    sha256_hash,
    status,
    audience_scope,
    requires_acknowledgment,
    published_at,
    published_by
) VALUES (
    '33333333-3333-3333-3333-333333333301',
    '11111111-1111-1111-1111-111111111111',
    FALSE,
    'socle_ri',
    'Règlement Intérieur — Atelier Métal & Industrie du Sud',
    '1.2',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'active',
    'all',
    TRUE,
    NOW() - INTERVAL '45 days', -- Publié depuis plus d'un mois (conforme art. R. 1321-1)
    '22222222-2222-2222-2222-222222222201'
);

-- 3B. Document mutualisé : Référentiel RGPD général (Socle A.C.R.)
INSERT INTO documents (
    id,
    tenant_id,
    is_shared_base,
    module_code,
    title,
    version,
    sha256_hash,
    status,
    audience_scope,
    requires_acknowledgment,
    published_at
) VALUES (
    '33333333-3333-3333-3333-333333333302',
    NULL,
    TRUE,
    'rgpd',
    'Guide Pratique RGPD — Conservation des données clients et prospects (CNIL)',
    '2026.1',
    '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
    'active',
    'all',
    FALSE,
    NOW() - INTERVAL '90 days'
);

-- 4. SEGMENTS VECTORISÉS (CHUNKS POUR LE MOTEUR RAG)
INSERT INTO document_chunks (document_id, tenant_id, is_shared_base, module_code, chunk_index, content, page_number, embedding) VALUES
    (
        '33333333-3333-3333-3333-333333333301',
        '11111111-1111-1111-1111-111111111111',
        FALSE,
        'socle_ri',
        1,
        'Article 4 - Horaires et pointage : Les horaires collectifs de l''atelier sont fixés de 08h00 à 12h00 et de 13h30 à 17h30 du lundi au vendredi. Tout retard supérieur à 15 minutes doit être signalé au chef d''équipe avant 08h30.',
        2,
        array_fill(0.01, ARRAY[1536])::vector
    ),
    (
        '33333333-3333-3333-3333-333333333301',
        '11111111-1111-1111-1111-111111111111',
        FALSE,
        'socle_ri',
        2,
        'Article 9 - Hygiène et Équipements de Protection Individuelle (EPI) : Le port des chaussures de sécurité S3, des lunettes de protection et des bouchons d''oreilles est strictement obligatoire dans toute la zone de soudure et de découpe laser.',
        5,
        array_fill(0.02, ARRAY[1536])::vector
    ),
    (
        '33333333-3333-3333-3333-333333333301',
        '11111111-1111-1111-1111-111111111111',
        FALSE,
        'socle_ri',
        3,
        'Article 14 - Usage du matériel informatique et messagerie : L''utilisation d''une clé USB personnelle sur les postes de l''entreprise est interdite sans analyse préalable par le service informatique. Les messageries professionnelles sont réservées à un usage professionnel.',
        8,
        array_fill(0.03, ARRAY[1536])::vector
    ),
    (
        '33333333-3333-3333-3333-333333333302',
        NULL,
        TRUE,
        'rgpd',
        1,
        'Règle CNIL - Prospection commerciale B2B : Les coordonnées professionnelles d''un prospect non client peuvent être conservées pendant une durée maximale de 3 ans à compter du dernier contact émanant du prospect.',
        1,
        array_fill(0.04, ARRAY[1536])::vector
    );

-- 5. ACCUSÉ DE PRISE DE CONNAISSANCE (PREUVE NOMINATIVE R. 1321-1)
INSERT INTO acknowledgments (tenant_id, document_id, user_id, document_version, acknowledged_at) VALUES
    ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222203', '1.2', NOW() - INTERVAL '40 days'),
    ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333301', '22222222-2222-2222-2222-222222222204', '1.2', NOW() - INTERVAL '38 days');

-- 6. JOURNAL DES CONSULTATIONS ANONYMISÉES (DONT QUESTIONS HORS DOCUMENTATION)
INSERT INTO query_logs (tenant_id, channel, module_code, question_topic, cited_document_id, confidence_score, unanswered_flag, was_escalated, escalated_to_role, created_at) VALUES
    -- Question couverte par le Règlement Intérieur
    ('11111111-1111-1111-1111-111111111111', 'teams', 'socle_ri', 'Quels EPI sont obligatoires dans la zone de soudure ?', '33333333-3333-3333-3333-333333333301', 0.942, FALSE, FALSE, NULL, NOW() - INTERVAL '5 days'),
    -- Question couverte par le socle RGPD
    ('11111111-1111-1111-1111-111111111111', 'chrome_extension', 'rgpd', 'Combien de temps garder un contact prospect inactif dans le CRM ?', '33333333-3333-3333-3333-333333333302', 0.895, FALSE, FALSE, NULL, NOW() - INTERVAL '3 days'),
    -- Question NON couverte (alimente le Radar Admin + Escalade DRH)
    ('11111111-1111-1111-1111-111111111111', 'teams', 'socle_ri', 'Quel est le plafond de remboursement des paniers repas en déplacement ?', NULL, 0.310, TRUE, TRUE, 'drh', NOW() - INTERVAL '1 day'),
    -- Question NON couverte (alimente le Radar Admin + Escalade DPO)
    ('11111111-1111-1111-1111-111111111111', 'chrome_extension', 'rgpd', 'Ai-je le droit d''utiliser ChatGPT gratuit pour résumer un devis client ?', NULL, 0.280, TRUE, TRUE, 'dpo', NOW() - INTERVAL '4 hours');

-- 7. JOURNAL D'AUDIT ADMINISTRATEUR
INSERT INTO admin_audit_logs (tenant_id, actor_user_id, action_type, target_entity_id, metadata) VALUES
    (
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222201',
        'DOCUMENT_PUBLISHED',
        '33333333-3333-3333-3333-333333333301',
        '{"version": "1.2", "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "channel": "web-admin"}'::jsonb
    );

COMMIT;
