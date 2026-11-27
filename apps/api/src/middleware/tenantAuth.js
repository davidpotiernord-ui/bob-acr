const crypto = require("crypto");
const db = require("../services/db");
const { ADMIN_USER_ROLES } = require("../services/authService");
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sha256(v) { return crypto.createHash("sha256").update(v).digest("hex"); }
function extractBearerOrApiKey(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7).trim();
  if (typeof req.headers["x-api-key"] === "string") return req.headers["x-api-key"].trim();
  return null;
}
async function runQuery(text, params) {
  if (db && typeof db.query === "function") return db.query(text, params);
  if (db && db.pool && typeof db.pool.query === "function") return db.pool.query(text, params);
  throw new Error("Pool PostgreSQL indisponible");
}
async function tenantAuth(req, res, next) {
  try {
    const rawToken = extractBearerOrApiKey(req);
    if (rawToken && rawToken.startsWith("bob" + "_sess_")) {
      const { rows } = await runQuery("SELECT s.id AS session_id, s.tenant_id, s.auth_method, t.name AS tenant_name, t.auth_mode, u.id AS user_id, u.email, u.full_name, u.role AS user_role, u.is_active FROM user_sessions s JOIN tenants t ON t.id = s.tenant_id JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() LIMIT 1", [sha256(rawToken)]);
      if (rows.length === 0 || !rows[0].is_active) return res.status(401).json({ error: "Session expirée ou invalide" });
      const r = rows[0];
      req.authType = r.auth_method; req.tenantId = r.tenant_id;
      req.tenant = { id: r.tenant_id, name: r.tenant_name, authMode: r.auth_mode }; req.tenantName = r.tenant_name;
      req.userId = r.user_id; req.user = { id: r.user_id, email: r.email, fullName: r.full_name, role: r.user_role };
      req.apiKeyRole = ADMIN_USER_ROLES.has(r.user_role) ? "admin" : "client";
      return next();
    }
    if (rawToken) {
      const { rows } = await runQuery("SELECT k.id, k.tenant_id, k.role, t.name AS tenant_name, t.auth_mode FROM tenant_api_keys k JOIN tenants t ON t.id = k.tenant_id WHERE k.key_hash = $1 AND k.revoked_at IS NULL LIMIT 1", [sha256(rawToken)]);
      if (rows.length === 0) return res.status(401).json({ error: "Clé API invalide ou révoquée" });
      req.authType = "api_key"; req.tenantId = rows[0].tenant_id;
      req.tenant = { id: rows[0].tenant_id, name: rows[0].tenant_name, authMode: rows[0].auth_mode }; req.tenantName = rows[0].tenant_name; req.apiKeyRole = rows[0].role;
      runQuery("UPDATE tenant_api_keys SET last_used_at = NOW() WHERE id = $1", [rows[0].id]).catch(() => {});
      return next();
    }
    if (process.env.ALLOW_LEGACY_TENANT_HEADER === "true") {
      const tid = req.headers["x-tenant-id"];
      if (typeof tid === "string" && UUID_REGEX.test(tid)) { req.tenantId = tid; req.tenant = { id: tid }; req.apiKeyRole = "admin"; return next(); }
    }
    return res.status(401).json({ error: "Authentification requise" });
  } catch (err) { console.error("Erreur tenantAuth:", err); return res.status(500).json({ error: "Erreur interne authentification" }); }
}
function requireAdminRole(req, res, next) {
  if (req.apiKeyRole !== "admin") return res.status(403).json({ error: "Droits administrateur requis" });
  return next();
}
tenantAuth.tenantAuth = tenantAuth; tenantAuth.requireAdminRole = requireAdminRole; module.exports = tenantAuth;