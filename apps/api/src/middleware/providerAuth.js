const crypto = require("crypto");

function safeEqual(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = function providerAuth(req, res, next) {
  const expectedKey = process.env.BOB_PROVIDER_KEY;
  if (!expectedKey) {
    return res.status(503).json({
      error: "BOB_PROVIDER_KEY non configurée sur le serveur.",
    });
  }

  const headerKey =
    req.get("x-provider-key") ||
    (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

  if (!safeEqual(headerKey, expectedKey)) {
    return res.status(401).json({
      error: "Accès Console Provider refusé : clé opérateur invalide.",
    });
  }

  req.providerAuthenticated = true;
  return next();
};
