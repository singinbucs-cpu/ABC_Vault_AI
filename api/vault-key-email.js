const {
  getVaultEmailConfig,
  ingestVaultKeyEmail,
  isVaultEmailIngestConfigured,
  isVaultEmailRequestAuthorized,
} = require("../lib/vault-key-email");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }, null, 2));
    return;
  }

  if (req.method === "GET") {
    const config = getVaultEmailConfig();
    res.status(200).send(
      JSON.stringify(
        {
          configured: isVaultEmailIngestConfigured(),
          forwardingAddress: config.forwardingAddress || null,
          appUrl: config.appUrl || null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!isVaultEmailIngestConfigured()) {
    res.status(503).send(
      JSON.stringify(
        {
          error: "vault_email_not_configured",
          message: "Set VAULT_EMAIL_WEBHOOK_SECRET before using the inbound Vault Key email endpoint.",
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!isVaultEmailRequestAuthorized(req)) {
    res.status(401).send(
      JSON.stringify(
        {
          error: "unauthorized",
          message: "A valid Vault email webhook secret is required.",
        },
        null,
        2,
      ),
    );
    return;
  }

  try {
    const result = await ingestVaultKeyEmail(req.body || {});
    res.status(result.statusCode).send(JSON.stringify(result.payload, null, 2));
  } catch (error) {
    res.status(500).send(
      JSON.stringify(
        {
          error: "vault_email_ingest_failed",
          message: error.message || "Unable to process the inbound Vault Key email.",
        },
        null,
        2,
      ),
    );
  }
};
