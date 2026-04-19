const { getConnectionString, getPgPool } = require("./db");

let initialized = false;

function isHotStorageConfigured() {
  return Boolean(getConnectionString());
}

function getPool() {
  if (!isHotStorageConfigured()) {
    throw new Error("Hot item storage is not configured. Add a Postgres connection to the Vercel project first.");
  }

  return getPgPool();
}

async function ensureHotItemsTable() {
  if (initialized) {
    return;
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS hot_items (
      product_id TEXT PRIMARY KEY,
      product_name TEXT NOT NULL,
      category TEXT,
      bottle_size_display TEXT,
      price TEXT,
      is_purchasable BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await getPool().query(sql);
  initialized = true;
}

async function listHotItems() {
  await ensureHotItemsTable();
  const result = await getPool().query(
    `
      SELECT
        product_id AS "productId",
        product_name AS "productName",
        category,
        bottle_size_display AS "bottleSizeDisplay",
        price,
        is_purchasable AS "isPurchasableFromListingPage",
        updated_at AS "updatedAt"
      FROM hot_items
      ORDER BY updated_at DESC, product_name ASC
    `,
  );

  return result.rows;
}

async function upsertHotItem(item) {
  await ensureHotItemsTable();
  await getPool().query(
    `
      INSERT INTO hot_items (
        product_id,
        product_name,
        category,
        bottle_size_display,
        price,
        is_purchasable,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (product_id)
      DO UPDATE SET
        product_name = EXCLUDED.product_name,
        category = EXCLUDED.category,
        bottle_size_display = EXCLUDED.bottle_size_display,
        price = EXCLUDED.price,
        is_purchasable = EXCLUDED.is_purchasable,
        updated_at = NOW()
    `,
    [
      item.productId,
      item.productName,
      item.category || null,
      item.bottleSizeDisplay || null,
      item.price || null,
      Boolean(item.isPurchasableFromListingPage),
    ],
  );
}

async function removeHotItem(productId) {
  await ensureHotItemsTable();
  await getPool().query("DELETE FROM hot_items WHERE product_id = $1", [productId]);
}

module.exports = {
  isHotStorageConfigured,
  listHotItems,
  upsertHotItem,
  removeHotItem,
};
