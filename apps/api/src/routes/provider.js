const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");

const router = express.Router();

// 1. Santé plateforme & état du verrouillage RLS
router.get("/overview", async (req, res) => {
  try {
    const start = Date.now();
    const [{ rows: rlsRows }, { rows: kpiRows }, { rows: moduleRows }] = await Promise.all([
      db.query(`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname IN ('documents', 'document_chunks', 'users', 'query_logs')
        ORDER BY relname
      `),
      db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM tenants) AS tenants_count,
          (SELECT COUNT(*)::int FROM tenants WHERE COALESCE(use_shared_base, true) = true) AS shared_base_tenants_count,
          (SELECT COUNT(*)::int FROM documents WHERE is_shared_base = true AND status = 'active') AS active_shared_docs_count,
          (SELECT COUNT(*)::int FROM users WHERE COALESCE(is_active, true) = true) AS active_users_count,
          (SELECT COUNT(*)::int FROM query_logs) AS total_queries_count,
          (SELECT COUNT(*)::int FROM query_logs WHERE unanswered_flag = true) AS unanswered_queries_count,
          (SELECT COUNT(*)::int FROM query_logs WHERE was_escalated = true) AS escalated_queries_count
      `),
      db.query(`
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
    const { rows } = await db.query(`
      SELECT
        t.id,
        t.name,
        t.slug,
        t.country_code,
        t.plan_tier,
        COALESCE(t.auth_mode, 'sso') AS auth_mode,
        COALESCE(t.use_shared_base, true) AS use_shared_base,
        COUNT(DISTINCT u.id)::int AS active_users_count,
        COUNT(DISTINCT d.id) FILTER (WHERE COALESCE(d.is_shared_base, false) = false AND d.status = 'active')::int AS private_active_docs_count,
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
    const { rows } = await db.query(`
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
  try {
    const {
      module_code = "socle_ri",
      title,
      version = "1.0",
      audience_scope = "all",
      status = "active",
      content = "",
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "Le titre du document mutualisé est requis." });
    }

    const cleanStatus = ["draft", "active", "archived"].includes(status) ? status : "active";
    const hashInput = String(content || `${title}:${version}:${Date.now()}`);
    const sha256Hash = crypto.createHash("sha256").update(hashInput).digest("hex");

    const { rows } = await db.query(
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
        CASE WHEN $5 = 'active' THEN NOW() ELSE NULL END
      )
      RETURNING id, module_code, title, version, sha256_hash, status, audience_scope, published_at, created_at
      `,
      [String(module_code).trim(), String(title).trim(), String(version).trim() || "1.0", sha256Hash, cleanStatus, String(audience_scope).trim() || "all"]
    );

    return res.status(201).json({ document: rows[0] });
  } catch (err) {
    console.error("[provider/shared-documents POST]", err);
    return res.status(500).json({ error: "Erreur création document mutualisé" });
  }
});

router.patch("/shared-documents/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!["draft", "active", "archived"].includes(status)) {
      return res.status(400).json({ error: "Statut invalide (draft, active, archived)." });
    }

    const { rows } = await db.query(
      `
      UPDATE documents
      SET status = $1,
          published_at = CASE WHEN $1 = 'active' AND published_at IS NULL THEN NOW() ELSE published_at END
      WHERE id = $2 AND is_shared_base = true
      RETURNING id, module_code, title, version, sha256_hash, status, audience_scope, published_at, created_at
      `,
      [status, id]
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
