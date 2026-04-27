const { getConnectionString, getPgPool } = require("./db");

let initialized = false;

function isVercelSpendWebhookStorageConfigured() {
  return Boolean(getConnectionString());
}

function getPool() {
  if (!isVercelSpendWebhookStorageConfigured()) {
    throw new Error("Vercel spend webhook storage is not configured. Add Postgres first.");
  }

  return getPgPool();
}

async function ensureVercelSpendWebhookSettingsTable() {
  if (initialized) {
    return;
  }

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS vercel_spend_webhook_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      notify_billing_cycle_end BOOLEAN NOT NULL DEFAULT TRUE,
      critical_budget_reached BOOLEAN NOT NULL DEFAULT TRUE,
      critical_billing_cycle_end BOOLEAN NOT NULL DEFAULT FALSE,
      last_event_type TEXT,
      last_event_message TEXT,
      last_event_received_at TIMESTAMPTZ,
      last_event_payload JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await getPool().query(`
    ALTER TABLE vercel_spend_webhook_settings
    ADD COLUMN IF NOT EXISTS notify_billing_cycle_end BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await getPool().query(`
    ALTER TABLE vercel_spend_webhook_settings
    ADD COLUMN IF NOT EXISTS critical_budget_reached BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await getPool().query(`
    ALTER TABLE vercel_spend_webhook_settings
    ADD COLUMN IF NOT EXISTS critical_billing_cycle_end BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE vercel_spend_webhook_settings
    ADD COLUMN IF NOT EXISTS last_event_type TEXT;
  `);

  await getPool().query(`
    ALTER TABLE vercel_spend_webhook_settings
    ADD COLUMN IF NOT EXISTS last_event_message TEXT;
  `);

  await getPool().query(`
    ALTER TABLE vercel_spend_webhook_settings
    ADD COLUMN IF NOT EXISTS last_event_received_at TIMESTAMPTZ;
  `);

  await getPool().query(`
    ALTER TABLE vercel_spend_webhook_settings
    ADD COLUMN IF NOT EXISTS last_event_payload JSONB;
  `);

  await getPool().query(`
    INSERT INTO vercel_spend_webhook_settings (
      id,
      enabled,
      notify_billing_cycle_end,
      critical_budget_reached,
      critical_billing_cycle_end
    )
    VALUES (1, TRUE, TRUE, TRUE, FALSE)
    ON CONFLICT (id) DO NOTHING;
  `);

  initialized = true;
}

function mapRow(row) {
  return {
    enabled: Boolean(row?.enabled),
    notifyBillingCycleEnd: Boolean(row?.notifyBillingCycleEnd),
    criticalBudgetReached: Boolean(row?.criticalBudgetReached),
    criticalBillingCycleEnd: Boolean(row?.criticalBillingCycleEnd),
    lastEventType: row?.lastEventType || "",
    lastEventMessage: row?.lastEventMessage || "",
    lastEventReceivedAt: row?.lastEventReceivedAt || null,
    lastEventPayload: row?.lastEventPayload || null,
    updatedAt: row?.updatedAt || null,
  };
}

async function getVercelSpendWebhookSettings() {
  await ensureVercelSpendWebhookSettingsTable();

  const result = await getPool().query(`
    SELECT
      enabled,
      notify_billing_cycle_end AS "notifyBillingCycleEnd",
      critical_budget_reached AS "criticalBudgetReached",
      critical_billing_cycle_end AS "criticalBillingCycleEnd",
      last_event_type AS "lastEventType",
      last_event_message AS "lastEventMessage",
      last_event_received_at AS "lastEventReceivedAt",
      last_event_payload AS "lastEventPayload",
      updated_at AS "updatedAt"
    FROM vercel_spend_webhook_settings
    WHERE id = 1
    LIMIT 1
  `);

  return mapRow(result.rows[0] || {});
}

async function updateVercelSpendWebhookSettings({
  enabled,
  notifyBillingCycleEnd,
  criticalBudgetReached,
  criticalBillingCycleEnd,
}) {
  await ensureVercelSpendWebhookSettingsTable();

  const result = await getPool().query(
    `
      UPDATE vercel_spend_webhook_settings
      SET
        enabled = $1,
        notify_billing_cycle_end = $2,
        critical_budget_reached = $3,
        critical_billing_cycle_end = $4,
        updated_at = NOW()
      WHERE id = 1
      RETURNING
        enabled,
        notify_billing_cycle_end AS "notifyBillingCycleEnd",
        critical_budget_reached AS "criticalBudgetReached",
        critical_billing_cycle_end AS "criticalBillingCycleEnd",
        last_event_type AS "lastEventType",
        last_event_message AS "lastEventMessage",
        last_event_received_at AS "lastEventReceivedAt",
        last_event_payload AS "lastEventPayload",
        updated_at AS "updatedAt"
    `,
    [Boolean(enabled), Boolean(notifyBillingCycleEnd), Boolean(criticalBudgetReached), Boolean(criticalBillingCycleEnd)],
  );

  return mapRow(result.rows[0] || {});
}

async function recordVercelSpendWebhookEvent({ eventType, message, receivedAt, payload }) {
  await ensureVercelSpendWebhookSettingsTable();

  const result = await getPool().query(
    `
      UPDATE vercel_spend_webhook_settings
      SET
        last_event_type = $1,
        last_event_message = $2,
        last_event_received_at = $3,
        last_event_payload = $4::jsonb,
        updated_at = NOW()
      WHERE id = 1
      RETURNING
        enabled,
        notify_billing_cycle_end AS "notifyBillingCycleEnd",
        critical_budget_reached AS "criticalBudgetReached",
        critical_billing_cycle_end AS "criticalBillingCycleEnd",
        last_event_type AS "lastEventType",
        last_event_message AS "lastEventMessage",
        last_event_received_at AS "lastEventReceivedAt",
        last_event_payload AS "lastEventPayload",
        updated_at AS "updatedAt"
    `,
    [eventType || "", message || "", receivedAt || new Date().toISOString(), JSON.stringify(payload || {})],
  );

  return mapRow(result.rows[0] || {});
}

module.exports = {
  getVercelSpendWebhookSettings,
  isVercelSpendWebhookStorageConfigured,
  recordVercelSpendWebhookEvent,
  updateVercelSpendWebhookSettings,
};
