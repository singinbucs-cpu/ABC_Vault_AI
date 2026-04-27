const { requireAppUser } = require("../lib/auth");
const {
  getVercelSpendWebhookSettings,
  updateVercelSpendWebhookSettings,
} = require("../lib/vercel-spend-webhook-db");
const { buildWebhookUrl, isVercelSpendWebhookConfigured } = require("../lib/vercel-spend-webhook");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "PATCH"].includes(req.method)) {
    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }, null, 2));
    return;
  }

  const auth = await requireAppUser(req, res, { requireRole: "admin" });
  if (!auth) {
    return;
  }

  if (req.method === "PATCH") {
    try {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : typeof req.body === "object" && req.body
          ? req.body
          : {};

      const settings = await updateVercelSpendWebhookSettings({
        enabled: Boolean(body.enabled),
        notifyBillingCycleEnd: Boolean(body.notifyBillingCycleEnd),
        criticalBudgetReached: Boolean(body.criticalBudgetReached),
        criticalBillingCycleEnd: Boolean(body.criticalBillingCycleEnd),
      });

      res.status(200).send(
        JSON.stringify(
          {
            settings,
            webhookUrl: buildWebhookUrl(),
            secretConfigured: isVercelSpendWebhookConfigured(),
          },
          null,
          2,
        ),
      );
      return;
    } catch (error) {
      res.status(400).send(
        JSON.stringify(
          {
            error: "vercel_spend_webhook_settings_failed",
            message: error.message || "Unable to save Vercel spend webhook settings.",
          },
          null,
          2,
        ),
      );
      return;
    }
  }

  const settings = await getVercelSpendWebhookSettings();

  res.status(200).send(
    JSON.stringify(
      {
        settings,
        webhookUrl: buildWebhookUrl(),
        secretConfigured: isVercelSpendWebhookConfigured(),
      },
      null,
      2,
    ),
  );
};
