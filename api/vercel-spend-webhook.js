const { handleVercelSpendWebhook, isVercelSpendWebhookConfigured } = require("../lib/vercel-spend-webhook");

function readRawBody(req) {
  if (typeof req.rawBody === "string") {
    return Promise.resolve(req.rawBody);
  }

  if (typeof req.body === "string") {
    return Promise.resolve(req.body);
  }

  if (Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body.toString("utf8"));
  }

  return new Promise((resolve, reject) => {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", () => resolve(rawBody));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }, null, 2));
    return;
  }

  if (!isVercelSpendWebhookConfigured()) {
    res.status(503).send(
      JSON.stringify(
        {
          error: "vercel_spend_webhook_not_configured",
          message: "Set VERCEL_SPEND_WEBHOOK_SECRET before using the Vercel spend webhook endpoint.",
        },
        null,
        2,
      ),
    );
    return;
  }

  try {
    const rawBody = await readRawBody(req);
    const parsedBody =
      typeof req.body === "object" && req.body
        ? req.body
        : rawBody
        ? JSON.parse(rawBody)
        : {};

    const result = await handleVercelSpendWebhook({
      headers: req.headers,
      rawBody,
      body: parsedBody,
    });

    res.status(result.statusCode).send(JSON.stringify(result.payload, null, 2));
  } catch (error) {
    res.status(500).send(
      JSON.stringify(
        {
          error: "vercel_spend_webhook_failed",
          message: error.message || "Unable to process the Vercel spend webhook.",
        },
        null,
        2,
      ),
    );
  }
};
