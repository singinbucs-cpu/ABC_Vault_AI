const { requireAppUser } = require("../lib/auth");
const {
  getServerRefreshSettings,
  isServerRefreshStorageConfigured,
  updateServerRefreshSettings,
} = require("../lib/server-refresh-settings-db");
const { getLatestServerRefreshSnapshot } = require("../lib/scan-history-db");

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
      const lastServerRefresh = await getLatestServerRefreshSnapshot();

      res.status(200).send(
        JSON.stringify(
          {
            storageConfigured: true,
            settings,
            lastServerRefresh,
            limitations: {
              minimumServerInterval: "1 minute",
              hyperModeExplanation:
                "Vercel cron jobs run at a minimum of once per minute. Hyper mode is the closest available server-side option and runs every minute, not every 3 seconds.",
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
        mode: body.mode,
      });
      const lastServerRefresh = await getLatestServerRefreshSnapshot();

      res.status(200).send(
        JSON.stringify(
          {
            storageConfigured: true,
            settings,
            lastServerRefresh,
            limitations: {
              minimumServerInterval: "1 minute",
              hyperModeExplanation:
                "Vercel cron jobs run at a minimum of once per minute. Hyper mode is the closest available server-side option and runs every minute, not every 3 seconds.",
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
