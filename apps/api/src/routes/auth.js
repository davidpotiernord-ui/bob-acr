const express = require("express");
const db = require("../services/db");
const tenantAuth = require("../middleware/tenantAuth");
const { ADMIN_USER_ROLES, sha256, hashPassword, verifyPassword, signOAuthState, verifyOAuthState, decodeJwtPayload, resolveOidcEndpoints, createUserSession, findTenantByEmailDomain } = require("../services/authService");
const router = express.Router();
function getPublicApiUrl(req) { if (process.env.API_PUBLIC_URL) return process.env.API_PUBLIC_URL.replace(/\/$/, ""); return (req.headers["x-forwarded-proto"] || req.protocol || "https") + "://" + req.get("host"); }
function getDefaultRedirectUrl() { return (process.env.ADMIN_APP_URL || "http://localhost:5174").replace(/\/$/, ""); }
router.post("/discover", async (req, res) => { try { const email = String(req.body?.email || "").trim().toLowerCase(); const tenantSlug = String(req.body?.tenantSlug || "").trim().toLowerCase(); let tenant = null; if (tenantSlug) { const { rows } = await db.query("SELECT id, name, slug, auth_mode, sso_provider FROM tenants WHERE slug = $1 LIMIT 1", [tenantSlug]); tenant = rows[0] || null; } else if (email.includes("@")) { tenant = await findTenantByEmailDomain(email); } if (!tenant) return res.status(404).json({ error: "Aucune organisation rattachée à cet email." }); if (tenant.auth_mode === "sso") { const redirectUri = req.body?.redirectUri || getDefaultRedirectUrl(); const loginUrl = getPublicApiUrl(req) + "/auth/sso/login?tenantId=" + encodeURIComponent(tenant.id) + "&email=" + encodeURIComponent(email) + "&redirectUri=" + encodeURIComponent(redirectUri); return res.json({ mode: "sso", tenantId: tenant.id, tenantName: tenant.name, ssoProvider: tenant.sso_provider || "oidc", loginUrl }); } return res.json({ mode: "local_email", tenantId: tenant.id, tenantName: tenant.name }); } catch (err) { console.error("Erreur POST /auth/discover:", err); return res.status(500).json({ error: "Erreur détection mode authentification" }); } });
router.post("/login", async (req, res) => { try { const email = String(req.body?.email || "").trim().toLowerCase(); const password = String(req.body?.password || ""); if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" }); const tenant = await findTenantByEmailDomain(email); if (!tenant) return res.status(401).json({ error: "Identifiants invalides" }); if (tenant.auth_mode === "sso") return res.status(403).json({ error: "Connexion SSO imposée pour cette organisation", mode: "sso" }); const { rows } = await db.query("SELECT id, tenant_id, email, full_name, role, password_hash, is_active FROM users WHERE tenant_id = $1 AND LOWER(email) = $2 LIMIT 1", [tenant.id, email]); const user = rows[0]; if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: "Identifiants invalides" }); await db.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]); const session = await createUserSession({ tenantId: tenant.id, userId: user.id, authMethod: "local_email" }); return res.json({ token: session.token, expiresAt: session.expiresAt, user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, tenantId: tenant.id, tenantName: tenant.name } }); } catch (err) { console.error("Erreur POST /auth/login:", err); return res.status(500).json({ error: "Erreur connexion" }); } });
router.get("/sso/login", async (req, res) => { try { const tenantId = String(req.query.tenantId || "").trim(); const loginHint = String(req.query.email || "").trim(); const redirectUri = String(req.query.redirectUri || getDefaultRedirectUrl()).trim(); if (!tenantId) return res.status(400).json({ error: "tenantId requis" }); const { rows } = await db.query("SELECT id, name, auth_mode, sso_issuer_url, sso_client_id, sso_authorize_url, sso_token_url, sso_userinfo_url, sso_scopes FROM tenants WHERE id = $1 LIMIT 1", [tenantId]); const tenant = rows[0]; if (!tenant || tenant.auth_mode !== "sso") return res.status(400).json({ error: "SSO non activé" }); if (!tenant.sso_client_id) return res.status(500).json({ error: "sso_client_id manquant" }); const oidc = await resolveOidcEndpoints(tenant); const authUrl = new URL(oidc.authorization_endpoint); authUrl.searchParams.set("client_id", tenant.sso_client_id); authUrl.searchParams.set("response_type", "code"); authUrl.searchParams.set("scope", tenant.sso_scopes || "openid profile email"); authUrl.searchParams.set("redirect_uri", getPublicApiUrl(req) + "/auth/sso/callback"); authUrl.searchParams.set("state", signOAuthState({ tenantId: tenant.id, redirectUri })); if (loginHint) authUrl.searchParams.set("login_hint", loginHint); return res.redirect(authUrl.toString()); } catch (err) { console.error("Erreur GET /auth/sso/login:", err); return res.status(500).json({ error: err.message || "Erreur initialisation SSO" }); } });
router.get("/sso/callback", async (req, res) => { try { const code = String(req.query.code || ""); const stateData = verifyOAuthState(String(req.query.state || "")); if (!code || !stateData?.tenantId) return res.status(400).json({ error: "Paramètres SSO invalides ou expirés" }); const { rows: tRows } = await db.query("SELECT id, name, auth_mode, allowed_email_domains, sso_issuer_url, sso_client_id, sso_client_secret, sso_authorize_url, sso_token_url, sso_userinfo_url FROM tenants WHERE id = $1 LIMIT 1", [stateData.tenantId]); const tenant = tRows[0]; if (!tenant || tenant.auth_mode !== "sso") return res.status(403).json({ error: "Tenant SSO invalide" }); const oidc = await resolveOidcEndpoints(tenant); const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: getPublicApiUrl(req) + "/auth/sso/callback", client_id: tenant.sso_client_id }); if (tenant.sso_client_secret) body.set("client_secret", tenant.sso_client_secret); const tResp = await fetch(oidc.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() }); if (!tResp.ok) return res.status(401).json({ error: "Échec échange jeton OIDC" }); const tokens = await tResp.json(); let claims = decodeJwtPayload(tokens.id_token) || {}; if ((!claims.email || !claims.sub) && oidc.userinfo_endpoint && tokens.access_token) { const uResp = await fetch(oidc.userinfo_endpoint, { headers: { Authorization: "Bearer " + tokens.access_token } }); if (uResp.ok) claims = { ...claims, ...(await uResp.json()) }; } const subjectId = String(claims.sub || "").trim(); const email = String(claims.email || claims.preferred_username || claims.upn || "").trim().toLowerCase(); const fullName = String(claims.name || ((claims.given_name || "") + " " + (claims.family_name || ""))).trim() || email; if (!subjectId || !email.includes("@")) return res.status(401).json({ error: "Identité SSO incomplète" }); const domain = email.split("@")[1]; if (Array.isArray(tenant.allowed_email_domains) && tenant.allowed_email_domains.length > 0 && !tenant.allowed_email_domains.includes(domain)) { return res.status(403).json({ error: "Domaine email non autorisé" }); } const { rows: uRows } = await db.query("INSERT INTO users (tenant_id, sso_subject_id, email, full_name, auth_provider, is_active, last_login_at) VALUES ($1, $2, $3, $4, 'sso', TRUE, NOW()) ON CONFLICT (tenant_id, sso_subject_id) DO UPDATE SET email = EXCLUDED.email, full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), users.full_name), last_login_at = NOW() RETURNING id, email, full_name, role, is_active", [tenant.id, subjectId, email, fullName]); const user = uRows[0]; if (!user || !user.is_active) return res.status(403).json({ error: "Compte désactivé" }); const session = await createUserSession({ tenantId: tenant.id, userId: user.id, authMethod: "sso" }); const targetUrl = new URL(stateData.redirectUri || getDefaultRedirectUrl()); targetUrl.hash = "bob_token=" + encodeURIComponent(session.token); return res.redirect(targetUrl.toString()); } catch (err) { console.error("Erreur GET /auth/sso/callback:", err); return res.status(500).json({ error: "Erreur retour SSO" }); } });
router.get("/me", tenantAuth, (req, res) => res.json({ tenant: req.tenant, authType: req.authType, role: req.apiKeyRole, user: req.user || null }));
router.post("/logout", async (req, res) => { const h = req.headers.authorization || ""; const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : ""; if (tok.startsWith("bob" + "_sess_")) await db.query("UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = $1", [sha256(tok)]).catch(() => {}); res.json({ status: "ok" }); });

router.get("/tenant-config", tenantAuth, async (req, res) => {
  try {
    const role = req.user?.role || req.apiKeyRole || "";
    if (role && !["admin", "admin_rh", "owner"].includes(String(role).toLowerCase())) return res.status(403).json({ error: "Droits administrateur requis" });
    const { rows } = await db.query(
      "SELECT id, name, slug, auth_mode, allowed_email_domains, sso_provider, sso_issuer_url, sso_client_id, (sso_client_secret IS NOT NULL AND sso_client_secret <> '') AS has_client_secret FROM tenants WHERE id = $1 LIMIT 1",
      [req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Tenant introuvable" });
    return res.json({ tenant: rows[0] });
  } catch (err) {
    console.error("Erreur GET /auth/tenant-config:", err);
    return res.status(500).json({ error: "Erreur lecture configuration SSO" });
  }
});

router.put("/tenant-config", tenantAuth, async (req, res) => {
  try {
    const role = req.user?.role || req.apiKeyRole || "";
    if (role && !["admin", "admin_rh", "owner"].includes(String(role).toLowerCase())) return res.status(403).json({ error: "Droits administrateur requis" });
    const authMode = req.body?.auth_mode === "sso" ? "sso" : "local_email";
    const ssoProvider = String(req.body?.sso_provider || "microsoft_entra").trim() || "oidc";
    const ssoIssuerUrl = String(req.body?.sso_issuer_url || "").trim() || null;
    const ssoClientId = String(req.body?.sso_client_id || "").trim() || null;
    const ssoClientSecret = String(req.body?.sso_client_secret || "").trim();
    const rawDomains = Array.isArray(req.body?.allowed_email_domains)
      ? req.body.allowed_email_domains
      : String(req.body?.allowed_email_domains || "").split(",");
    const domains = rawDomains.map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean);

    if (authMode === "sso" && (!ssoIssuerUrl || !ssoClientId)) {
      return res.status(400).json({ error: "sso_issuer_url et sso_client_id sont requis en mode SSO." });
    }

    const params = [authMode, domains, ssoProvider, ssoIssuerUrl, ssoClientId, req.tenant.id];
    let sql = "UPDATE tenants SET auth_mode = $1, allowed_email_domains = $2, sso_provider = $3, sso_issuer_url = $4, sso_client_id = $5";
    if (ssoClientSecret) {
      params.push(ssoClientSecret);
      sql += ", sso_client_secret = $" + params.length;
    }
    sql += " WHERE id = $6 RETURNING id, name, slug, auth_mode, allowed_email_domains, sso_provider, sso_issuer_url, sso_client_id, (sso_client_secret IS NOT NULL AND sso_client_secret <> '') AS has_client_secret";

    const { rows } = await db.query(sql, params);
    return res.json({ status: "ok", tenant: rows[0] });
  } catch (err) {
    console.error("Erreur PUT /auth/tenant-config:", err);
    return res.status(500).json({ error: "Erreur sauvegarde configuration SSO" });
  }
});


function canManageLocalUsers(req) {
  const role = String(req.user?.role || req.apiKeyRole || "").toLowerCase();
  return req.apiKeyRole === "admin" || ADMIN_USER_ROLES.has(role) || ["admin", "owner"].includes(role);
}

router.get("/local-users", tenantAuth, async (req, res) => {
  try {
    if (!canManageLocalUsers(req)) {
      return res.status(403).json({ error: "Droits administrateur requis" });
    }
    const tenantId = req.tenantId || req.tenant?.id;
    const { rows } = await db.query(
      "SELECT id, tenant_id, email, full_name, role, auth_provider, is_active, last_login_at, created_at FROM users WHERE tenant_id = $1 AND COALESCE(auth_provider, 'local_email') = 'local_email' ORDER BY created_at DESC, email ASC",
      [tenantId]
    );
    return res.json({ users: rows });
  } catch (err) {
    console.error("Erreur GET /auth/local-users:", err);
    return res.status(500).json({ error: "Erreur chargement utilisateurs locaux" });
  }
});

router.post("/local-users", tenantAuth, async (req, res) => {
  try {
    if (!canManageLocalUsers(req)) {
      return res.status(403).json({ error: "Droits administrateur requis" });
    }
    const tenantId = req.tenantId || req.tenant?.id;
    const email = String(req.body?.email || "").trim().toLowerCase();
    const fullName = String(req.body?.fullName ?? req.body?.full_name ?? "").trim();
    const role = String(req.body?.role || "employee").trim();
    const password = String(req.body?.password || "");

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Adresse email valide requise" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Mot de passe de 8 caractères minimum requis" });
    }

    const { rows: existing } = await db.query(
      "SELECT id FROM users WHERE tenant_id = $1 AND LOWER(email) = $2 LIMIT 1",
      [tenantId, email]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: "Un utilisateur avec cet email existe déjà" });
    }

    const passwordHash = hashPassword(password);
    const { rows } = await db.query(
      "INSERT INTO users (tenant_id, email, full_name, role, auth_provider, password_hash, is_active) VALUES ($1, $2, $3, $4, 'local_email', $5, TRUE) RETURNING id, tenant_id, email, full_name, role, auth_provider, is_active, last_login_at, created_at",
      [tenantId, email, fullName || email.split("@")[0], role || "employee", passwordHash]
    );
    return res.status(201).json({ user: rows[0] });
  } catch (err) {
    console.error("Erreur POST /auth/local-users:", err);
    return res.status(500).json({ error: "Erreur création utilisateur local" });
  }
});

router.patch("/local-users/:userId", tenantAuth, async (req, res) => {
  try {
    if (!canManageLocalUsers(req)) {
      return res.status(403).json({ error: "Droits administrateur requis" });
    }
    const tenantId = req.tenantId || req.tenant?.id;
    const userId = String(req.params.userId || "").trim();
    const updates = [];
    const params = [tenantId, userId];

    if (typeof req.body?.is_active === "boolean") {
      params.push(req.body.is_active);
      updates.push(`is_active = $${params.length}`);
    } else if (typeof req.body?.isActive === "boolean") {
      params.push(req.body.isActive);
      updates.push(`is_active = $${params.length}`);
    }

    if (typeof req.body?.role === "string" && req.body.role.trim()) {
      params.push(req.body.role.trim());
      updates.push(`role = $${params.length}`);
    }

    if (typeof req.body?.fullName === "string" || typeof req.body?.full_name === "string") {
      const nameVal = String(req.body.fullName ?? req.body.full_name).trim();
      params.push(nameVal);
      updates.push(`full_name = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "Aucune modification fournie" });
    }

    const { rows } = await db.query(
      `UPDATE users SET ${updates.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING id, tenant_id, email, full_name, role, auth_provider, is_active, last_login_at, created_at`,
      params
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }
    return res.json({ user: rows[0] });
  } catch (err) {
    console.error("Erreur PATCH /auth/local-users/:userId:", err);
    return res.status(500).json({ error: "Erreur mise à jour utilisateur" });
  }
});

router.post("/local-users/:userId/reset-password", tenantAuth, async (req, res) => {
  try {
    if (!canManageLocalUsers(req)) {
      return res.status(403).json({ error: "Droits administrateur requis" });
    }
    const tenantId = req.tenantId || req.tenant?.id;
    const userId = String(req.params.userId || "").trim();
    const newPassword = String(req.body?.password || "");
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Nouveau mot de passe de 8 caractères minimum requis" });
    }
    const passwordHash = hashPassword(newPassword);
    const { rows } = await db.query(
      "UPDATE users SET password_hash = $3 WHERE tenant_id = $1 AND id = $2 RETURNING id, email",
      [tenantId, userId, passwordHash]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }
    await db.query(
      "UPDATE user_sessions SET revoked_at = NOW() WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL",
      [tenantId, userId]
    ).catch(() => {});
    return res.json({ status: "ok", user: rows[0] });
  } catch (err) {
    console.error("Erreur POST /auth/local-users/:userId/reset-password:", err);
    return res.status(500).json({ error: "Erreur réinitialisation mot de passe" });
  }
});

module.exports = router;
