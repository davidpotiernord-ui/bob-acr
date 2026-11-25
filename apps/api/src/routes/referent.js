const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const tenantAuth = require("../middleware/tenantAuth");

const router = express.Router();
const ALLOWED_SCOPES = ["socle_ri", "rgpd", "cyber", "sapin_ii", "lcb_ft"];
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

let schemaPromise = null;
function ensureReferentAndPushSchema() {
  if (!schemaPromise) {
    schemaPromise = db.pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_referents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        role VARCHAR(40) NOT NULL DEFAULT 'referent_metier',
        access_level VARCHAR(25) NOT NULL DEFAULT 'read_write',
        scopes TEXT[] NOT NULL DEFAULT ARRAY['socle_ri']::TEXT[],
        access_token VARCHAR(96),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE tenant_referents ADD COLUMN IF NOT EXISTS access_token VARCHAR(96);
      UPDATE tenant_referents SET access_token = encode(gen_random_bytes(24), 'hex') WHERE access_token IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_referents_token ON tenant_referents (access_token);
      CREATE TABLE IF NOT EXISTS referent_pushes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        referent_id UUID REFERENCES tenant_referents(id) ON DELETE SET NULL,
        referent_name TEXT NOT NULL,
        module_code VARCHAR(40) NOT NULL DEFAULT 'socle_ri',
        push_type VARCHAR(25) NOT NULL DEFAULT 'acknowledgment',
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        document_id UUID,
        options_json JSONB NOT NULL DEFAULT '[]'::JSONB,
        correct_option TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS referent_push_responses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        push_id UUID NOT NULL REFERENCES referent_pushes(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_identifier TEXT NOT NULL,
        selected_option TEXT,
        free_text TEXT,
        is_correct BOOLEAN,
        sha256_proof VARCHAR(64) NOT NULL,
        responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_referent_push_responses_unique ON referent_push_responses (push_id, LOWER(user_identifier));
    `).catch((err) => { console.error("Migration referent/push:", err.message); schemaPromise = null; });
  }
  return schemaPromise;
}

async function referentTokenAuth(req, res, next) {
  await ensureReferentAndPushSchema();
  const rawToken = (typeof req.headers["x-referent-token"] === "string" && req.headers["x-referent-token"].trim()) || (typeof req.query.token === "string" && req.query.token.trim()) || "";
  if (!rawToken) return res.status(401).json({ status: "error", message: "Jeton référent requis." });
  try {
    const { rows } = await db.query("SELECT r.id, r.tenant_id, r.full_name, r.email, r.role, r.access_level, r.scopes, t.name AS tenant_name FROM tenant_referents r JOIN tenants t ON t.id = r.tenant_id WHERE r.access_token = $1 LIMIT 1", [rawToken]);
    if (!rows.length) return res.status(401).json({ status: "error", message: "Lien référent invalide." });
    const row = rows[0];
    const allScopes = row.role === "admin_conformite" || row.role === "auditeur_lecture";
    const scopes = allScopes ? ALLOWED_SCOPES : (Array.isArray(row.scopes) && row.scopes.length ? row.scopes.filter((s) => ALLOWED_SCOPES.includes(s)) : ["socle_ri"]);
    req.tenant = { id: row.tenant_id, name: row.tenant_name };
    req.referent = {
      id: row.id, name: row.full_name, email: row.email, role: row.role, accessLevel: row.access_level, scopes,
      canWrite: row.role !== "auditeur_lecture" && (row.access_level === "read_write" || row.access_level === "read_write_push"),
      canPush: row.role !== "auditeur_lecture" && row.access_level === "read_write_push"
    };
    return next();
  } catch (err) {
    return res.status(500).json({ status: "error", message: "Erreur auth référent." });
  }
}

router.get("/referent/me", referentTokenAuth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [req.tenant.id]);
    const scopes = req.referent.scopes;
    const [docsRes, acksRes, escsRes, pushesRes] = await Promise.all([
      client.query("SELECT id, title, module_code, version, status, requires_acknowledgment, created_at FROM documents WHERE COALESCE(module_code, 'socle_ri') = ANY($1::TEXT[]) ORDER BY created_at DESC", [scopes]),
      client.query("SELECT a.id, a.document_id, a.user_identifier, a.acknowledged_at, d.title AS document_title, COALESCE(d.module_code, 'socle_ri') AS module_code FROM acknowledgments a LEFT JOIN documents d ON d.id = a.document_id WHERE COALESCE(d.module_code, 'socle_ri') = ANY($1::TEXT[]) ORDER BY a.acknowledged_at DESC LIMIT 200", [scopes]),
      client.query("SELECT id, channel, COALESCE(module_code, 'socle_ri') AS module_code, question_topic, confidence_score, unanswered_flag, was_escalated, referent_answer, referent_answer_sha256, answered_by_role, answered_at, created_at FROM query_logs WHERE (unanswered_flag = true OR was_escalated = true) AND COALESCE(module_code, 'socle_ri') = ANY($1::TEXT[]) ORDER BY created_at DESC LIMIT 100", [scopes]),
      client.query("SELECT p.id, p.module_code, p.push_type, p.title, p.body, p.document_id, p.options_json, p.correct_option, p.referent_name, p.created_at, COUNT(r.id)::int AS total_responses, COUNT(r.id) FILTER (WHERE r.is_correct = true)::int AS correct_responses, COUNT(r.id) FILTER (WHERE r.is_correct = false)::int AS wrong_responses FROM referent_pushes p LEFT JOIN referent_push_responses r ON r.push_id = p.id WHERE p.tenant_id = $1 AND p.module_code = ANY($2::TEXT[]) GROUP BY p.id ORDER BY p.created_at DESC LIMIT 50", [req.tenant.id, scopes])
    ]);
    await client.query("COMMIT");
    return res.json({ status: "ok", tenant: req.tenant, referent: req.referent, documents: docsRes.rows, acknowledgments: acksRes.rows, escalations: escsRes.rows, pushes: pushesRes.rows });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ status: "error", message: "Erreur chargement espace référent." });
  } finally { client.release(); }
});
