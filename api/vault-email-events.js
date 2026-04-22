const { requireAppUser } = require("../lib/auth");
const {
  deleteAllVaultEmailEvents,
  deleteVaultEmailEvent,
  isVaultEmailEventStorageConfigured,
  listVaultEmailEvents,
} = require("../lib/vault-email-events-db");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const auth = await requireAppUser(req, res, { requireRole: "admin" });
  if (!auth) {
    return;
  }

  if (!["GET", "DELETE"].includes(req.method)) {
    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }, null, 2));
    return;
  }

  if (!isVaultEmailEventStorageConfigured()) {
    res.status(200).send(
      JSON.stringify(
        {
          storageConfigured: false,
          events: [],
          message: "Postgres is required before inbound email events can be stored.",
        },
        null,
        2,
      ),
    );
    return;
  }

  try {
    if (req.method === "DELETE") {
      let deletedCount = 0;

      if (req.query?.all === "1") {
        deletedCount = await deleteAllVaultEmailEvents();
      } else {
        const id = Number(req.query?.id);

        if (!Number.isFinite(id) || id <= 0) {
          res.status(400).send(
            JSON.stringify(
              {
                error: "missing_event_id",
                message: "Provide an inbound email event id or all=1.",
              },
              null,
              2,
            ),
          );
          return;
        }

        deletedCount = await deleteVaultEmailEvent(id);
      }

      const events = await listVaultEmailEvents({ limit: req.query?.limit || 25 });

      res.status(200).send(
        JSON.stringify(
          {
            storageConfigured: true,
            deletedCount,
            events,
          },
          null,
          2,
        ),
      );
      return;
    }

    const events = await listVaultEmailEvents({ limit: req.query?.limit || 25 });

    res.status(200).send(
      JSON.stringify(
        {
          storageConfigured: true,
          events,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    res.status(500).send(
      JSON.stringify(
        {
          error: "vault_email_events_failed",
          message: error.message || "Unable to load inbound email events.",
        },
        null,
        2,
      ),
    );
  }
};
