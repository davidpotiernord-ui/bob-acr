require('dotenv').config({ path: '../../apps/api/.env' });
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Calcule l'empreinte SHA-256 d'un contenu documentaire (preuve d'intégrité).
 */
function computeSha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Découpe un texte long en segments (chunks) avec chevauchement pour préserver le contexte.
 */
function chunkText(text, chunkSize = 700, overlap = 120) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    chunks.push(clean.slice(start, end).trim());
    if (end === clean.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

/**
 * Génère le vecteur d'embedding (1536 dimensions).
 * À connecter à l'API d'embeddings en production.
 */
async function generateEmbedding(chunkContent) {
  // Déterministe en local pour les tests
  const seedByte = crypto.createHash('md5').update(chunkContent).digest()[0] / 2550;
  return `[${new Array(1536).fill(seedByte.toFixed(6)).join(',')}]`;
}

/**
 * Ingère un document complet dans `documents`, `document_chunks` et `admin_audit_logs`.
 * Si `isSharedBase = true`, `tenantId` doit être null (socle commun A.C.R.).
 */
async function ingestDocument({
  tenantId = null,
  isSharedBase = false,
  moduleCode = 'socle_ri',
  title,
  version = '1.0',
  rawText,
  actorUserId = null,
  requiresAcknowledgment = false
}) {
  if (!isSharedBase && !tenantId) {
    throw new Error('TENANT_ID_REQUIRED: Un document privé doit être rattaché à un tenant_id.');
  }

  const sha256Hash = computeSha256(rawText);
  const chunks = chunkText(rawText);

  if (chunks.length === 0) {
    throw new Error('EMPTY_CONTENT: Aucun contenu exploitable à indexer.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (tenantId) {
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    }

    const docInsert = await client.query(
      `
      INSERT INTO documents (
        tenant_id, is_shared_base, module_code, title, version,
        sha256_hash, status, requires_acknowledgment, published_at, published_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, NOW(), $8)
      RETURNING id
      `,
      [tenantId, isSharedBase, moduleCode, title, version, sha256Hash, requiresAcknowledgment, actorUserId]
    );

    const documentId = docInsert.rows[0].id;

    for (let i = 0; i < chunks.length; i++) {
      const embeddingLiteral = await generateEmbedding(chunks[i]);
      await client.query(
        `
        INSERT INTO document_chunks (
          document_id, tenant_id, is_shared_base, module_code, chunk_index, content, page_number, embedding
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
        `,
        [documentId, tenantId, isSharedBase, moduleCode, i + 1, chunks[i], 1, embeddingLiteral]
      );
    }

    if (tenantId) {
      await client.query(
        `
        INSERT INTO admin_audit_logs (tenant_id, actor_user_id, action_type, target_entity_id, metadata)
        VALUES ($1, $2, 'DOCUMENT_INGESTED', $3, $4::jsonb)
        `,
        [
          tenantId,
          actorUserId,
          documentId,
          JSON.stringify({ title, version, sha256_hash: sha256Hash, chunks_count: chunks.length })
        ]
      );
    }

    await client.query('COMMIT');
    return { documentId, sha256Hash, chunksCount: chunks.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Exécution directe en ligne de commande pour test rapide
if (require.main === module) {
  const sampleText =
    "Article 12 - Sécurité des accès et mots de passe : Chaque salarié doit verrouiller son poste de travail lors de tout éloignement, même bref. Le partage de compte ou de mot de passe est strictement interdit.";
  console.log('SHA-256 calculé :', computeSha256(sampleText));
  console.log('Nombre de segments :', chunkText(sampleText).length);
}

module.exports = { ingestDocument, computeSha256, chunkText };
