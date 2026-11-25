const { Pool } = require('pg');

const rawUrl = process.env.SCALINGO_POSTGRESQL_URL || process.env.DATABASE_URL || '';

function buildCleanConnectionString(urlStr) {
  if (!urlStr) return '';
  try {
    const parsed = new URL(urlStr);
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    return urlStr.replace(/([?&])sslmode=[^&]+(&?)/, (_, p1, p2) => (p2 ? p1 : '')).replace(/\?$/, '');
  }
}

const connectionString = buildCleanConnectionString(rawUrl);
const isLocal =
  !connectionString ||
  connectionString.includes('localhost') ||
  connectionString.includes('127.0.0.1');

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('pg-pool idle client error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
