const { requireAppUser } = require("../lib/auth");
const {
  fetchRemoteBrowserStatus,
  getRemoteBrowserConfig,
  isRemoteBrowserConfigured,
  openRemoteBrowserFlow,
  openRemoteBrowserUrl,
} = require("../lib/remote-browser");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const auth = await requireAppUser(req, res, { requireRole: "admin" });
  if (!auth) {
    return;
  }

  const { dashboardUrl } = getRemoteBrowserConfig();

  if (!isRemoteBrowserConfigured()) {
    res.status(200).send(
      JSON.stringify(
        {
          configured: false,
          dashboardUrl: dashboardUrl || "",
          message: "Remote browser settings are not configured on the server yet.",
        },
        null,
        2,
      ),
    );
    return;
  }

  try {
    if (req.method === "GET") {
      const status = await fetchRemoteBrowserStatus();
      res.status(200).send(
        JSON.stringify(
          {
            configured: true,
            dashboardUrl,
            status,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const productUrl = String(body.productUrl || body.url || "").trim();
      const vaultUrl = String(body.vaultUrl || "").trim();
      const vaultKey = String(body.vaultKey || "").trim();
      const label = String(body.label || "").trim();

      if (!/^https?:\/\//i.test(productUrl)) {
        res.status(400).send(JSON.stringify({ error: "invalid_request", message: "A full product URL is required." }, null, 2));
        return;
      }

      const result =
        vaultUrl || vaultKey
          ? await openRemoteBrowserFlow({
              vaultUrl,
              productUrl,
              vaultKey,
              label,
            })
          : await openRemoteBrowserUrl(productUrl);
      const status = await fetchRemoteBrowserStatus().catch(() => null);

      res.status(200).send(
        JSON.stringify(
          {
            configured: true,
            dashboardUrl,
            result,
            status,
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
          error: "remote_browser_failed",
          message: error.message || "Remote browser request failed.",
          dashboardUrl,
        },
        null,
        2,
      ),
    );
  }
};
