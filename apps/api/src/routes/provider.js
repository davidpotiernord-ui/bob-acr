const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const { embedText } = require("../services/llm");

const router = express.Router();

async function runProviderQuery(sql, params = []) {
const client = await db.pool.connect();
try {
await client.query("SELECT set_config('app.current_tenant_id', NULL, false), set_config('app.provider_mode', 'on', false)");
return await client.query(sql, params);
} finally {
client.release();
}
}



function toVector1536Literal(embedding) {
const targetDim = 1536;
const arr = Array.isArray(embedding) ? embedding.slice(0, targetDim) : [];
while (arr.length < targetDim) {
arr.push(0);
}
return `[${arr.map((n) => Number(n) || 0).join(",")}]`;
}

function chunkText(rawText, maxLen = 900, overlap = 120) {
const normalized = rawText.replace(/\r\n/g, "\n").trim();
if (!normalized) return [];

const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
const chunks = [];
let buffer = "";

for (const para of paragraphs) {
if (!buffer) {
  buffer = para;
} else if (buffer.length + 2 + para.length <= maxLen) {
  buffer += `\n\n${para}`;
} else {
  chunks.push(buffer);
  const tail = buffer.slice(Math.max(0, buffer.length - overlap));
  buffer = `${tail}\n\n${para}`.slice(0, maxLen);
}
}

if (buffer) {
chunks.push(buffer);
}

return chunks;
}

// 1. Santé plateforme & état du verrouillage RLS
router.get("/overview", async (req, res) => {
try {
const start = Date.now();
const [{ rows: rlsRows }, { rows: kpiRows }, { rows: moduleRows }] = await Promise.all([
  runProviderQuery(`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('documents', 'document_chunks', 'users', 'query_logs')
    ORDER BY relname
  `),
  runProviderQuery(`
    SELECT
      (SELECT COUNT(*)::int FROM tenants) AS tenants_count,
      (SELECT COUNT(*)::int FROM tenants WHERE COALESCE(use_shared_base, true) = true) AS shared_base_tenants_count,
      (SELECT COUNT(*)::int FROM documents WHERE is_shared_base = true AND status IN ('published', 'active')) AS active_shared_docs_count,
      (SELECT COUNT(*)::int FROM users WHERE COALESCE(is_active, true) = true) AS active_users_count,
      (SELECT COUNT(*)::int FROM query_logs) AS total_queries_count,
      (SELECT COUNT(*)::int FROM query_logs WHERE unanswered_flag = true) AS unanswered_queries_count,
      (SELECT COUNT(*)::int FROM query_logs WHERE was_escalated = true) AS escalated_queries_count
  `),
  runProviderQuery(`
    SELECT
      COALESCE(module_code, 'non_classe') AS module_code,
      COUNT(*)::int AS queries_count,
      COUNT(*) FILTER (WHERE unanswered_flag = true)::int AS unanswered_count,
      COUNT(*) FILTER (WHERE was_escalated = true)::int AS escalated_count
    FROM query_logs
    GROUP BY COALESCE(module_code, 'non_classe')
    ORDER BY queries_count DESC
  `),
]);

return res.json({
  status: "ok",
  db_latency_ms: Date.now() - start,
  rls: rlsRows,
  totals: kpiRows[0] || {},
  by_module: moduleRows,
  privacy_guarantee: "zero_pii_zero_prompt_content",
});
} catch (err) {
console.error("[provider/overview]", err);
return res.status(500).json({ error: "Erreur lecture supervision plateforme" });
}
});

// 2. Statistiques agrégées par tenant (aucune identité salarié ni contenu de flux)
router.get("/tenants", async (req, res) => {
try {
const { rows } = await runProviderQuery(`
  SELECT
    t.id,
    t.name,
    t.slug,
    t.country_code,
    t.plan_tier,
    COALESCE(t.auth_mode, 'sso') AS auth_mode,
    COALESCE(t.use_shared_base, true) AS use_shared_base,
    COUNT(DISTINCT u.id)::int AS active_users_count,
    COUNT(DISTINCT d.id) FILTER (WHERE COALESCE(d.is_shared_base, false) = false AND d.status IN ('published', 'active'))::int AS private_active_docs_count,
    COUNT(q.id)::int AS queries_count,
    COUNT(q.id) FILTER (WHERE q.unanswered_flag = true)::int AS unanswered_count,
    COUNT(q.id) FILTER (WHERE q.was_escalated = true)::int AS escalated_count,
    ROUND(AVG(q.confidence_score)::numeric, 3) AS avg_confidence_score,
    MAX(q.created_at) AS last_query_at
  FROM tenants t
  LEFT JOIN users u ON u.tenant_id = t.id AND COALESCE(u.is_active, true) = true
  LEFT JOIN documents d ON d.tenant_id = t.id
  LEFT JOIN query_logs q ON q.tenant_id = t.id
  GROUP BY t.id
  ORDER BY queries_count DESC, t.name ASC
`);

return res.json({ tenants: rows });
} catch (err) {
console.error("[provider/tenants]", err);
return res.status(500).json({ error: "Erreur chargement statistiques tenants" });
}
});

// 3. Catalogue du socle mutualisé (is_shared_base = true)
router.get("/shared-documents", async (req, res) => {
try {
const { rows } = await runProviderQuery(`
  SELECT
    d.id,
    d.module_code,
    d.title,
    d.version,
    d.sha256_hash,
    d.status,
    d.audience_scope,
    d.published_at,
    d.created_at,
    COUNT(c.id)::int AS chunks_count
  FROM documents d
  LEFT JOIN document_chunks c ON c.document_id = d.id
  WHERE d.is_shared_base = true
  GROUP BY d.id
  ORDER BY d.created_at DESC
`);

return res.json({ documents: rows });
} catch (err) {
console.error("[provider/shared-documents GET]", err);
return res.status(500).json({ error: "Erreur lecture socle mutualisé" });
}
});

router.post("/shared-documents", async (req, res) => {
const client = await db.pool.connect();
try {
const {
  module_code = "socle_ri",
  title,
  version = "1.0",
  audience_scope = "all",
  status = "published",
  content = "",
} = req.body || {};

if (!title || !String(title).trim()) {
  return res.status(400).json({ error: "Le titre du document mutualisé est requis." });
}
if (!content || !String(content).trim()) {
  return res.status(400).json({ error: "Le contenu textuel du document est requis pour l'indexation vectorielle RAG." });
}

const cleanTitle = String(title).trim().slice(0, 255);
const cleanModule = String(module_code).trim().slice(0, 50) || "socle_ri";
const cleanVersion = String(version).trim().slice(0, 50) || "1.0";
const cleanStatus = ["draft", "published", "active", "archived"].includes(status)
  ? (status === "active" ? "published" : status)
  : "published";
const cleanContent = String(content).trim();

const sha256Hash = crypto.createHash("sha256").update(cleanContent, "utf8").digest("hex");
const chunks = chunkText(cleanContent);
if (chunks.length === 0) {
  return res.status(400).json({ error: "Le contenu n'a produit aucun segment exploitable." });
}

const embeddedChunks = [];
for (let i = 0; i < chunks.length; i += 1) {
  const embedding = await embedText(chunks[i]);
  embeddedChunks.push({
    index: i,
    content: chunks[i],
    vectorLiteral: toVector1536Literal(embedding),
  });
}

await client.query("BEGIN");

const { rows } = await client.query(
  `
  INSERT INTO documents (
    tenant_id,
    is_shared_base,
    module_code,
    title,
    version,
    sha256_hash,
    status,
    audience_scope,
    published_at
  )
  VALUES (
    NULL,
    true,
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    CASE WHEN $5 = 'published' THEN NOW() ELSE NULL END
  )
  RETURNING id, module_code, title, version, sha256_hash, status, audience_scope, published_at, created_at
  `,
  [cleanModule, cleanTitle, cleanVersion, sha256Hash, cleanStatus, String(audience_scope).trim() || "all"]
);

const createdDoc = rows[0];

for (const chunk of embeddedChunks) {
  await client.query(
    `
    INSERT INTO document_chunks (
      document_id,
      tenant_id,
      is_shared_base,
      module_code,
      chunk_index,
      content,
      page_number,
      embedding
    )
    VALUES ($1, NULL, true, $2, $3, $4, $5, $6::vector(1536))
    `,
    [createdDoc.id, cleanModule, chunk.index, chunk.content, chunk.index + 1, chunk.vectorLiteral]
  );
}

await client.query("COMMIT");

return res.status(201).json({
  document: createdDoc,
  chunks_indexed: embeddedChunks.length,
});
} catch (err) {
await client.query("ROLLBACK").catch(() => {});
console.error("[provider/shared-documents POST]", err);
return res.status(500).json({ error: "Erreur indexation document mutualisé" });
} finally {
client.release();
}
});

router.patch("/shared-documents/:id/status", async (req, res) => {
try {
const { id } = req.params;
const { status } = req.body || {};
if (!["draft", "published", "active", "archived"].includes(status)) {
  return res.status(400).json({ error: "Statut invalide (draft, published, archived)." });
}
const normalizedStatus = status === "active" ? "published" : status;

const { rows } = await runProviderQuery(
  `
  UPDATE documents
  SET status = $1,
      published_at = CASE WHEN $1 = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END
  WHERE id = $2 AND is_shared_base = true
  RETURNING id, module_code, title, version, sha256_hash, status, audience_scope, published_at, created_at
  `,
  [normalizedStatus, id]
);

if (!rows[0]) {
  return res.status(404).json({ error: "Document mutualisé introuvable." });
}

return res.json({ document: rows[0] });
} catch (err) {
console.error("[provider/shared-documents PATCH]", err);
return res.status(500).json({ error: "Erreur mise à jour statut document" });
}
});

module.exports = router;
