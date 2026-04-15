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

function getEasternDateParts(dateLike) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(dateLike))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    weekday: parts.weekday,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
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

  if (settings.mode === "hyper_requested") {
    return {
      shouldRun: true,
      settings,
      lastServerRefresh,
      reason: "Hyper mode requested. Running on each available Vercel cron tick (once per minute).",
    };
  }

  const nowEastern = getEasternDateParts(new Date());
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(nowEastern.weekday);
  const scheduledMinute = nowEastern.hour === 1 && nowEastern.minute === 0;

  if (!isWeekday || !scheduledMinute) {
    return {
      shouldRun: false,
      settings,
      lastServerRefresh,
      reason: "Waiting for the weekday 1:00 AM America/New_York schedule.",
    };
  }

  if (lastServerRefresh?.scannedAt) {
    const lastEastern = getEasternDateParts(lastServerRefresh.scannedAt);
    if (lastEastern.dateKey === nowEastern.dateKey) {
      return {
        shouldRun: false,
        settings,
        lastServerRefresh,
        reason: "The weekday 1:00 AM America/New_York scan already ran for today.",
      };
    }
  }

  return {
    shouldRun: true,
    settings,
    lastServerRefresh,
    reason: "Weekday 1:00 AM America/New_York schedule matched.",
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
