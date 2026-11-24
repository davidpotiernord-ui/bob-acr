const express = require('express');
const db = require('../services/db');

const router = express.Router();

router.get('/acknowledgments', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const result = await client.query(
      `SELECT
         a.id,
         a.document_id,
         d.title AS document_title,
         d.module_code,
         a.document_version,
         d.sha256_hash,
         a.user_id,
         u.email AS user_email,
         u.full_name,
         u.department,
         a.acknowledged_at
       FROM acknowledgments a
       JOIN documents d ON d.id = a.document_id
       JOIN users u ON u.id = a.user_id
       ORDER BY a.acknowledged_at DESC`
    );

    await client.query('COMMIT');
    return res.json({
      status: 'ok',
      tenant: { id: req.tenant.id, name: req.tenant.name },
      acknowledgments: result.rows,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur GET /api/acknowledgments:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to list acknowledgments',
    });
  } finally {
    client.release();
  }
});

router.post('/acknowledgments', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      document_id,
      user_id = null,
      user_email = null,
      full_name = null,
      department = null,
    } = req.body || {};

    if (!document_id || typeof document_id !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Field "document_id" is required' });
    }
    if (!user_id && (!user_email || typeof user_email !== 'string')) {
      return res.status(400).json({
        status: 'error',
        message: 'Either "user_id" or "user_email" is required',
      });
    }

    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const docRes = await client.query(
      `SELECT id, title, module_code, version, sha256_hash, status
       FROM documents
       WHERE id = $1
       LIMIT 1`,
      [document_id]
    );

    if (docRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', message: 'Document not found for tenant' });
    }

    const doc = docRes.rows[0];
    let resolvedUser = null;

    if (user_id) {
      const uRes = await client.query(
        `SELECT id, email, full_name, department FROM users WHERE id = $1 LIMIT 1`,
        [user_id]
      );
      if (uRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ status: 'error', message: 'User not found for tenant' });
      }
      resolvedUser = uRes.rows[0];
    } else {
      const cleanEmail = user_email.trim().toLowerCase().slice(0, 255);
      const uRes = await client.query(
        `INSERT INTO users (tenant_id, email, full_name, department, role, auth_provider)
         VALUES ($1, $2, $3, $4, 'employee', 'sso')
         ON CONFLICT (tenant_id, email)
         DO UPDATE SET
           full_name = COALESCE(EXCLUDED.full_name, users.full_name),
           department = COALESCE(EXCLUDED.department, users.department)
         RETURNING id, email, full_name, department`,
        [
          req.tenant.id,
          cleanEmail,
          full_name ? String(full_name).trim().slice(0, 255) : null,
          department ? String(department).trim().slice(0, 100) : null,
        ]
      );
      resolvedUser = uRes.rows[0];
    }

    const ackRes = await client.query(
      `INSERT INTO acknowledgments (
         tenant_id,
         document_id,
         user_id,
         document_version
       )
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (document_id, user_id, document_version)
       DO UPDATE SET acknowledged_at = acknowledgments.acknowledged_at
       RETURNING id, document_id, user_id, document_version, acknowledged_at`,
      [req.tenant.id, doc.id, resolvedUser.id, doc.version]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      status: 'ok',
      tenant: { id: req.tenant.id, name: req.tenant.name },
      acknowledgment: ackRes.rows[0],
      proof: {
        document_title: doc.title,
        module_code: doc.module_code,
        document_version: doc.version,
        sha256_hash: doc.sha256_hash,
        user_email: resolvedUser.email,
        full_name: resolvedUser.full_name,
        acknowledged_at: ackRes.rows[0].acknowledged_at,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur POST /api/acknowledgments:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to record acknowledgment',
    });
  } finally {
    client.release();
  }
});

module.exports = router;
