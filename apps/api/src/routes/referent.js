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
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS module_code VARCHAR(40) DEFAULT 'socle_ri';
      ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS module_code VARCHAR(40) DEFAULT 'socle_ri';
      ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS question_topic TEXT;
      ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS unanswered_flag BOOLEAN DEFAULT false;
      ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS was_escalated BOOLEAN DEFAULT false;
      ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS referent_answer TEXT;
      ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS referent_answer_sha256 VARCHAR(64);
      ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS answered_by_role VARCHAR(40);
      ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;
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
    const [docsRes, acksRes, escsRes, pushesRes, pushResponsesRes] = await Promise.all([
      client.query("SELECT id, title, module_code, version, status, requires_acknowledgment, created_at FROM documents WHERE COALESCE(module_code, 'socle_ri') = ANY($1::TEXT[]) ORDER BY created_at DESC", [scopes]),
      client.query("SELECT a.id, a.document_id, COALESCE(u.full_name, u.email, a.user_id::text) AS user_identifier, u.department, a.acknowledged_at, d.title AS document_title, COALESCE(d.module_code, 'socle_ri') AS module_code FROM acknowledgments a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN documents d ON d.id = a.document_id WHERE COALESCE(d.module_code, 'socle_ri') = ANY($1::TEXT[]) ORDER BY a.acknowledged_at DESC LIMIT 200", [scopes]),
      client.query("SELECT id, channel, COALESCE(module_code, 'socle_ri') AS module_code, question_topic, confidence_score, unanswered_flag, was_escalated, referent_answer, referent_answer_sha256, answered_by_role, answered_at, created_at FROM query_logs WHERE (unanswered_flag = true OR was_escalated = true) AND COALESCE(module_code, 'socle_ri') = ANY($1::TEXT[]) ORDER BY created_at DESC LIMIT 100", [scopes]),
      client.query("SELECT p.id, p.module_code, p.push_type, p.title, p.body, p.document_id, p.options_json, p.correct_option, p.referent_name, p.created_at, COUNT(r.id)::int AS total_responses, COUNT(r.id) FILTER (WHERE r.is_correct = true)::int AS correct_responses, COUNT(r.id) FILTER (WHERE r.is_correct = false)::int AS wrong_responses FROM referent_pushes p LEFT JOIN referent_push_responses r ON r.push_id = p.id WHERE p.tenant_id = $1 AND p.module_code = ANY($2::TEXT[]) GROUP BY p.id ORDER BY p.created_at DESC LIMIT 50", [req.tenant.id, scopes]),
      client.query("SELECT r.id, r.push_id, r.user_identifier, r.selected_option, r.free_text, r.is_correct, r.sha256_proof, r.responded_at, p.title AS push_title, p.push_type, p.module_code, p.referent_name FROM referent_push_responses r JOIN referent_pushes p ON p.id = r.push_id WHERE p.tenant_id = $1 AND p.module_code = ANY($2::TEXT[]) ORDER BY r.responded_at DESC LIMIT 100", [req.tenant.id, scopes])
    ]);
    await client.query("COMMIT");
    return res.json({ status: "ok", tenant: req.tenant, referent: req.referent, documents: docsRes.rows, acknowledgments: acksRes.rows, escalations: escsRes.rows, pushes: pushesRes.rows, push_responses: pushResponsesRes.rows });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur /referent/me:", err.message); return res.status(500).json({ status: "error", message: "Erreur chargement espace référent.", detail: err.message });
  } finally { client.release(); }
});


router.post("/referent/pushes", referentTokenAuth, async (req, res) => {
  if (!req.referent.canPush) {
    return res.status(403).json({ status: "error", message: "Droits de diffusion insuffisants pour ce référent." });
  }
  const { moduleCode, pushType, title, body, documentId, options, correctOption } = req.body || {};
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  const cleanBody = typeof body === "string" ? body.trim() : "";
  if (!cleanTitle || !cleanBody) {
    return res.status(400).json({ status: "error", message: "Titre et message obligatoires." });
  }
  const scope = ALLOWED_SCOPES.includes(moduleCode) && req.referent.scopes.includes(moduleCode)
    ? moduleCode
    : (req.referent.scopes[0] || "socle_ri");
  const type = ["acknowledgment", "quiz", "flash"].includes(pushType) ? pushType : "flash";
  const safeDocId = typeof documentId === "string" && UUID_REGEX.test(documentId) ? documentId : null;
  const cleanOptions = Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : [];
  const cleanCorrect = typeof correctOption === "string" && correctOption.trim() ? correctOption.trim() : null;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [req.tenant.id]);
    const ins = await client.query(
      `INSERT INTO referent_pushes
         (tenant_id, referent_id, referent_name, module_code, push_type, title, body, document_id, options_json, correct_option, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, true)
       RETURNING id, module_code, push_type, title, body, document_id, options_json, correct_option, referent_name, created_at`,
      [req.tenant.id, req.referent.id, req.referent.name, scope, type, cleanTitle, cleanBody, safeDocId, JSON.stringify(cleanOptions), cleanCorrect]
    );
    await client.query("COMMIT");
    return res.status(201).json({ status: "ok", push: ins.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur POST /referent/pushes:", err.message);
    return res.status(500).json({ status: "error", message: "Erreur diffusion du push.", detail: err.message });
  } finally {
    client.release();
  }
});

router.get("/referent/pushes/active", referentTokenAuth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [req.tenant.id]);
    const rows = await client.query(
      `SELECT id, module_code, push_type, title, body, document_id, options_json, referent_name, created_at
       FROM referent_pushes
       WHERE tenant_id = $1 AND active = true AND module_code = ANY($2::TEXT[])
       ORDER BY created_at DESC LIMIT 20`,
      [req.tenant.id, req.referent.scopes]
    );
    await client.query("COMMIT");
    return res.json({ status: "ok", pushes: rows.rows });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur GET /referent/pushes/active:", err.message);
    return res.status(500).json({ status: "error", message: "Erreur chargement pushes actifs." });
  } finally {
    client.release();
  }
});


async function resolveWidgetTenant(req) {
  try {
    if (req.tenant && req.tenant.id) return req.tenant;
    const auth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (bearer) {
      const hash = crypto.createHash("sha256").update(bearer).digest("hex");
      const tRes = await db.query(
        "SELECT id, name FROM tenants WHERE api_key_hash = $1 OR id::text = $2 LIMIT 1",
        [hash, bearer]
      ).catch(() => ({ rows: [] }));
      if (tRes.rows[0]) return tRes.rows[0];
    }
    const fallback = await db.query("SELECT id, name FROM tenants WHERE id = '11111111-1111-1111-1111-111111111111' LIMIT 1");
    return fallback.rows[0] || null;
  } catch (err) {
    console.error("Erreur resolveWidgetTenant:", err.message);
    return null;
  }
}

router.get("/widget/pushes/pending", async (req, res) => {
  await ensureReferentAndPushSchema();
  const tenant = await resolveWidgetTenant(req);
  if (!tenant) return res.status(401).json({ unreadCount: 0, pushes: [] });

  const userEmail = String(req.query.user || "salarie.demo@atelier-sud.fr").trim().toLowerCase();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant.id]);
    const rows = await client.query(
      `SELECT p.id, p.module_code, p.push_type, p.title, p.body, p.document_id, p.options_json, p.referent_name, p.created_at
       FROM referent_pushes p
       WHERE p.tenant_id = $1
         AND p.active = true
         AND NOT EXISTS (
           SELECT 1 FROM referent_push_responses r
           WHERE r.push_id = p.id AND LOWER(r.user_identifier) = $2
         )
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [tenant.id, userEmail]
    );
    await client.query("COMMIT");
    return res.json({ unreadCount: rows.rows.length, pushes: rows.rows });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur GET /widget/pushes/pending:", err.message);
    return res.status(500).json({ unreadCount: 0, pushes: [] });
  } finally {
    client.release();
  }
});

router.post("/widget/pushes/:pushId/respond", async (req, res) => {
  await ensureReferentAndPushSchema();
  const tenant = await resolveWidgetTenant(req);
  if (!tenant) return res.status(401).json({ status: "error", message: "Tenant non identifié." });

  const { pushId } = req.params;
  if (!UUID_REGEX.test(pushId)) {
    return res.status(400).json({ status: "error", message: "Identifiant push invalide." });
  }
  const { userIdentifier, selectedOption, freeText } = req.body || {};
  const actor = String(userIdentifier || "salarie.demo@atelier-sud.fr").trim().toLowerCase();
  const chosen = typeof selectedOption === "string" && selectedOption.trim() ? selectedOption.trim() : null;
  const note = typeof freeText === "string" && freeText.trim() ? freeText.trim() : null;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant.id]);
    const pushRes = await client.query(
      `SELECT id, push_type, correct_option FROM referent_pushes WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [pushId, tenant.id]
    );
    const push = pushRes.rows[0];
    if (!push) {
      await client.query("ROLLBACK");
      return res.status(404).json({ status: "error", message: "Push introuvable." });
    }
    const isCorrect = push.push_type === "quiz" && push.correct_option && chosen
      ? chosen.toLowerCase() === String(push.correct_option).trim().toLowerCase()
      : null;
    const respondedAt = new Date().toISOString();
    const sha256Proof = crypto
      .createHash("sha256")
      .update(`${push.id}|${actor}|${chosen || ""}|${note || ""}|${respondedAt}`)
      .digest("hex");

    const ins = await client.query(
      `INSERT INTO referent_push_responses
         (push_id, tenant_id, user_identifier, selected_option, free_text, is_correct, sha256_proof, responded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
       ON CONFLICT (push_id, LOWER(user_identifier))
       DO UPDATE SET selected_option = EXCLUDED.selected_option, free_text = EXCLUDED.free_text, is_correct = EXCLUDED.is_correct, sha256_proof = EXCLUDED.sha256_proof, responded_at = EXCLUDED.responded_at
       RETURNING id, push_id, user_identifier, selected_option, is_correct, sha256_proof, responded_at`,
      [push.id, tenant.id, actor, chosen, note, isCorrect, sha256Proof, respondedAt]
    );
    await client.query("COMMIT");
    return res.json({ status: "ok", response: ins.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur POST /widget/pushes/:pushId/respond:", err.message);
    return res.status(500).json({ status: "error", message: "Erreur enregistrement réponse push." });
  } finally {
    client.release();
  }
});


router.get("/referent/pushes/responses", referentTokenAuth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [req.tenant.id]);
    const rows = await client.query(
      `SELECT r.id, r.push_id, r.user_identifier, r.selected_option, r.free_text, r.is_correct, r.sha256_proof, r.responded_at,
              p.title AS push_title, p.push_type, p.module_code, p.referent_name
       FROM referent_push_responses r
       JOIN referent_pushes p ON p.id = r.push_id
       WHERE p.tenant_id = $1 AND p.module_code = ANY($2::TEXT[])
       ORDER BY r.responded_at DESC LIMIT 100`,
      [req.tenant.id, req.referent.scopes]
    );
    await client.query("COMMIT");
    return res.json({ status: "ok", responses: rows.rows });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur GET /referent/pushes/responses:", err.message);
    return res.status(500).json({ status: "error", message: "Erreur chargement réponses pushes." });
  } finally {
    client.release();
  }
});


router.post("/referent/escalations/:id/reply", referentTokenAuth, async (req, res) => {
  if (!req.referent.canWrite) {
    return res.status(403).json({ status: "error", message: "Droits en écriture insuffisants pour ce référent." });
  }
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ status: "error", message: "Identifiant d'escalade invalide." });
  }
  const answer = typeof req.body?.answer === "string" ? req.body.answer.trim() : "";
  if (!answer) {
    return res.status(400).json({ status: "error", message: "La réponse est obligatoire." });
  }
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [req.tenant.id]);
    const sha256 = crypto
      .createHash("sha256")
      .update(JSON.stringify({ escalationId: id, tenantId: req.tenant.id, referentId: req.referent.id, answer }))
      .digest("hex");
    const upd = await client.query(
      `UPDATE query_logs
       SET referent_answer = $1,
           referent_answer_sha256 = $2,
           answered_by_role = $3,
           answered_at = NOW(),
           unanswered_flag = false
       WHERE id = $4
         AND COALESCE(module_code, 'socle_ri') = ANY($5::TEXT[])
       RETURNING id, question_topic, referent_answer, referent_answer_sha256, answered_by_role, answered_at`,
      [answer, sha256, req.referent.role, id, req.referent.scopes]
    );
    if (!upd.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ status: "error", message: "Escalade introuvable ou hors périmètre." });
    }
    await client.query("COMMIT");
    return res.json({ status: "ok", escalation: upd.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur POST /referent/escalations/:id/reply:", err.message);
    return res.status(500).json({ status: "error", message: "Erreur publication de la réponse.", detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
