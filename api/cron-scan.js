const { scanShop } = require("../lib/scan");
const {
  getLatestServerRefreshSnapshotSummary,
  isScanStorageConfigured,
  saveSnapshot,
} = require("../lib/scan-history-db");
const { getServerRefreshSettings, SERVER_REFRESH_MODES } = require("../lib/server-refresh-settings-db");
const { getRefreshWindowStatus, REFRESH_WINDOW_TIMEZONE } = require("../lib/refresh-window");

function getEasternScheduleParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: REFRESH_WINDOW_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const rawParts = formatter.formatToParts(now);
  const parts = Object.fromEntries(rawParts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday] ?? -1;

  return {
    weekday: parts.weekday || "",
    weekdayIndex,
    year: Number(parts.year || 0),
    month: Number(parts.month || 0),
    day: Number(parts.day || 0),
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function isOvernightServerRefreshSlot(parts) {
  const isAllowedDay = parts.weekdayIndex >= 0 && parts.weekdayIndex <= 5;
  const isAllowedTime = (parts.hour === 0 && parts.minute === 30) || (parts.hour === 1 && parts.minute === 0);
  return isAllowedDay && isAllowedTime;
}

function formatOvernightSlotLabel(parts) {
  if (parts.hour === 0 && parts.minute === 30) {
    return "12:30 AM ET";
  }
  if (parts.hour === 1 && parts.minute === 0) {
    return "1:00 AM ET";
  }
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} ET`;
}

function getNextOvernightServerRefreshLabel(parts) {
  const isAllowedDay = parts.weekdayIndex >= 0 && parts.weekdayIndex <= 5;

  if (isAllowedDay && parts.hour === 0 && parts.minute < 30) {
    return "Today at 12:30 AM ET";
  }

  if (isAllowedDay && ((parts.hour === 0 && parts.minute >= 30) || (parts.hour === 1 && parts.minute === 0))) {
    return "Today at 1:00 AM ET";
  }

  if (parts.weekdayIndex >= 0 && parts.weekdayIndex <= 4) {
    return "Tomorrow at 12:30 AM ET";
  }

  return "Sunday at 12:30 AM ET";
}

function getOvernightSlotKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}-${String(parts.hour).padStart(2, "0")}-${String(parts.minute).padStart(2, "0")}`;
}

function getHeader(req, name) {
  if (!req?.headers) {
    return "";
  }

  const loweredName = name.toLowerCase();
  return req.headers[name] || req.headers[loweredName] || "";
}

async function shouldRunServerRefresh() {
  const settings = await getServerRefreshSettings();
  const lastServerRefresh = await getLatestServerRefreshSnapshotSummary();
  const refreshWindow = getRefreshWindowStatus();
  const mode = settings.mode || SERVER_REFRESH_MODES.INTERVAL;

  if (!settings.enabled) {
    return {
      shouldRun: false,
      settings,
      lastServerRefresh,
      refreshWindow,
      reason: "Server-side refresh is disabled by admin settings.",
    };
  }

  if (mode === SERVER_REFRESH_MODES.OVERNIGHT) {
    const nowParts = getEasternScheduleParts();

    if (!isOvernightServerRefreshSlot(nowParts)) {
      return {
        shouldRun: false,
        settings,
        lastServerRefresh,
        refreshWindow,
        reason: `Waiting for the overnight schedule. Next run: ${getNextOvernightServerRefreshLabel(nowParts)}.`,
      };
    }

    const currentSlotKey = getOvernightSlotKey(nowParts);
    const lastSlotKey = lastServerRefresh?.scannedAt
      ? getOvernightSlotKey(getEasternScheduleParts(new Date(lastServerRefresh.scannedAt)))
      : "";

    if (currentSlotKey === lastSlotKey) {
      return {
        shouldRun: false,
        settings,
        lastServerRefresh,
        refreshWindow,
        reason: `The ${formatOvernightSlotLabel(nowParts)} overnight refresh already ran for this slot.`,
      };
    }

    return {
      shouldRun: true,
      settings,
      lastServerRefresh,
      refreshWindow,
      reason: `Running the overnight refresh for ${formatOvernightSlotLabel(nowParts)} on ${nowParts.weekday}.`,
    };
  }

  if (!refreshWindow.allowed) {
    return {
      shouldRun: false,
      settings,
      lastServerRefresh,
      refreshWindow,
      reason: `${refreshWindow.blockedReason} Next allowed window: ${refreshWindow.nextAllowedLabel}.`,
    };
  }

  const intervalMinutes = Number(settings.intervalMinutes) || 30;

  if (!lastServerRefresh?.scannedAt) {
    return {
      shouldRun: true,
      settings,
      lastServerRefresh,
      refreshWindow,
      reason: `No previous server-side refresh was found. Running now with the ${intervalMinutes}-minute schedule.`,
    };
  }

  const lastRunAt = new Date(lastServerRefresh.scannedAt).getTime();
  if (!Number.isFinite(lastRunAt)) {
    return {
      shouldRun: true,
      settings,
      lastServerRefresh,
      refreshWindow,
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
      refreshWindow,
      reason: `Waiting for the ${intervalMinutes}-minute server refresh interval. About ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"} remaining.`,
    };
  }

  return {
    shouldRun: true,
    settings,
    lastServerRefresh,
    refreshWindow,
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
            refreshWindow: schedulingDecision.refreshWindow,
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
