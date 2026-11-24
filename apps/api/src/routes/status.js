const express = require('express');
const db = require('../services/db');

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const [tenantsRes, docsRes, queriesRes] = await Promise.all([
      db.query('SELECT count(*)::int AS count FROM tenants'),
      db.query('SELECT count(*)::int AS count FROM documents'),
      db.query('SELECT count(*)::int AS count FROM query_logs'),
    ]);

    res.json({
      status: 'ok',
      service: 'bob-api-gateway',
      counts: {
        tenants: tenantsRes.rows[0].count,
        documents: docsRes.rows[0].count,
        query_logs: queriesRes.rows[0].count,
      },
    });
  } catch (err) {
    console.error('Erreur /api/status:', err.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load status metrics',
    });
  }
});

module.exports = router;
