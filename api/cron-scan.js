const { scanShop } = require("../lib/scan");
const {
  getLatestServerRefreshSnapshot,
  isScanStorageConfigured,
  saveSnapshot,
} = require("../lib/scan-history-db");
const { getServerRefreshSettings } = require("../lib/server-refresh-settings-db");

function getHeader(req, name) {
  if (!req?.headers) {
    return "";
  }

  const loweredName = name.toLowerCase();
  return req.headers[name] || req.headers[loweredName] || "";
}

async function shouldRunServerRefresh() {
  const settings = await getServerRefreshSettings();
  const lastServerRefresh = await getLatestServerRefreshSnapshot();

  if (!settings.enabled) {
    return {
      shouldRun: false,
      settings,
      lastServerRefresh,
      reason: "Server-side refresh is disabled by admin settings.",
    };
  }

  const intervalMinutes = Number(settings.intervalMinutes) || 30;

  if (!lastServerRefresh?.scannedAt) {
    return {
      shouldRun: true,
      settings,
      lastServerRefresh,
      reason: `No previous server-side refresh was found. Running now with the ${intervalMinutes}-minute schedule.`,
    };
  }

  const lastRunAt = new Date(lastServerRefresh.scannedAt).getTime();
  if (!Number.isFinite(lastRunAt)) {
    return {
      shouldRun: true,
      settings,
      lastServerRefresh,
      reason: `The previous server-side refresh time could not be read. Running now with the ${intervalMinutes}-minute schedule.`,
    };
  }

  const elapsedMilliseconds = Date.now() - lastRunAt;
  const intervalMilliseconds = intervalMinutes * 60 * 1000;

  if (elapsedMilliseconds < intervalMilliseconds) {
    const remainingMilliseconds = intervalMilliseconds - elapsedMilliseconds;
    const remainingMinutes = Math.max(1, Math.ceil(remainingMilliseconds / (60 * 1000)));

    return {
      shouldRun: false,
      settings,
      lastServerRefresh,
      reason: `Waiting for the ${intervalMinutes}-minute server refresh interval. About ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"} remaining.`,
    };
  }

  return {
    shouldRun: true,
    settings,
    lastServerRefresh,
    reason: `The ${intervalMinutes}-minute server refresh interval has elapsed.`,
  };
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
    const schedulingDecision = await shouldRunServerRefresh();

    if (!schedulingDecision.shouldRun) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.status(200).send(
        JSON.stringify(
          {
            success: true,
            skipped: true,
            reason: schedulingDecision.reason,
            settings: schedulingDecision.settings,
            lastServerRefresh: schedulingDecision.lastServerRefresh,
          },
          null,
          2,
        ),
      );
      return;
    }

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
          cleanup: storedSnapshot.cleanup || null,
          reason: schedulingDecision.reason,
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
