import 'dotenv/config';
import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;
const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('scalingo') ? { rejectUnauthorized: false } : false,
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('client', 'admin')),
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_hash ON tenant_api_keys(key_hash) WHERE revoked_at IS NULL;
    `);

    const clientPlain = `bob_client_${crypto.randomBytes(24).toString('hex')}`;
    const adminPlain = `bob_admin_${crypto.randomBytes(24).toString('hex')}`;

    await client.query(
      `INSERT INTO tenant_api_keys (tenant_id, label, role, key_prefix, key_hash)
       VALUES
         ($1, 'Extension Chrome & Widget Teams (Production)', 'client', $2, $3),
         ($1, 'Cockpit Gouvernance & Conformité (Admin)', 'admin', $4, $5)`,
      [
        DEMO_TENANT_ID,
        clientPlain.slice(0, 16),
        sha256(clientPlain),
        adminPlain.slice(0, 15),
        sha256(adminPlain),
      ]
    );

    console.log('=== CLÉS API GÉNÉRÉES (À CONSERVER PRÉCIEUSEMENT) ===');
    console.log('CLIENT_API_KEY (widget / extension) :', clientPlain);
    console.log('ADMIN_API_KEY  (cockpit web-admin)  :', adminPlain);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Erreur setupApiKeys:', err);
  process.exit(1);
});
