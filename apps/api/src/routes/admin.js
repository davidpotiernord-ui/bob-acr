const express = require('express');
const db = require('../services/db');

const router = express.Router();

router.get('/admin/overview', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
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
      client.query(`SELECT COUNT(*)::int AS total_acknowledgments FROM acknowledgments`),
    ]);

    await client.query('COMMIT');

    return res.json({
      status: 'ok',
      tenant: { id: req.tenant.id, name: req.tenant.name },
      overview: {
        ...docsRes.rows[0],
        ...chunksRes.rows[0],
        ...queriesRes.rows[0],
        ...acksRes.rows[0],
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur GET /api/admin/overview:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load admin overview',
    });
  } finally {
    client.release();
  }
});

router.get('/admin/escalations', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
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
         created_at
       FROM query_logs
       WHERE unanswered_flag = true OR was_escalated = true
       ORDER BY created_at DESC
       LIMIT 50`
    );

    await client.query('COMMIT');

    return res.json({
      status: 'ok',
      tenant: { id: req.tenant.id, name: req.tenant.name },
      escalations: result.rows,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur GET /api/admin/escalations:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load escalations',
    });
  } finally {
    client.release();
  }
});

module.exports = router;
