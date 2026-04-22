const { getConnectionString, getPgPool } = require("./db");

let initialized = false;

function isVaultEmailEventStorageConfigured() {
  return Boolean(getConnectionString());
}

function getPool() {
  if (!isVaultEmailEventStorageConfigured()) {
    throw new Error("Postgres is not configured. Connect Postgres before storing Vault email events.");
  }

  return getPgPool();
}

async function ensureVaultEmailEventsTable() {
  if (initialized) {
    return;
  }

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS vault_email_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      subject TEXT,
      from_address TEXT,
      recipient_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
      candidate_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
      matched_user_email TEXT,
      vault_key_code TEXT,
      confirmation_code TEXT,
      confirmation_links JSONB NOT NULL DEFAULT '[]'::jsonb,
      preview TEXT,
      received_at TIMESTAMPTZ,
      raw_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await getPool().query(`
    CREATE INDEX IF NOT EXISTS vault_email_events_created_at_idx
    ON vault_email_events (created_at DESC);
  `);

  initialized = true;
}

async function saveVaultEmailEvent(event = {}) {
  if (!isVaultEmailEventStorageConfigured()) {
    return null;
  }

  await ensureVaultEmailEventsTable();

  const result = await getPool().query(
    `
      INSERT INTO vault_email_events (
        event_type,
        status,
        message,
        subject,
        from_address,
        recipient_emails,
        candidate_emails,
        matched_user_email,
        vault_key_code,
        confirmation_code,
        confirmation_links,
        preview,
        received_at,
        raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13, $14::jsonb)
      RETURNING
        id,
        event_type AS "eventType",
        status,
        message,
        subject,
        from_address AS "fromAddress",
        recipient_emails AS "recipientEmails",
        candidate_emails AS "candidateEmails",
        matched_user_email AS "matchedUserEmail",
        vault_key_code AS "vaultKeyCode",
        confirmation_code AS "confirmationCode",
        confirmation_links AS "confirmationLinks",
        preview,
        received_at AS "receivedAt",
        created_at AS "createdAt"
    `,
    [
      event.eventType || "vault_email",
      event.status || "received",
      event.message || "",
      event.subject || "",
      event.fromAddress || "",
      JSON.stringify(event.recipientEmails || []),
      JSON.stringify(event.candidateEmails || []),
      event.matchedUserEmail || null,
      event.vaultKeyCode || null,
      event.confirmationCode || null,
      JSON.stringify(event.confirmationLinks || []),
      event.preview || "",
      event.receivedAt || null,
      JSON.stringify(event.rawPayload || {}),
    ],
  );

  return result.rows[0] || null;
}

async function listVaultEmailEvents({ limit = 25 } = {}) {
  if (!isVaultEmailEventStorageConfigured()) {
    return [];
  }

  await ensureVaultEmailEventsTable();

  const result = await getPool().query(
    `
      SELECT
        id,
        event_type AS "eventType",
        status,
        message,
        subject,
        from_address AS "fromAddress",
        recipient_emails AS "recipientEmails",
        candidate_emails AS "candidateEmails",
        matched_user_email AS "matchedUserEmail",
        vault_key_code AS "vaultKeyCode",
        confirmation_code AS "confirmationCode",
        confirmation_links AS "confirmationLinks",
        preview,
        received_at AS "receivedAt",
        created_at AS "createdAt"
      FROM vault_email_events
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [Math.min(Math.max(Number(limit) || 25, 1), 100)],
  );

  return result.rows;
}

async function deleteVaultEmailEvent(id) {
  await ensureVaultEmailEventsTable();

  const result = await getPool().query(
    `
      DELETE FROM vault_email_events
      WHERE id = $1
      RETURNING id
    `,
    [Number(id)],
  );

  return result.rowCount;
}

async function deleteAllVaultEmailEvents() {
  await ensureVaultEmailEventsTable();

  const result = await getPool().query("DELETE FROM vault_email_events");
  return result.rowCount;
}

module.exports = {
  deleteAllVaultEmailEvents,
  deleteVaultEmailEvent,
  isVaultEmailEventStorageConfigured,
  listVaultEmailEvents,
  saveVaultEmailEvent,
};
