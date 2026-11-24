const { Client } = require('pg');

const sql = `
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
  await client.query(sql);
  await client.end();
  console.log('ROTATION_SQL_SUCCESS');
})().catch((err) => {
  console.error('ROTATION_SQL_ERROR', err.message);
  process.exit(1);
});
