const db = require("./db");

async function logProviderError({
  tenantId = null,
  category = "api_gateway",
  severity = "error",
  errorCode = null,
  summary = "Erreur technique non détaillée",
  endpoint = null,
}) {
  const client = await db.pool.connect();
  try {
    await client.query("SELECT set_config('app.provider_mode', 'on', false)");
    await client.query(
      `
      INSERT INTO provider_error_logs (
        tenant_id,
        category,
        severity,
        error_code,
        summary,
        endpoint
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        tenantId || null,
        String(category).slice(0, 50),
        ["warning", "error", "critical"].includes(severity) ? severity : "error",
        errorCode ? String(errorCode).slice(0, 100) : null,
        String(summary).slice(0, 500),
        endpoint ? String(endpoint).slice(0, 150) : null,
      ]
    );
  } catch (err) {
    console.error("[errorLogger] Échec enregistrement log provider:", err.message);
  } finally {
    client.release();
  }
}

module.exports = { logProviderError };
