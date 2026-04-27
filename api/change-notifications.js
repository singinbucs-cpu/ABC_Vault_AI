const { requireAppUser } = require("../lib/auth");
const {
  isChangeNotificationStorageConfigured,
  listUnreadChangeNotifications,
  markChangeNotificationsRead,
} = require("../lib/change-notifications-db");

function groupNotifications(notifications) {
  return notifications.reduce(
    (feed, item) => {
      if (feed[item.section]) {
        feed[item.section].push(item);
      }
      return feed;
    },
    { added: [], changed: [], removed: [] },
  );
}

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

  if (!isChangeNotificationStorageConfigured()) {
    res.status(200).send(
      JSON.stringify(
        {
          storageConfigured: false,
          notifications: [],
          feed: { added: [], changed: [], removed: [] },
          message: "Change notification storage is not configured.",
        },
        null,
        2,
      ),
    );
    return;
  }

  try {
    if (req.method === "PATCH") {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : typeof req.body === "object" && req.body
          ? req.body
          : {};

      await markChangeNotificationsRead(auth.user.email, {
        ids: Array.isArray(body.ids) ? body.ids : [],
        section: typeof body.section === "string" ? body.section : "",
        all: Boolean(body.all),
      });
    }

    const notifications = await listUnreadChangeNotifications(auth.user.email);
    res.status(200).send(
      JSON.stringify(
        {
          storageConfigured: true,
          notifications,
          feed: groupNotifications(notifications),
          counts: {
            added: notifications.filter((item) => item.section === "added").length,
            changed: notifications.filter((item) => item.section === "changed").length,
            removed: notifications.filter((item) => item.section === "removed").length,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    res.status(500).send(
      JSON.stringify(
        {
          error: "change_notifications_failed",
          message: error.message || "Unable to load change notifications.",
        },
        null,
        2,
      ),
    );
  }
};
