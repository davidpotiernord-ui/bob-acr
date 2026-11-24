const { Pool } = require('pg');

const connectionString = process.env.SCALINGO_POSTGRESQL_URL || process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes('scalingo')
    ? { rejectUnauthorized: false }
    : false,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
