const { Pool } = require('pg');

const connectionString = process.env.SCALINGO_POSTGRESQL_URL || process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: connectionString && (connectionString.includes('scalingo') || process.env.PGSSLMODE === 'require')
    ? { rejectUnauthorized: false }
    : false,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Erreur inattendue sur un client PostgreSQL inactif (pg-pool):', err.message);
});

async function queryWithRetry(text, params, retries = 1) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    const isConnectionReset =
      retries > 0 &&
      (err.code === 'ECONNRESET' ||
        err.code === '57P01' ||
        (typeof err.message === 'string' &&
          (err.message.includes('Connection terminated unexpectedly') ||
            err.message.includes('terminating connection'))));

    if (isConnectionReset) {
      return pool.query(text, params);
    }
    throw err;
  }
}

module.exports = {
  query: (text, params) => queryWithRetry(text, params, 1),
  pool,
};
