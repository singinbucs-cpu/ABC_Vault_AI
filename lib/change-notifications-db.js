const { getConnectionString, getPgPool } = require("./db");

let initialized = false;

function isChangeNotificationStorageConfigured() {
  return Boolean(getConnectionString());
}

function getPool() {
  if (!isChangeNotificationStorageConfigured()) {
    throw new Error("Change notification storage is not configured. Add a Postgres connection first.");
  }

  return getPgPool();
}

async function ensureChangeNotificationsTable() {
  if (initialized) {
    return;
  }

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS user_change_notifications (
      id BIGSERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      snapshot_id BIGINT,
      section TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_url TEXT,
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_purchasable BOOLEAN,
      detected_at TIMESTAMPTZ NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_email, section, product_id, detected_at)
    );
  `);

  await getPool().query(`
    CREATE INDEX IF NOT EXISTS user_change_notifications_user_unread_idx
    ON user_change_notifications (user_email, read_at, detected_at DESC, id DESC);
  `);

  await getPool().query(`
    CREATE INDEX IF NOT EXISTS user_change_notifications_user_section_unread_idx
    ON user_change_notifications (user_email, section, id DESC)
    WHERE read_at IS NULL;
  `);

  initialized = true;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getProductKey(item) {
  return String(item?.productId || item?.productName || "unknown").trim();
}

function normalizeNotificationItem(section, item, detectedAt, snapshotId) {
  return {
    snapshotId,
    section,
    productId: getProductKey(item),
    productName: item?.productName || "Unnamed item",
    productUrl: item?.productUrl || null,
    fields: Array.isArray(item?.fields) ? item.fields : [],
    details: item?.details && typeof item.details === "object" ? item.details : {},
    isPurchasable:
      typeof item?.isPurchasableFromListingPage === "boolean" ? item.isPurchasableFromListingPage : null,
    detectedAt,
  };
}

function buildNotificationItems(changes, detectedAt, snapshotId) {
  return [
    ...(changes?.added || []).map((item) => normalizeNotificationItem("added", item, detectedAt, snapshotId)),
    ...(changes?.changed || []).map((item) => normalizeNotificationItem("changed", item, detectedAt, snapshotId)),
    ...(changes?.removed || []).map((item) => normalizeNotificationItem("removed", item, detectedAt, snapshotId)),
  ];
}

async function createUserChangeNotifications(changes, snapshot) {
  if (!changes?.totalChanges || !snapshot?.scannedAt || !isChangeNotificationStorageConfigured()) {
    return { insertedCount: 0 };
  }

  await ensureChangeNotificationsTable();
  const items = buildNotificationItems(changes, snapshot.scannedAt, snapshot.snapshotId || null);

  if (!items.length) {
    return { insertedCount: 0 };
  }

  const usersResult = await getPool().query(`
    SELECT email
    FROM app_users
    WHERE is_active = TRUE
    ORDER BY email ASC
  `);

  let insertedCount = 0;

  for (const user of usersResult.rows) {
    const email = normalizeEmail(user.email);
    if (!email) {
      continue;
    }

    for (const item of items) {
      const result = await getPool().query(
        `
          INSERT INTO user_change_notifications (
            user_email,
            snapshot_id,
            section,
            product_id,
            product_name,
            product_url,
            fields,
            details,
            is_purchasable,
            detected_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
          ON CONFLICT (user_email, section, product_id, detected_at) DO NOTHING
        `,
        [
          email,
          item.snapshotId,
          item.section,
          item.productId,
          item.productName,
          item.productUrl,
          JSON.stringify(item.fields),
          JSON.stringify(item.details),
          item.isPurchasable,
          item.detectedAt,
        ],
      );
      insertedCount += result.rowCount || 0;
    }
  }

  return { insertedCount };
}

function mapNotificationRow(row) {
  return {
    id: Number(row.id),
    section: row.section,
    productId: row.productId,
    productName: row.productName,
    productUrl: row.productUrl || null,
    fields: row.fields || [],
    details: row.details || {},
    isPurchasableFromListingPage: row.isPurchasable,
    detectedAt: row.detectedAt,
    createdAt: row.createdAt,
  };
}

async function listUnreadChangeNotifications(email) {
  await ensureChangeNotificationsTable();

  const result = await getPool().query(
    `
      SELECT
        id,
        section,
        product_id AS "productId",
        product_name AS "productName",
        product_url AS "productUrl",
        fields,
        details,
        is_purchasable AS "isPurchasable",
        detected_at AS "detectedAt",
        created_at AS "createdAt"
      FROM user_change_notifications
      WHERE user_email = $1
        AND read_at IS NULL
      ORDER BY detected_at DESC, id DESC
    `,
    [normalizeEmail(email)],
  );

  return result.rows.map(mapNotificationRow);
}

async function markChangeNotificationsRead(email, { ids = [], section = "", all = false } = {}) {
  await ensureChangeNotificationsTable();
  const normalizedEmail = normalizeEmail(email);

  if (all) {
    const result = await getPool().query(
      `
        UPDATE user_change_notifications
        SET read_at = NOW()
        WHERE user_email = $1
          AND read_at IS NULL
      `,
      [normalizedEmail],
    );
    return { updatedCount: result.rowCount || 0 };
  }

  if (section) {
    const result = await getPool().query(
      `
        UPDATE user_change_notifications
        SET read_at = NOW()
        WHERE user_email = $1
          AND section = $2
          AND read_at IS NULL
      `,
      [normalizedEmail, section],
    );
    return { updatedCount: result.rowCount || 0 };
  }

  const numericIds = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  if (!numericIds.length) {
    return { updatedCount: 0 };
  }

  const result = await getPool().query(
    `
      UPDATE user_change_notifications
      SET read_at = NOW()
      WHERE user_email = $1
        AND id = ANY($2::BIGINT[])
        AND read_at IS NULL
    `,
    [normalizedEmail, numericIds],
  );

  return { updatedCount: result.rowCount || 0 };
}

async function clearAllChangeNotifications() {
  if (!isChangeNotificationStorageConfigured()) {
    return;
  }

  await ensureChangeNotificationsTable();
  await getPool().query("TRUNCATE TABLE user_change_notifications RESTART IDENTITY");
}

module.exports = {
  clearAllChangeNotifications,
  createUserChangeNotifications,
  isChangeNotificationStorageConfigured,
  listUnreadChangeNotifications,
  markChangeNotificationsRead,
};
