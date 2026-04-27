const { scanShop } = require("../lib/scan");
const {
  clearSnapshots,
  getLatestStoredSnapshot,
  isScanStorageConfigured,
  saveSnapshot,
} = require("../lib/scan-history-db");
const { requireAppUser } = require("../lib/auth");
const { getRefreshWindowStatus } = require("../lib/refresh-window");
const MANUAL_BLOCKED_WINDOW_COOLDOWN_MS = 60 * 1000;

function getManualRefreshCooldownStore() {
  if (!globalThis.__abcVaultManualRefreshCooldowns) {
    globalThis.__abcVaultManualRefreshCooldowns = new Map();
  }

  return globalThis.__abcVaultManualRefreshCooldowns;
}

function isBlockedWindowManualTrigger(triggerSource) {
  return !["auto", "vercel-cron", "initial-bootstrap", "initial-load"].includes(String(triggerSource || "").trim());
}

function getManualRefreshCooldown(email) {
  const expiresAt = getManualRefreshCooldownStore().get(email);
  if (!expiresAt) {
    return 0;
  }

  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    getManualRefreshCooldownStore().delete(email);
    return 0;
  }

  return Math.ceil(remainingMs / 1000);
}

function startManualRefreshCooldown(email) {
  getManualRefreshCooldownStore().set(email, Date.now() + MANUAL_BLOCKED_WINDOW_COOLDOWN_MS);
}

async function runAndPersistScan(triggerSource) {
  const liveSnapshot = await scanShop();

  if (!isScanStorageConfigured()) {
    return {
      ...liveSnapshot,
      storageConfigured: false,
      triggerSource,
    };
  }

  return saveSnapshot(liveSnapshot, triggerSource);
}

module.exports = async (req, res) => {
  try {
    const auth = await requireAppUser(req, res, req.method === "DELETE" ? { requireRole: "admin" } : {});
    if (!auth) {
      return;
    }

    if (req.method === "DELETE") {
      if (!isScanStorageConfigured()) {
        throw new Error("Scan storage is not configured.");
      }

      await clearSnapshots();
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.status(200).send(
        JSON.stringify(
          {
            success: true,
            cleared: true,
            message: "Stored listings were cleared from Postgres. Background scans may repopulate them on the next run.",
          },
          null,
          2,
        ),
      );
      return;
    }

    const refreshRequested =
      req.method === "POST" ||
      req.query?.refresh === "1" ||
      req.query?.refresh === "true";
    const refreshWindow = getRefreshWindowStatus();
    const triggerSource = req.query?.trigger || "manual-refresh";

    let result;

    if (refreshRequested) {
      if (!refreshWindow.allowed) {
        if (!isBlockedWindowManualTrigger(triggerSource)) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.status(403).send(
            JSON.stringify(
              {
                error: "refresh_window_blocked",
                message: `${refreshWindow.blockedReason} Next allowed window: ${refreshWindow.nextAllowedLabel}.`,
                refreshWindow,
              },
              null,
              2,
            ),
          );
          return;
        }

        const remainingSeconds = getManualRefreshCooldown(auth.user.email);
        if (remainingSeconds > 0) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.status(429).send(
            JSON.stringify(
              {
                error: "manual_refresh_cooldown",
                message: `Manual refresh is on cooldown for ${remainingSeconds} more second${remainingSeconds === 1 ? "" : "s"}.`,
                remainingSeconds,
                refreshWindow,
              },
              null,
              2,
            ),
          );
          return;
        }
      }

      result = await runAndPersistScan(triggerSource);
      if (!refreshWindow.allowed && isBlockedWindowManualTrigger(triggerSource)) {
        startManualRefreshCooldown(auth.user.email);
        result = {
          ...result,
          manualRefreshCooldownSeconds: 60,
          refreshWindow,
        };
      }
    } else if (isScanStorageConfigured()) {
      result = await getLatestStoredSnapshot();

      if (!result) {
        if (!refreshWindow.allowed) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.status(403).send(
            JSON.stringify(
              {
                error: "refresh_window_blocked",
                message: `No stored scan is available and live refreshes are blocked right now. ${refreshWindow.blockedReason} Next allowed window: ${refreshWindow.nextAllowedLabel}.`,
                refreshWindow,
              },
              null,
              2,
            ),
          );
          return;
        }

        result = await runAndPersistScan("initial-bootstrap");
      }
    } else {
      result = await runAndPersistScan("manual-no-storage");
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(JSON.stringify(result, null, 2));
  } catch (error) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(500).send(
      JSON.stringify(
        {
          error: "scan_failed",
          message: error.message,
        },
        null,
        2,
      ),
    );
  }
};
