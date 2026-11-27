require("dotenv").config();
const express = require("express"); const helmet = require("helmet"); const cors = require("cors");
const db = require("./services/db");
const { logProviderError } = require("./services/errorLogger"); const statusRoute = require("./routes/status"); const authRoute = require("./routes/auth");
const tenantAuth = require("./middleware/tenantAuth"); const queryRoute = require("./routes/query"); const documentsRoute = require("./routes/documents");
const acknowledgmentsRoute = require("./routes/acknowledgments"); const adminRoute = require("./routes/admin"); const referentRoute = require("./routes/referent");
const providerAuth = require("./middleware/providerAuth");
const providerRoute = require("./routes/provider");
const app = express(); app.use(helmet()); app.use(cors()); app.use(express.json({ limit: "2mb" }));
app.get("/health", (req, res) => res.json({ status: "ok", service: "bob-api-gateway" }));
app.get("/health/db", async (req, res) => { try { const r = await db.query("SELECT 1 AS ok, current_database() AS database"); res.json({ status: "ok", db: r.rows[0] }); } catch (err) { res.status(500).json({ status: "error", message: "Database connection failed" }); } });
app.use("/auth", authRoute); app.use("/api", statusRoute); app.use("/api", referentRoute);
app.use("/api/provider", providerAuth, providerRoute);
app.use("/api", tenantAuth, queryRoute); app.use("/api", tenantAuth, documentsRoute); app.use("/api", tenantAuth, acknowledgmentsRoute); app.use("/api", tenantAuth, tenantAuth.requireAdminRole, adminRoute);
app.use(async (err, req, res, next) => {
  console.error("[Express Error]", err);
  await logProviderError({
    tenantId: req.tenant?.id || null,
    category: req.path?.includes("/query") ? "rag_query" : req.path?.includes("/auth") ? "sso_auth" : "api_gateway",
    severity: "error",
    errorCode: err.code || "UNHANDLED_API_ERROR",
    summary: err.message || "Erreur interne API",
    endpoint: `${req.method} ${req.originalUrl || req.path}`,
  });
  if (res.headersSent) return next(err);
  return res.status(err.status || 500).json({ error: "Erreur interne du serveur" });
});

const PORT = process.env.PORT || 3000; app.listen(PORT, () => console.log("BOB API Gateway sur http://localhost:" + PORT));