const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");

const router = express.Router();

let schemaReadyPromise = null;
function ensureEscalationColumns() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = db.pool
      .query(`
        ALTER TABLE query_logs
          ADD COLUMN IF NOT EXISTS referent_answer TEXT,
          ADD COLUMN IF NOT EXISTS referent_answer_sha256 VARCHAR(64),
          ADD COLUMN IF NOT EXISTS answered_by_role VARCHAR(50),
          ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS referent_acknowledged_at TIMESTAMPTZ;
      `)
      .catch((err) => {
        console.error("Migration auto query_logs (admin):", err.message);
        schemaReadyPromise = null;
      });
  }
  return schemaReadyPromise;
}

router.get("/admin/overview", async (req, res) => {
  await ensureEscalationColumns();
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
      client.query(`SELECT ((SELECT COUNT(*)::int FROM acknowledgments) + (SELECT COUNT(*)::int FROM query_logs WHERE referent_acknowledged_at IS NOT NULL)) AS total_acknowledgments`),
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
  await ensureEscalationColumns();
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
  await ensureEscalationColumns();
  const client = await db.pool.connect();
  try {
    const { queryId } = req.params;
    const rawAnswer = req.body?.answer;
    if (!queryId || !/^[0-9a-fA-F-]{36}$/.test(queryId.trim())) {
      return res.status(400).json({
        status: "error",
        message: "Valid \"queryId\" is required",
      });
    }
    if (!rawAnswer || typeof rawAnswer !== "string" || !rawAnswer.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Field \"answer\" is required",
      });
    }

    const cleanAnswer = rawAnswer.trim();
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
           answered_by_role = 'Référent Conformité',
           answered_at = NOW()
       WHERE id = $3
         AND tenant_id = $4
       RETURNING id, referent_answer, referent_answer_sha256, answered_by_role, answered_at, referent_acknowledged_at`,
      [cleanAnswer, sha256Hash, queryId.trim(), req.tenant.id]
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

module.exports = router;
