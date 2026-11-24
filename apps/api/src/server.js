require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const db = require('./services/db');
const statusRoute = require('./routes/status');
const tenantAuth = require('./middleware/tenantAuth');
const queryRoute = require('./routes/query');
const documentsRoute = require('./routes/documents');
const acknowledgmentsRoute = require('./routes/acknowledgments');
const adminRoute = require('./routes/admin');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'bob-api-gateway' });
});

app.get('/health/db', async (req, res) => {
  try {
    const result = await db.query('SELECT 1 AS ok, current_database() AS database');
    res.json({
      status: 'ok',
      db: result.rows[0],
    });
  } catch (err) {
    console.error('Erreur connexion PostgreSQL:', err.message);
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
    });
  }
});

app.use('/api', statusRoute);
app.use('/api', tenantAuth, queryRoute);
app.use('/api', tenantAuth, documentsRoute);
app.use('/api', tenantAuth, acknowledgmentsRoute);
app.use('/api', tenantAuth, tenantAuth.requireAdminRole, adminRoute);

if (process.env.RUN_KEY_ROTATION === '1') {
  const { Client } = require('pg');
  const rotationSql = `
  BEGIN;
  UPDATE tenant_api_keys
  SET revoked_at = NOW()
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND revoked_at IS NULL;

  INSERT INTO tenant_api_keys (tenant_id, role, key_prefix, key_hash, label)
  VALUES
    ('11111111-1111-1111-1111-111111111111', 'client', 'bob_client_dc635', 'f0d5a11a90acf054c1d32b7a5240f0b1e76bd28645c93392aafb77d4486401ce', 'Demo Client'),
    ('11111111-1111-1111-1111-111111111111', 'admin', 'bob_admin_d2160e', '8b4c278d129a31c0d7fa71948fda83b6f40500e3e04b25563070b2a1db4aa73b', 'Demo Admin');
  COMMIT;
  `;
  (async () => {
    const client = new Client({
      connectionString: process.env.SCALINGO_POSTGRESQL_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    await client.query(rotationSql);
    await client.end();
    console.log('ROTATION_SQL_SUCCESS');
  })().catch((err) => {
    console.error('ROTATION_SQL_ERROR', err.message);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BOB API Gateway démarrée sur http://localhost:${PORT}`);
});
