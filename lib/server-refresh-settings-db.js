const { getConnectionString, getPgPool } = require("./db");

let initialized = false;

function isServerRefreshStorageConfigured() {
  return Boolean(getConnectionString());
}

function getPool() {
  if (!isServerRefreshStorageConfigured()) {
    throw new Error("Server refresh storage is not configured. Add Postgres first.");
  }

  return getPgPool();
}

async function ensureServerRefreshSettingsTable() {
  if (initialized) {
    return;
  }

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS server_refresh_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      mode TEXT NOT NULL DEFAULT 'weekday_1am_et',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await getPool().query(`
    INSERT INTO server_refresh_settings (id, enabled, mode)
    VALUES (1, TRUE, 'weekday_1am_et')
    ON CONFLICT (id) DO NOTHING;
  `);

  initialized = true;
}

function mapRow(row) {
  return {
    enabled: Boolean(row?.enabled),
    mode: row?.mode || "weekday_1am_et",
    updatedAt: row?.updatedAt || null,
  };
}

async function getServerRefreshSettings() {
  await ensureServerRefreshSettingsTable();

  const result = await getPool().query(`
    SELECT
      enabled,
      mode,
      updated_at AS "updatedAt"
    FROM server_refresh_settings
    WHERE id = 1
    LIMIT 1
  `);

  return mapRow(result.rows[0] || {});
}

async function updateServerRefreshSettings({ enabled, mode }) {
  await ensureServerRefreshSettingsTable();

  const normalizedMode = mode === "hyper_requested" ? "hyper_requested" : "weekday_1am_et";

  const result = await getPool().query(
    `
      UPDATE server_refresh_settings
      SET
        enabled = $1,
        mode = $2,
        updated_at = NOW()
      WHERE id = 1
      RETURNING
        enabled,
        mode,
        updated_at AS "updatedAt"
    `,
    [Boolean(enabled), normalizedMode],
  );

  return mapRow(result.rows[0] || {});
}

module.exports = {
  getServerRefreshSettings,
  isServerRefreshStorageConfigured,
  updateServerRefreshSettings,
};
