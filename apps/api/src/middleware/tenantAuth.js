const crypto = require('crypto');
const db = require('../services/db');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function extractApiKey(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (typeof req.headers['x-api-key'] === 'string') {
    return req.headers['x-api-key'].trim();
  }
  return null;
}

async function runQuery(text, params) {
  if (db && typeof db.query === 'function') {
    return db.query(text, params);
  }
  if (db && db.pool && typeof db.pool.query === 'function') {
    return db.pool.query(text, params);
  }
  throw new Error('Pool PostgreSQL indisponible dans services/db');
}

async function tenantAuth(req, res, next) {
  try {
    const rawKey = extractApiKey(req);

    if (rawKey) {
      const keyHash = sha256(rawKey);
      const { rows } = await runQuery(
        `SELECT k.id, k.tenant_id, k.role, t.name AS tenant_name
         FROM tenant_api_keys k
         JOIN tenants t ON t.id = k.tenant_id
         WHERE k.key_hash = $1 AND k.revoked_at IS NULL
         LIMIT 1`,
        [keyHash]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Clé API invalide ou révoquée' });
      }

      req.tenantId = rows[0].tenant_id;
      req.tenant = { id: rows[0].tenant_id, name: rows[0].tenant_name };
      req.tenantName = rows[0].tenant_name;
      req.apiKeyRole = rows[0].role;

      runQuery('UPDATE tenant_api_keys SET last_used_at = NOW() WHERE id = $1', [rows[0].id]).catch(() => {});
      return next();
    }

    if (process.env.ALLOW_LEGACY_TENANT_HEADER === 'true') {
      const legacyTenantId = req.headers['x-tenant-id'];
      if (typeof legacyTenantId === 'string' && UUID_REGEX.test(legacyTenantId)) {
        req.tenantId = legacyTenantId;
        req.tenant = { id: legacyTenantId };
        req.apiKeyRole = 'admin';
        return next();
      }
    }

    return res.status(401).json({ error: 'Authentification requise (Authorization: Bearer <api_key>)' });
  } catch (err) {
    console.error('Erreur tenantAuth:', err);
    return res.status(500).json({ error: 'Erreur interne authentification' });
  }
}

function requireAdminRole(req, res, next) {
  if (req.apiKeyRole !== 'admin') {
    return res.status(403).json({ error: 'Droits administrateur requis pour cette action' });
  }
  return next();
}

tenantAuth.tenantAuth = tenantAuth;
tenantAuth.requireAdminRole = requireAdminRole;

module.exports = tenantAuth;
