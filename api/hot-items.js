const {
  isHotStorageConfigured,
  listHotItems,
  upsertHotItem,
  removeHotItem,
} = require("../lib/hot-items-db");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (!isHotStorageConfigured()) {
    res.status(200).send(
      JSON.stringify(
        {
          storageConfigured: false,
          items: [],
          message:
            "Hot item storage is not connected yet. Add a Vercel Marketplace Postgres database and its connection env vars to this project.",
        },
        null,
        2,
      ),
    );
    return;
  }

  try {
    if (req.method === "GET") {
      const items = await listHotItems();
      res.status(200).send(JSON.stringify({ storageConfigured: true, items }, null, 2));
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

      if (!body.productId || !body.productName) {
        res.status(400).send(JSON.stringify({ error: "invalid_request", message: "productId and productName are required." }, null, 2));
        return;
      }

      await upsertHotItem(body);
      const items = await listHotItems();
      res.status(200).send(JSON.stringify({ storageConfigured: true, items }, null, 2));
      return;
    }

    if (req.method === "DELETE") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

      if (!body.productId) {
        res.status(400).send(JSON.stringify({ error: "invalid_request", message: "productId is required." }, null, 2));
        return;
      }

      await removeHotItem(body.productId);
      const items = await listHotItems();
      res.status(200).send(JSON.stringify({ storageConfigured: true, items }, null, 2));
      return;
    }

    res.status(405).send(JSON.stringify({ error: "method_not_allowed" }, null, 2));
  } catch (error) {
    res.status(500).send(
      JSON.stringify(
        {
          error: "hot_items_failed",
          message: error.message,
        },
        null,
        2,
      ),
    );
  }
};
