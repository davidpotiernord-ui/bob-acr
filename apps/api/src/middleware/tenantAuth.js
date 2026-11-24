const db = require('../services/db');

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tenantAuth(req, res, next) {
  try {
    const rawTenantId =
      req.header('x-tenant-id') ||
      (req.body && req.body.tenant_id) ||
      (req.query && req.query.tenant_id);

    if (!rawTenantId || typeof rawTenantId !== 'string') {
      return res.status(401).json({
        status: 'error',
        message: 'Missing tenant identifier',
      });
    }

    const tenantId = rawTenantId.trim();
    if (!UUID_REGEX.test(tenantId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid tenant identifier format',
      });
    }

    const result = await db.query(
      `SELECT id, name, slug, country_code, plan_tier, active_modules, escalation_contacts
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        status: 'error',
        message: 'Unknown or unauthorized tenant',
      });
    }

    req.tenant = result.rows[0];
    return next();
  } catch (err) {
    console.error('Erreur tenantAuth middleware:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Tenant verification failed',
    });
  }
}

module.exports = tenantAuth;
