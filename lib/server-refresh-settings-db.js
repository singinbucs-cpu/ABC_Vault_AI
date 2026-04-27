const { getConnectionString, getPgPool } = require("./db");

let initialized = false;
const ALLOWED_INTERVAL_MINUTES = new Set([1, 5, 10, 30, 60]);
const SERVER_REFRESH_MODES = {
  INTERVAL: "interval_minutes",
  OVERNIGHT: "overnight_sun_fri_1230_1am_et",
};

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
      mode TEXT NOT NULL DEFAULT 'interval_minutes',
      browser_refresh_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      interval_minutes INTEGER NOT NULL DEFAULT 30,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await getPool().query(`
    ALTER TABLE server_refresh_settings
    ADD COLUMN IF NOT EXISTS interval_minutes INTEGER NOT NULL DEFAULT 30;
  `);

  await getPool().query(`
    ALTER TABLE server_refresh_settings
    ADD COLUMN IF NOT EXISTS browser_refresh_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await getPool().query(`
    INSERT INTO server_refresh_settings (id, enabled, mode, browser_refresh_enabled, interval_minutes)
    VALUES (1, TRUE, 'interval_minutes', TRUE, 30)
    ON CONFLICT (id) DO NOTHING;
  `);

  initialized = true;
}

function normalizeIntervalMinutes(value) {
  const numericValue = Number(value);

  if (ALLOWED_INTERVAL_MINUTES.has(numericValue)) {
    return numericValue;
  }

  return 30;
}

function normalizeMode(value) {
  if (value === SERVER_REFRESH_MODES.OVERNIGHT) {
    return SERVER_REFRESH_MODES.OVERNIGHT;
  }

  return SERVER_REFRESH_MODES.INTERVAL;
}

function mapRow(row) {
  return {
    enabled: Boolean(row?.enabled),
    mode: normalizeMode(row?.mode),
    browserRefreshEnabled: row?.browserRefreshEnabled !== false,
    intervalMinutes: normalizeIntervalMinutes(row?.intervalMinutes),
    updatedAt: row?.updatedAt || null,
  };
}

async function getServerRefreshSettings() {
  await ensureServerRefreshSettingsTable();

  const result = await getPool().query(`
    SELECT
      enabled,
      mode,
      browser_refresh_enabled AS "browserRefreshEnabled",
      interval_minutes AS "intervalMinutes",
      updated_at AS "updatedAt"
    FROM server_refresh_settings
    WHERE id = 1
    LIMIT 1
  `);

  return mapRow(result.rows[0] || {});
}

async function updateServerRefreshSettings({ enabled, browserRefreshEnabled, intervalMinutes, mode }) {
  await ensureServerRefreshSettingsTable();

  const normalizedIntervalMinutes = normalizeIntervalMinutes(intervalMinutes);
  const normalizedMode = normalizeMode(mode);

  const result = await getPool().query(
    `
      UPDATE server_refresh_settings
      SET
        enabled = $1,
        mode = $2,
        browser_refresh_enabled = $3,
        interval_minutes = $4,
        updated_at = NOW()
      WHERE id = 1
      RETURNING
        enabled,
        mode,
        browser_refresh_enabled AS "browserRefreshEnabled",
        interval_minutes AS "intervalMinutes",
        updated_at AS "updatedAt"
    `,
    [Boolean(enabled), normalizedMode, Boolean(browserRefreshEnabled), normalizedIntervalMinutes],
  );

  return mapRow(result.rows[0] || {});
}

module.exports = {
  SERVER_REFRESH_MODES,
  getServerRefreshSettings,
  isServerRefreshStorageConfigured,
  updateServerRefreshSettings,
};
