const { requireAppUser } = require("../lib/auth");
const { updateAppUserProfile } = require("../lib/app-users-db");
const { validatePushoverUserKey, isPushoverConfigured } = require("../lib/pushover");
const { getVaultEmailConfig, isVaultEmailIngestConfigured } = require("../lib/vault-key-email");
const { getLatestServerRefreshSnapshot } = require("../lib/scan-history-db");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "PATCH"].includes(req.method)) {
    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }, null, 2));
    return;
  }

  const auth = await requireAppUser(req, res);
  if (!auth) {
    return;
  }

  if (req.method === "PATCH") {
    try {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : typeof req.body === "object" && req.body
          ? req.body
          : {};
      const pushoverUserKey = typeof body.pushoverUserKey === "string" ? body.pushoverUserKey.trim() : "";
      const notificationsEnabled = Boolean(body.notificationsEnabled);
      const notifyInitialLoad = Boolean(body.notifyInitialLoad);
      const notifyAdded = Boolean(body.notifyAdded);
      const notifyChanged = Boolean(body.notifyChanged);
      const notifyRemoved = Boolean(body.notifyRemoved);
      const notifyPurchasable = Boolean(body.notifyPurchasable);
      const notifyVaultOpen = Boolean(body.notifyVaultOpen);
      const notifyVaultClosed = Boolean(body.notifyVaultClosed);
      const notificationsCritical = Boolean(body.notificationsCritical);
      const criticalInitialLoad = Boolean(body.criticalInitialLoad);
      const criticalAdded = Boolean(body.criticalAdded);
      const criticalChanged = Boolean(body.criticalChanged);
      const criticalRemoved = Boolean(body.criticalRemoved);
      const criticalPurchasable = Boolean(body.criticalPurchasable);
      const criticalVaultOpen = Boolean(body.criticalVaultOpen);
      const criticalVaultClosed = Boolean(body.criticalVaultClosed);
      const vaultKeyAutoImportEnabled = Boolean(body.vaultKeyAutoImportEnabled);
      const vaultKeyForwardingEmail =
        typeof body.vaultKeyForwardingEmail === "string" ? body.vaultKeyForwardingEmail.trim() : "";

      if (notificationsEnabled && !pushoverUserKey) {
        res.status(400).send(
          JSON.stringify(
            {
              error: "missing_pushover_user_key",
              message: "Add your Pushover User Key before turning notifications on.",
            },
            null,
            2,
          ),
        );
        return;
      }

      if (pushoverUserKey && isPushoverConfigured()) {
        await validatePushoverUserKey(pushoverUserKey);
      }

      const updatedAppUser = await updateAppUserProfile(auth.user.email, {
        pushoverUserKey,
        notificationsEnabled,
        notifyInitialLoad,
        notifyAdded,
        notifyChanged,
        notifyRemoved,
        notifyPurchasable,
        notifyVaultOpen,
        notifyVaultClosed,
        notificationsCritical,
        criticalInitialLoad,
        criticalAdded,
        criticalChanged,
        criticalRemoved,
        criticalPurchasable,
        criticalVaultOpen,
        criticalVaultClosed,
        vaultKeyAutoImportEnabled,
        vaultKeyForwardingEmail,
      });

      const vaultEmailConfig = getVaultEmailConfig();
      const lastServerRefresh = await getLatestServerRefreshSnapshot().catch(() => null);

      res.status(200).send(
        JSON.stringify(
          {
            authenticated: true,
            user: {
              id: auth.user.id,
              email: auth.user.email,
            },
            appUser: updatedAppUser,
            pushoverConfigured: isPushoverConfigured(),
            vaultEmailConfigured: isVaultEmailIngestConfigured(),
            vaultEmailForwardingAddress: vaultEmailConfig.forwardingAddress || null,
            vaultEmailAppUrl: vaultEmailConfig.appUrl || null,
            lastServerRefresh,
          },
          null,
          2,
        ),
      );
      return;
    } catch (error) {
      res.status(400).send(
        JSON.stringify(
          {
            error: "profile_update_failed",
            message: error.message || "Unable to update your profile.",
          },
          null,
          2,
        ),
      );
      return;
    }
  }

  const lastServerRefresh = await getLatestServerRefreshSnapshot().catch(() => null);

  res.status(200).send(
    JSON.stringify(
      {
        authenticated: true,
        user: {
          id: auth.user.id,
          email: auth.user.email,
        },
        appUser: auth.appUser,
        pushoverConfigured: isPushoverConfigured(),
        vaultEmailConfigured: isVaultEmailIngestConfigured(),
        vaultEmailForwardingAddress: getVaultEmailConfig().forwardingAddress || null,
        vaultEmailAppUrl: getVaultEmailConfig().appUrl || null,
        lastServerRefresh,
      },
      null,
      2,
    ),
  );
};
