const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const { requireAdminRole } = require("../middleware/tenantAuth");

const router = express.Router();

const ALLOWED_SCOPES = ["socle_ri", "rgpd", "cyber", "sapin_ii", "lcb_ft"];
const SCOPE_LABELS = {
  socle_ri: "Règlement Intérieur & Sécurité",
  rgpd: "RGPD & Protection des données",
  cyber: "Cybersécurité & SI",
  sapin_ii: "Sapin II & Éthique",
  lcb_ft: "LCB-FT & Conformité financière",
};
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

let schemaReadyPromise = null;
function ensureAdminSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = db.pool
      .query(`
        ALTER TABLE query_logs
          ADD COLUMN IF NOT EXISTS referent_answer TEXT,
          ADD COLUMN IF NOT EXISTS referent_answer_sha256 VARCHAR(64),
          ADD COLUMN IF NOT EXISTS answered_by_role VARCHAR(100),
          ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS referent_acknowledged_at TIMESTAMPTZ;

        CREATE TABLE IF NOT EXISTS tenant_referents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          role VARCHAR(40) NOT NULL DEFAULT 'referent_metier',
          access_level VARCHAR(25) NOT NULL DEFAULT 'read_write',
          scopes TEXT[] NOT NULL DEFAULT ARRAY['socle_ri']::TEXT[],
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE tenant_referents ADD COLUMN IF NOT EXISTS access_token VARCHAR(96);
        UPDATE tenant_referents SET access_token = encode(gen_random_bytes(24), 'hex') WHERE access_token IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_referents_tenant_email
          ON tenant_referents (tenant_id, LOWER(email));
      `)
      .catch((err) => {
        console.error("Migration auto admin schema:", err.message);
        schemaReadyPromise = null;
      });
  }
  return schemaReadyPromise;
}

function sanitizeScopes(rawScopes) {
  if (!Array.isArray(rawScopes)) return ["socle_ri"];
  const filtered = [...new Set(rawScopes.filter((s) => ALLOWED_SCOPES.includes(s)))];
  return filtered.length > 0 ? filtered : ["socle_ri"];
}

function mapReferentRow(row) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    role: row.role,
    accessLevel: row.access_level,
    scopes: Array.isArray(row.scopes) && row.scopes.length > 0 ? row.scopes : ["socle_ri"],
    accessToken: row.access_token || null,
    createdAt: row.created_at,
  };
}

async function dispatchReferentEmail({ name, email, accessLevel, scopes, tenantName }) {
  const accessLabel =
    accessLevel === "read_write" ? "Lecture et écriture" : "Lecture seule";
  const scopesList = sanitizeScopes(scopes)
    .map((code) => SCOPE_LABELS[code] || code)
    .join(", ");

  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    return {
      sent: false,
      reason: "Enregistré en base (envoi mail en attente : RESEND_API_KEY / MAIL_FROM non configurés sur Scalingo).",
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [email],
      subject: `BOB — Activation de votre rôle de référent conformité (${tenantName || "Gouvernance"})`,
      text:
        `Bonjour ${name},\n\n` +
        `Votre accès référent a été activé sur BOB (Assistant Conformité et Réglementation)${
          tenantName ? ` pour ${tenantName}` : ""
        }.\n` +
        `- Niveau d'accès : ${accessLabel}\n` +
        `- Périmètre(s) attribué(s) : ${scopesList}\n` +
        (process.env.ADMIN_DASHBOARD_URL
          ? `- Accès tableau de bord : ${process.env.ADMIN_DASHBOARD_URL}\n`
          : "") +
        `\nCordialement,\nLa Gouvernance Conformité`,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Resend HTTP ${response.status} ${errText}`.trim());
  }

  return { sent: true };
}

router.get("/admin/overview", async (req, res) => {
  await ensureAdminSchema();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const [docsRes, chunksRes, queriesRes, acksRes] = await Promise.all([
      client.query(
        `SELECT
           COUNT(*)::int AS total_documents,
           COUNT(*) FILTER (WHERE status = 'published')::int AS published_documents,
           COUNT(*) FILTER (WHERE requires_acknowledgment = true)::int AS mandatory_ack_documents
         FROM documents`
      ),
      client.query(`SELECT COUNT(*)::int AS total_chunks FROM document_chunks`),
      client.query(
        `SELECT
           COUNT(*)::int AS total_queries,
           COUNT(*) FILTER (WHERE unanswered_flag = true OR was_escalated = true)::int AS escalated_queries,
           ROUND(AVG(confidence_score)::numeric, 3) AS avg_confidence
         FROM query_logs`
      ),
      client.query(
        `SELECT ((SELECT COUNT(*)::int FROM acknowledgments) + (SELECT COUNT(*)::int FROM query_logs WHERE referent_acknowledged_at IS NOT NULL)) AS total_acknowledgments`
      ),
    ]);

    await client.query("COMMIT");

    return res.json({
      status: "ok",
      tenant: { id: req.tenant.id, name: req.tenant.name },
      overview: {
        ...docsRes.rows[0],
        ...chunksRes.rows[0],
        ...queriesRes.rows[0],
        ...acksRes.rows[0],
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur GET /api/admin/overview:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to load admin overview",
    });
  } finally {
    client.release();
  }
});

router.get("/admin/escalations", async (req, res) => {
  await ensureAdminSchema();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const result = await client.query(
      `SELECT
         id,
         channel,
         module_code,
         question_topic,
         confidence_score,
         unanswered_flag,
         was_escalated,
         escalated_to_role,
         referent_answer,
         referent_answer_sha256,
         answered_by_role,
         answered_at,
         referent_acknowledged_at,
         created_at
       FROM query_logs
       WHERE unanswered_flag = true OR was_escalated = true
       ORDER BY created_at DESC
       LIMIT 50`
    );

    await client.query("COMMIT");

    return res.json({
      status: "ok",
      tenant: { id: req.tenant.id, name: req.tenant.name },
      escalations: result.rows,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur GET /api/admin/escalations:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to load escalations",
    });
  } finally {
    client.release();
  }
});

router.post("/admin/escalations/:queryId/reply", async (req, res) => {
  await ensureAdminSchema();
  const client = await db.pool.connect();
  try {
    const { queryId } = req.params;
    const rawAnswer = req.body?.answer;
    const rawAuthor = req.body?.answeredBy;
    if (!queryId || !UUID_REGEX.test(queryId.trim())) {
      return res.status(400).json({
        status: "error",
        message: 'Valid "queryId" is required',
      });
    }
    if (!rawAnswer || typeof rawAnswer !== "string" || !rawAnswer.trim()) {
      return res.status(400).json({
        status: "error",
        message: 'Field "answer" is required',
      });
    }

    const cleanAnswer = rawAnswer.trim();
    const authorLabel =
      typeof rawAuthor === "string" && rawAuthor.trim()
        ? rawAuthor.trim().slice(0, 100)
        : "Référent Conformité";
    const sha256Hash = crypto.createHash("sha256").update(cleanAnswer, "utf8").digest("hex");

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const updateRes = await client.query(
      `UPDATE query_logs
       SET was_escalated = TRUE,
           escalated_to_role = COALESCE(escalated_to_role, 'compliance_referent'),
           referent_answer = $1,
           referent_answer_sha256 = $2,
           answered_by_role = $3,
           answered_at = NOW()
       WHERE id = $4
         AND tenant_id = $5
       RETURNING id, referent_answer, referent_answer_sha256, answered_by_role, answered_at, referent_acknowledged_at`,
      [cleanAnswer, sha256Hash, authorLabel, queryId.trim(), req.tenant.id]
    );

    if (updateRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        status: "error",
        message: "Escalation not found",
      });
    }

    await client.query("COMMIT");

    return res.json({
      status: "ok",
      escalation: updateRes.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur POST /api/admin/escalations/:queryId/reply:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to save referent answer",
    });
  } finally {
    client.release();
  }
});

router.get("/admin/referents", async (req, res) => {
  await ensureAdminSchema();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    let result = await client.query(
      `SELECT id, full_name, email, role, access_level, scopes, access_token, created_at
       FROM tenant_referents
       WHERE tenant_id = $1
       ORDER BY created_at ASC`,
      [req.tenant.id]
    );

    if (result.rowCount === 0) {
      await client.query(
        `INSERT INTO tenant_referents (tenant_id, full_name, email, role, access_level, scopes, access_token)
         VALUES
           ($1, 'Direction Conformité', 'conformite@atelier-metal.fr', 'admin_conformite', 'read_write', ARRAY['socle_ri','rgpd','cyber','sapin_ii','lcb_ft']::TEXT[]),
           ($1, 'Claire Moreau', 'claire.moreau@atelier-metal.fr', 'referent_metier', 'read_write', ARRAY['socle_ri','cyber']::TEXT[]),
           ($1, 'Marc Lefèvre', 'marc.lefevre@atelier-metal.fr', 'referent_metier', 'read_write', ARRAY['rgpd','sapin_ii','lcb_ft']::TEXT[])
         ON CONFLICT DO NOTHING`,
        [req.tenant.id]
      );

      result = await client.query(
        `SELECT id, full_name, email, role, access_level, scopes, access_token, created_at
         FROM tenant_referents
         WHERE tenant_id = $1
         ORDER BY created_at ASC`,
        [req.tenant.id]
      );
    }

    await client.query("COMMIT");

    return res.json({
      status: "ok",
      referents: result.rows.map(mapReferentRow),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur GET /api/admin/referents:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to load referents",
    });
  } finally {
    client.release();
  }
});

router.post("/admin/referents", requireAdminRole, async (req, res) => {
  await ensureAdminSchema();
  const { name, email, role, accessLevel, scopes, sendEmail } = req.body || {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ status: "error", message: "Le nom du référent est requis." });
  }
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ status: "error", message: "Une adresse e-mail valide est requise." });
  }

  const cleanRole = ["admin_conformite", "referent_metier", "auditeur_lecture"].includes(role)
    ? role
    : "referent_metier";
  const cleanAccess = ["read_only", "read_write", "read_write_push"].includes(accessLevel) ? accessLevel : "read_write";
  const cleanScopes =
    cleanRole === "admin_conformite" || cleanRole === "auditeur_lecture"
      ? ALLOWED_SCOPES
      : sanitizeScopes(scopes);

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const insertRes = await client.query(
      `INSERT INTO tenant_referents (tenant_id, full_name, email, role, access_level, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, encode(gen_random_bytes(24), 'hex'))
       ON CONFLICT (tenant_id, LOWER(email))
       DO UPDATE SET
         full_name = EXCLUDED.full_name,
         role = EXCLUDED.role,
         access_level = EXCLUDED.access_level,
         scopes = EXCLUDED.scopes,
         updated_at = NOW()
       RETURNING id, full_name, email, role, access_level, scopes, access_token, created_at`,
      [req.tenant.id, name.trim(), email.trim().toLowerCase(), cleanRole, cleanAccess, cleanScopes]
    );

    await client.query("COMMIT");

    const referent = mapReferentRow(insertRes.rows[0]);
    let emailStatus = { sent: false };

    if (sendEmail) {
      try {
        emailStatus = await dispatchReferentEmail({
          name: referent.name,
          email: referent.email,
          accessLevel: referent.accessLevel,
          scopes: referent.scopes,
          tenantName: req.tenant.name,
        });
      } catch (mailErr) {
        emailStatus = { sent: false, reason: `Échec envoi mail : ${mailErr.message}` };
      }
    }

    return res.status(201).json({
      status: "ok",
      referent,
      emailStatus,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur POST /api/admin/referents:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Impossible d'enregistrer le référent.",
    });
  } finally {
    client.release();
  }
});

router.patch("/admin/referents/:referentId", requireAdminRole, async (req, res) => {
  await ensureAdminSchema();
  const { referentId } = req.params;
  if (!UUID_REGEX.test(referentId || "")) {
    return res.status(400).json({ status: "error", message: "Identifiant référent invalide." });
  }

  const { accessLevel, scopes } = req.body || {};
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const currentRes = await client.query(
      `SELECT id, full_name, email, role, access_level, scopes
       FROM tenant_referents
       WHERE id = $1 AND tenant_id = $2`,
      [referentId, req.tenant.id]
    );

    if (currentRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ status: "error", message: "Référent introuvable." });
    }

    const current = currentRes.rows[0];
    const nextAccess =
      ["read_only", "read_write", "read_write_push"].includes(accessLevel)
        ? accessLevel
        : current.access_level;
    const nextScopes = Array.isArray(scopes) ? sanitizeScopes(scopes) : current.scopes;

    const updateRes = await client.query(
      `UPDATE tenant_referents
       SET access_level = $1,
           scopes = $2,
           updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4
       RETURNING id, full_name, email, role, access_level, scopes, access_token, created_at`,
      [nextAccess, nextScopes, referentId, req.tenant.id]
    );

    await client.query("COMMIT");

    return res.json({
      status: "ok",
      referent: mapReferentRow(updateRes.rows[0]),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur PATCH /api/admin/referents/:referentId:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Impossible de mettre à jour le référent.",
    });
  } finally {
    client.release();
  }
});

router.delete("/admin/referents/:referentId", requireAdminRole, async (req, res) => {
  await ensureAdminSchema();
  const { referentId } = req.params;
  if (!UUID_REGEX.test(referentId || "")) {
    return res.status(400).json({ status: "error", message: "Identifiant référent invalide." });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const countRes = await client.query(
      `SELECT COUNT(*)::int AS total FROM tenant_referents WHERE tenant_id = $1`,
      [req.tenant.id]
    );

    if ((countRes.rows[0]?.total || 0) <= 1) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        status: "error",
        message: "Impossible de supprimer le dernier référent du tenant.",
      });
    }

    const delRes = await client.query(
      `DELETE FROM tenant_referents WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [referentId, req.tenant.id]
    );

    if (delRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ status: "error", message: "Référent introuvable." });
    }

    await client.query("COMMIT");

    return res.json({ status: "ok", deletedId: referentId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur DELETE /api/admin/referents/:referentId:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Impossible de supprimer le référent.",
    });
  } finally {
    client.release();
  }
});

router.post("/admin/referents/notify", requireAdminRole, async (req, res) => {
  const { name, email, accessLevel, scopes } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ status: "error", message: "Nom et e-mail requis." });
  }

  try {
    const result = await dispatchReferentEmail({
      name: name.trim(),
      email: email.trim(),
      accessLevel,
      scopes,
      tenantName: req.tenant?.name,
    });
    return res.json({ status: "ok", ...result });
  } catch (err) {
    return res.status(502).json({
      status: "error",
      message: err.message,
    });
  }
});

module.exports = router;
