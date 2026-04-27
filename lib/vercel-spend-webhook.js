const crypto = require("crypto");
const { getVercelSpendWebhookSettings, recordVercelSpendWebhookEvent } = require("./vercel-spend-webhook-db");
const { notifyAdminsAboutVercelSpendEvent } = require("./pushover");

const DEFAULT_APP_URL = "https://abc-vault-live-scanner.vercel.app/";

function getVercelSpendWebhookConfig() {
  return {
    webhookSecret: (process.env.VERCEL_SPEND_WEBHOOK_SECRET || "").trim(),
    appUrl: (process.env.APP_BASE_URL || DEFAULT_APP_URL).trim() || DEFAULT_APP_URL,
  };
}

function isVercelSpendWebhookConfigured() {
  return Boolean(getVercelSpendWebhookConfig().webhookSecret);
}

function getHeaderValue(headers, name) {
  if (!headers || typeof headers !== "object") {
    return "";
  }

  return headers[name] || headers[name.toLowerCase()] || "";
}

function buildWebhookUrl() {
  return `${getVercelSpendWebhookConfig().appUrl.replace(/\/+$/, "")}/api/vercel-spend-webhook`;
}

function verifyVercelWebhookSignature(rawBody, signatureHeader) {
  const secret = getVercelSpendWebhookConfig().webhookSecret;
  if (!secret) {
    return false;
  }

  const expectedSignature = crypto.createHmac("sha1", secret).update(rawBody || "", "utf8").digest("hex");
  const actualSignature = String(signatureHeader || "").trim().toLowerCase();

  if (!actualSignature || actualSignature.length !== expectedSignature.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(actualSignature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

function classifySpendWebhookPayload(payload) {
  if (payload?.type === "endOfBillingCycle") {
    return {
      eventType: "end_of_billing_cycle",
      message: `Vercel billing cycle ended for ${payload.teamId || "the configured team"}.`,
      thresholdPercent: null,
      budgetAmount: null,
      currentSpend: null,
    };
  }

  const thresholdPercent = Number(payload?.thresholdPercent);
  const budgetAmount = Number(payload?.budgetAmount);
  const currentSpend = Number(payload?.currentSpend);

  if (Number.isFinite(thresholdPercent)) {
    return {
      eventType: "budget_threshold_reached",
      message: `Vercel spend hit ${thresholdPercent}% of budget (${Number.isFinite(currentSpend) ? `$${currentSpend}` : "unknown spend"} of ${Number.isFinite(budgetAmount) ? `$${budgetAmount}` : "unknown budget"}).`,
      thresholdPercent,
      budgetAmount: Number.isFinite(budgetAmount) ? budgetAmount : null,
      currentSpend: Number.isFinite(currentSpend) ? currentSpend : null,
    };
  }

  return {
    eventType: "unknown",
    message: "Received an unrecognized Vercel spend webhook payload.",
    thresholdPercent: null,
    budgetAmount: null,
    currentSpend: null,
  };
}

async function handleVercelSpendWebhook({ headers, rawBody, body }) {
  if (!isVercelSpendWebhookConfigured()) {
    return {
      statusCode: 503,
      payload: {
        error: "vercel_spend_webhook_not_configured",
        message: "Set VERCEL_SPEND_WEBHOOK_SECRET before using the Vercel spend webhook endpoint.",
      },
    };
  }

  const signature = getHeaderValue(headers, "x-vercel-signature");
  if (!verifyVercelWebhookSignature(rawBody, signature)) {
    return {
      statusCode: 401,
      payload: {
        error: "invalid_signature",
        message: "The Vercel webhook signature is invalid.",
      },
    };
  }

  const payload = typeof body === "object" && body ? body : {};
  const classification = classifySpendWebhookPayload(payload);
  const receivedAt = new Date().toISOString();
  const settings = await getVercelSpendWebhookSettings();

  const updatedSettings = await recordVercelSpendWebhookEvent({
    eventType: classification.eventType,
    message: classification.message,
    receivedAt,
    payload,
  });

  if (updatedSettings.enabled) {
    const shouldNotify =
      classification.eventType === "budget_threshold_reached" ||
      (classification.eventType === "end_of_billing_cycle" && updatedSettings.notifyBillingCycleEnd);

    if (shouldNotify) {
      await notifyAdminsAboutVercelSpendEvent({
        eventType: classification.eventType,
        teamId: payload.teamId || "",
        thresholdPercent: classification.thresholdPercent,
        budgetAmount: classification.budgetAmount,
        currentSpend: classification.currentSpend,
        critical:
          classification.eventType === "budget_threshold_reached"
            ? Boolean(updatedSettings.criticalBudgetReached)
            : Boolean(updatedSettings.criticalBillingCycleEnd),
      });
    }
  }

  return {
    statusCode: 200,
    payload: {
      ok: true,
      message: classification.message,
      eventType: classification.eventType,
      settings: updatedSettings,
    },
  };
}

module.exports = {
  buildWebhookUrl,
  getVercelSpendWebhookConfig,
  handleVercelSpendWebhook,
  isVercelSpendWebhookConfigured,
  verifyVercelWebhookSignature,
};
