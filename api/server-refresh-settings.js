const { requireAppUser } = require("../lib/auth");
const {
  getServerRefreshSettings,
  isServerRefreshStorageConfigured,
  SERVER_REFRESH_MODES,
  updateServerRefreshSettings,
} = require("../lib/server-refresh-settings-db");
const { getLatestServerRefreshSnapshotSummary } = require("../lib/scan-history-db");
const { getRefreshWindowStatus } = require("../lib/refresh-window");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const auth = await requireAppUser(req, res, { requireRole: "admin" });
  if (!auth) {
    return;
  }

  if (!isServerRefreshStorageConfigured()) {
    res.status(200).send(
      JSON.stringify(
        {
          storageConfigured: false,
          message: "Postgres is required before server refresh settings can be managed.",
        },
        null,
        2,
      ),
    );
    return;
  }

  try {
    if (req.method === "GET") {
      const settings = await getServerRefreshSettings();
      const lastServerRefresh = await getLatestServerRefreshSnapshotSummary();

      res.status(200).send(
        JSON.stringify(
          {
            storageConfigured: true,
            settings,
            lastServerRefresh,
            refreshWindow: getRefreshWindowStatus(),
            limitations: {
              minimumServerInterval: "1 minute",
              schedulingExplanation:
                "Vercel cron jobs wake the server once per minute. Browser refreshes stay limited to Monday-Friday from 8:00 AM to 5:00 PM ET, while server refreshes can run either on a minute interval inside that daytime window or on the overnight Sunday-Friday schedule at 12:30 AM and 1:00 AM ET.",
              availableModes: [
                {
                  value: SERVER_REFRESH_MODES.INTERVAL,
                  label: "Interval inside the daytime refresh window",
                },
                {
                  value: SERVER_REFRESH_MODES.OVERNIGHT,
                  label: "Sunday-Friday at 12:30 AM and 1:00 AM ET",
                },
              ],
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    if (req.method === "PATCH") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const settings = await updateServerRefreshSettings({
        enabled: body.enabled,
        browserRefreshEnabled: body.browserRefreshEnabled,
        intervalMinutes: body.intervalMinutes,
        mode: body.mode,
      });
      const lastServerRefresh = await getLatestServerRefreshSnapshotSummary();

      res.status(200).send(
        JSON.stringify(
          {
            storageConfigured: true,
            settings,
            lastServerRefresh,
            refreshWindow: getRefreshWindowStatus(),
            limitations: {
              minimumServerInterval: "1 minute",
              schedulingExplanation:
                "Vercel cron jobs wake the server once per minute. Browser refreshes stay limited to Monday-Friday from 8:00 AM to 5:00 PM ET, while server refreshes can run either on a minute interval inside that daytime window or on the overnight Sunday-Friday schedule at 12:30 AM and 1:00 AM ET.",
              availableModes: [
                {
                  value: SERVER_REFRESH_MODES.INTERVAL,
                  label: "Interval inside the daytime refresh window",
                },
                {
                  value: SERVER_REFRESH_MODES.OVERNIGHT,
                  label: "Sunday-Friday at 12:30 AM and 1:00 AM ET",
                },
              ],
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }, null, 2));
  } catch (error) {
    res.status(500).send(
      JSON.stringify(
        {
          error: "server_refresh_settings_failed",
          message: error.message,
        },
        null,
        2,
      ),
    );
  }
};
