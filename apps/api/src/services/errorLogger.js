const db = require("./db");

function sanitizeSummary(raw) {
  return String(raw || "Erreur technique non détaillée")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email_masque]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [token_masque]")
    .replace(/bob_(admin|prov)_[a-f0-9]+/gi, "[cle_masquee]")
    .slice(0, 500);
}

async function logProviderError({
  tenantId = null,
  category = "api_gateway",
  severity = "error",
  errorCode = "ERR_GENERIC",
  httpStatus = null,
  summary = "Erreur technique non détaillée",
  endpoint = null,
  recommendedAction = null,
}) {
  const client = await db.pool.connect();
  try {
    await client.query("SELECT set_config('app.provider_mode', 'on', false)");

    const cleanCategory = String(category).slice(0, 50);
    const cleanSeverity = ["warning", "error", "critical"].includes(severity) ? severity : "error";
    const cleanCode = errorCode ? String(errorCode).slice(0, 100) : "ERR_GENERIC";
    const cleanEndpoint = endpoint ? String(endpoint).slice(0, 150) : null;
    const cleanSummary = sanitizeSummary(summary);
    const cleanAction = recommendedAction ? String(recommendedAction).slice(0, 255) : null;
    const cleanStatus = Number.isInteger(httpStatus) ? httpStatus : null;

    // Déduplication sur incident ouvert identique pour ce tenant
    const existing = await client.query(
      `
      SELECT id
      FROM provider_error_logs
      WHERE resolved_at IS NULL
        AND tenant_id IS NOT DISTINCT FROM $1::uuid
        AND category = $2
        AND error_code IS NOT DISTINCT FROM $3
        AND endpoint IS NOT DISTINCT FROM $4
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [tenantId || null, cleanCategory, cleanCode, cleanEndpoint]
    );

    if (existing.rows[0]) {
      await client.query(
        `
        UPDATE provider_error_logs
        SET occurrences_count = occurrences_count + 1,
            last_seen_at = NOW(),
            summary = $1,
            http_status = COALESCE($2, http_status),
            recommended_action = COALESCE($3, recommended_action)
        WHERE id = $4
        `,
        [cleanSummary, cleanStatus, cleanAction, existing.rows[0].id]
      );
      return;
    }

    await client.query(
      `
      INSERT INTO provider_error_logs (
        tenant_id,
        category,
        severity,
        error_code,
        http_status,
        summary,
        endpoint,
        recommended_action
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        tenantId || null,
        cleanCategory,
        cleanSeverity,
        cleanCode,
        cleanStatus,
        cleanSummary,
        cleanEndpoint,
        cleanAction,
      ]
    );
  } catch (err) {
    console.error("[errorLogger] Échec enregistrement log provider:", err.message);
  } finally {
    client.release();
  }
}

module.exports = { logProviderError };
