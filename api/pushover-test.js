const { requireAppUser } = require("../lib/auth");
const { sendPushoverMessage, isPushoverConfigured, validatePushoverUserKey } = require("../lib/pushover");
const { recordNotificationSent } = require("../lib/app-users-db");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }, null, 2));
    return;
  }

  const auth = await requireAppUser(req, res);
  if (!auth) {
    return;
  }

  if (!isPushoverConfigured()) {
    res.status(400).send(
      JSON.stringify(
        {
          error: "pushover_not_configured",
          message: "Pushover is not configured on the server yet.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const userKey = (auth.appUser?.pushoverUserKey || "").trim();

  if (!userKey) {
    res.status(400).send(
      JSON.stringify(
        {
          error: "missing_pushover_user_key",
          message: "Save your Pushover User Key in Profile before sending a test notification.",
        },
        null,
        2,
      ),
    );
    return;
  }

  try {
    const message = `Test notification sent on ${new Date().toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "medium",
    })}. Your Pushover setup is working.`;
    await validatePushoverUserKey(userKey);
    await sendPushoverMessage({
      userKey,
      title: "ABC Vault test notification",
      message,
      url: "https://abc-vault-live-scanner.vercel.app/",
      urlTitle: "Open ABC Vault Live Scanner",
      critical: Boolean(auth.appUser?.notificationsCritical),
    });
    const updatedAppUser = await recordNotificationSent(auth.user.email, message);

    res.status(200).send(
      JSON.stringify(
        {
          success: true,
          message: "Test notification sent to your Pushover account.",
          appUser: updatedAppUser,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    res.status(400).send(
      JSON.stringify(
        {
          error: "pushover_test_failed",
          message: error.message || "Unable to send a Pushover test notification.",
        },
        null,
        2,
      ),
    );
  }
};
