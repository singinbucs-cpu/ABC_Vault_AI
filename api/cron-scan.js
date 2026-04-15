const { scanShop } = require("../lib/scan");
const {
  isScanStorageConfigured,
  saveSnapshot,
} = require("../lib/scan-history-db");

function getHeader(req, name) {
  if (!req?.headers) {
    return "";
  }

  const loweredName = name.toLowerCase();
  return req.headers[name] || req.headers[loweredName] || "";
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }, null, 2));
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = getHeader(req, "authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(401).send(JSON.stringify({ error: "unauthorized" }, null, 2));
    return;
  }

  if (!isScanStorageConfigured()) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(500).send(
      JSON.stringify(
        {
          error: "storage_not_configured",
          message: "Postgres is required before background scans can be stored.",
        },
        null,
        2,
      ),
    );
    return;
  }

  try {
    const snapshot = await scanShop();
    const storedSnapshot = await saveSnapshot(snapshot, "vercel-cron");

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(
      JSON.stringify(
        {
          success: true,
          snapshotId: storedSnapshot.snapshotId,
          scannedAt: storedSnapshot.scannedAt,
          productCount: storedSnapshot.productCount,
          triggerSource: storedSnapshot.triggerSource,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(500).send(
      JSON.stringify(
        {
          error: "cron_scan_failed",
          message: error.message,
        },
        null,
        2,
      ),
    );
  }
};
