const { Pool } = require("pg");

let pool;
let initialized = false;
let seededUsers = false;

function getConnectionString() {
  return process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL || "";
}

function isAppUserStorageConfigured() {
  return Boolean(getConnectionString());
}

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function parseEmailList(rawValue) {
  return (rawValue || "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
}

function getPool() {
  if (!isAppUserStorageConfigured()) {
    throw new Error("App user storage is not configured. Connect Postgres before enabling app authentication.");
  }

  if (!pool) {
    const connectionString = getConnectionString();
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
    });
  }

  return pool;
}

async function ensureAppUsersTable() {
  if (initialized) {
    return;
  }

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'viewer',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      pushover_user_key TEXT,
      notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      notify_initial_load BOOLEAN NOT NULL DEFAULT FALSE,
      notify_added BOOLEAN NOT NULL DEFAULT TRUE,
      notify_changed BOOLEAN NOT NULL DEFAULT FALSE,
      notify_removed BOOLEAN NOT NULL DEFAULT FALSE,
      notify_purchasable BOOLEAN NOT NULL DEFAULT FALSE,
      notifications_critical BOOLEAN NOT NULL DEFAULT FALSE,
      critical_initial_load BOOLEAN NOT NULL DEFAULT FALSE,
      critical_added BOOLEAN NOT NULL DEFAULT FALSE,
      critical_changed BOOLEAN NOT NULL DEFAULT FALSE,
      critical_removed BOOLEAN NOT NULL DEFAULT FALSE,
      critical_purchasable BOOLEAN NOT NULL DEFAULT FALSE,
      vault_key_auto_import_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      vault_key_forwarding_email TEXT,
      vault_key_code TEXT,
      vault_key_last_received_at TIMESTAMPTZ,
      vault_key_source_from TEXT,
      vault_key_source_subject TEXT,
      vault_key_source_preview TEXT,
      last_notification_sent_at TIMESTAMPTZ,
      last_notification_message TEXT,
      last_auto_notification_attempt_at TIMESTAMPTZ,
      last_auto_notification_sent BOOLEAN,
      last_auto_notification_reason TEXT,
      last_auto_notification_items TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS pushover_user_key TEXT;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS notify_initial_load BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS notify_added BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS notify_changed BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS notify_removed BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS notify_purchasable BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS notifications_critical BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS critical_initial_load BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS critical_added BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS critical_changed BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS critical_removed BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS critical_purchasable BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS vault_key_auto_import_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS vault_key_forwarding_email TEXT;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS vault_key_code TEXT;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS vault_key_last_received_at TIMESTAMPTZ;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS vault_key_source_from TEXT;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS vault_key_source_subject TEXT;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS vault_key_source_preview TEXT;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS last_notification_sent_at TIMESTAMPTZ;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS last_notification_message TEXT;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS last_auto_notification_attempt_at TIMESTAMPTZ;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS last_auto_notification_sent BOOLEAN;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS last_auto_notification_reason TEXT;
  `);

  await getPool().query(`
    ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS last_auto_notification_items TEXT;
  `);

  initialized = true;
}

async function seedUsersFromEnv() {
  if (seededUsers) {
    return;
  }

  await ensureAppUsersTable();

  const adminEmails = new Set(parseEmailList(process.env.ADMIN_EMAILS));
  const allowedEmails = new Set([
    ...adminEmails,
    ...parseEmailList(process.env.ALLOWED_USER_EMAILS),
  ]);

  if (!allowedEmails.size) {
    seededUsers = true;
    return;
  }

  for (const email of allowedEmails) {
    const role = adminEmails.has(email) ? "admin" : "viewer";
    await getPool().query(
      `
        INSERT INTO app_users (email, role, is_active, updated_at)
        VALUES ($1, $2, TRUE, NOW())
        ON CONFLICT (email)
        DO UPDATE SET
          role = EXCLUDED.role,
          is_active = TRUE,
          updated_at = NOW()
      `,
      [email, role],
    );
  }

  seededUsers = true;
}

async function getAppUserByEmail(email) {
  await seedUsersFromEnv();

  const result = await getPool().query(
    `
      SELECT
        id,
        email,
        role,
        is_active AS "isActive",
        pushover_user_key AS "pushoverUserKey",
        notifications_enabled AS "notificationsEnabled",
        notify_initial_load AS "notifyInitialLoad",
        notify_added AS "notifyAdded",
        notify_changed AS "notifyChanged",
        notify_removed AS "notifyRemoved",
        notify_purchasable AS "notifyPurchasable",
        notifications_critical AS "notificationsCritical",
        critical_initial_load AS "criticalInitialLoad",
        critical_added AS "criticalAdded",
        critical_changed AS "criticalChanged",
        critical_removed AS "criticalRemoved",
        critical_purchasable AS "criticalPurchasable",
        vault_key_auto_import_enabled AS "vaultKeyAutoImportEnabled",
        vault_key_forwarding_email AS "vaultKeyForwardingEmail",
        vault_key_code AS "vaultKeyCode",
        vault_key_last_received_at AS "vaultKeyLastReceivedAt",
        vault_key_source_from AS "vaultKeySourceFrom",
        vault_key_source_subject AS "vaultKeySourceSubject",
        vault_key_source_preview AS "vaultKeySourcePreview",
        last_notification_sent_at AS "lastNotificationSentAt",
        last_notification_message AS "lastNotificationMessage",
        last_auto_notification_attempt_at AS "lastAutoNotificationAttemptAt",
        last_auto_notification_sent AS "lastAutoNotificationSent",
        last_auto_notification_reason AS "lastAutoNotificationReason",
        last_auto_notification_items AS "lastAutoNotificationItems"
      FROM app_users
      WHERE email = $1
      LIMIT 1
    `,
    [normalizeEmail(email)],
  );

  return result.rows[0] || null;
}

async function updateAppUserProfile(email, updates = {}) {
  await seedUsersFromEnv();

  const normalizedEmail = normalizeEmail(email);
  const pushoverUserKey = (updates.pushoverUserKey || "").trim() || null;
  const notificationsEnabled = Boolean(updates.notificationsEnabled);
  const notifyInitialLoad = Boolean(updates.notifyInitialLoad);
  const notifyAdded = Boolean(updates.notifyAdded);
  const notifyChanged = Boolean(updates.notifyChanged);
  const notifyRemoved = Boolean(updates.notifyRemoved);
  const notifyPurchasable = Boolean(updates.notifyPurchasable);
  const notificationsCritical = Boolean(updates.notificationsCritical);
  const criticalInitialLoad = Boolean(updates.criticalInitialLoad);
  const criticalAdded = Boolean(updates.criticalAdded);
  const criticalChanged = Boolean(updates.criticalChanged);
  const criticalRemoved = Boolean(updates.criticalRemoved);
  const criticalPurchasable = Boolean(updates.criticalPurchasable);
  const vaultKeyAutoImportEnabled = Boolean(updates.vaultKeyAutoImportEnabled);
  const vaultKeyForwardingEmail = normalizeEmail(updates.vaultKeyForwardingEmail || "");

  const result = await getPool().query(
    `
      UPDATE app_users
      SET
        pushover_user_key = $2,
        notifications_enabled = $3,
        notify_initial_load = $4,
        notify_added = $5,
        notify_changed = $6,
        notify_removed = $7,
        notify_purchasable = $8,
        notifications_critical = $9,
        critical_initial_load = $10,
        critical_added = $11,
        critical_changed = $12,
        critical_removed = $13,
        critical_purchasable = $14,
        vault_key_auto_import_enabled = $15,
        vault_key_forwarding_email = $16,
        updated_at = NOW()
      WHERE email = $1
      RETURNING
        id,
        email,
        role,
        is_active AS "isActive",
        pushover_user_key AS "pushoverUserKey",
        notifications_enabled AS "notificationsEnabled",
        notify_initial_load AS "notifyInitialLoad",
        notify_added AS "notifyAdded",
        notify_changed AS "notifyChanged",
        notify_removed AS "notifyRemoved",
        notify_purchasable AS "notifyPurchasable",
        notifications_critical AS "notificationsCritical",
        critical_initial_load AS "criticalInitialLoad",
        critical_added AS "criticalAdded",
        critical_changed AS "criticalChanged",
        critical_removed AS "criticalRemoved",
        critical_purchasable AS "criticalPurchasable",
        vault_key_auto_import_enabled AS "vaultKeyAutoImportEnabled",
        vault_key_forwarding_email AS "vaultKeyForwardingEmail",
        vault_key_code AS "vaultKeyCode",
        vault_key_last_received_at AS "vaultKeyLastReceivedAt",
        vault_key_source_from AS "vaultKeySourceFrom",
        vault_key_source_subject AS "vaultKeySourceSubject",
        vault_key_source_preview AS "vaultKeySourcePreview",
        last_notification_sent_at AS "lastNotificationSentAt",
        last_notification_message AS "lastNotificationMessage",
        last_auto_notification_attempt_at AS "lastAutoNotificationAttemptAt",
        last_auto_notification_sent AS "lastAutoNotificationSent",
        last_auto_notification_reason AS "lastAutoNotificationReason",
        last_auto_notification_items AS "lastAutoNotificationItems"
    `,
    [
      normalizedEmail,
      pushoverUserKey,
      notificationsEnabled,
      notifyInitialLoad,
      notifyAdded,
      notifyChanged,
      notifyRemoved,
      notifyPurchasable,
      notificationsCritical,
      criticalInitialLoad,
      criticalAdded,
      criticalChanged,
      criticalRemoved,
      criticalPurchasable,
      vaultKeyAutoImportEnabled,
      vaultKeyForwardingEmail || null,
    ],
  );

  return result.rows[0] || null;
}

async function findAppUserByVaultForwardingEmail(email) {
  await seedUsersFromEnv();

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const result = await getPool().query(
    `
      SELECT
        id,
        email,
        role,
        is_active AS "isActive",
        pushover_user_key AS "pushoverUserKey",
        notifications_enabled AS "notificationsEnabled",
        notify_initial_load AS "notifyInitialLoad",
        notify_added AS "notifyAdded",
        notify_changed AS "notifyChanged",
        notify_removed AS "notifyRemoved",
        notify_purchasable AS "notifyPurchasable",
        notifications_critical AS "notificationsCritical",
        critical_initial_load AS "criticalInitialLoad",
        critical_added AS "criticalAdded",
        critical_changed AS "criticalChanged",
        critical_removed AS "criticalRemoved",
        critical_purchasable AS "criticalPurchasable",
        vault_key_auto_import_enabled AS "vaultKeyAutoImportEnabled",
        vault_key_forwarding_email AS "vaultKeyForwardingEmail",
        vault_key_code AS "vaultKeyCode",
        vault_key_last_received_at AS "vaultKeyLastReceivedAt",
        vault_key_source_from AS "vaultKeySourceFrom",
        vault_key_source_subject AS "vaultKeySourceSubject",
        vault_key_source_preview AS "vaultKeySourcePreview",
        last_notification_sent_at AS "lastNotificationSentAt",
        last_notification_message AS "lastNotificationMessage",
        last_auto_notification_attempt_at AS "lastAutoNotificationAttemptAt",
        last_auto_notification_sent AS "lastAutoNotificationSent",
        last_auto_notification_reason AS "lastAutoNotificationReason",
        last_auto_notification_items AS "lastAutoNotificationItems"
      FROM app_users
      WHERE is_active = TRUE
        AND (
          vault_key_forwarding_email = $1
          OR email = $1
        )
      ORDER BY CASE WHEN vault_key_forwarding_email = $1 THEN 0 ELSE 1 END, email ASC
      LIMIT 1
    `,
    [normalizedEmail],
  );

  return result.rows[0] || null;
}

async function recordVaultKeyForUser(
  email,
  {
    vaultKeyCode,
    receivedAt = new Date().toISOString(),
    sourceFrom = "",
    sourceSubject = "",
    sourcePreview = "",
  } = {},
) {
  await seedUsersFromEnv();

  const result = await getPool().query(
    `
      UPDATE app_users
      SET
        vault_key_code = $2,
        vault_key_last_received_at = $3,
        vault_key_source_from = $4,
        vault_key_source_subject = $5,
        vault_key_source_preview = $6,
        updated_at = NOW()
      WHERE email = $1
      RETURNING
        id,
        email,
        role,
        is_active AS "isActive",
        pushover_user_key AS "pushoverUserKey",
        notifications_enabled AS "notificationsEnabled",
        notify_initial_load AS "notifyInitialLoad",
        notify_added AS "notifyAdded",
        notify_changed AS "notifyChanged",
        notify_removed AS "notifyRemoved",
        notify_purchasable AS "notifyPurchasable",
        notifications_critical AS "notificationsCritical",
        critical_initial_load AS "criticalInitialLoad",
        critical_added AS "criticalAdded",
        critical_changed AS "criticalChanged",
        critical_removed AS "criticalRemoved",
        critical_purchasable AS "criticalPurchasable",
        vault_key_auto_import_enabled AS "vaultKeyAutoImportEnabled",
        vault_key_forwarding_email AS "vaultKeyForwardingEmail",
        vault_key_code AS "vaultKeyCode",
        vault_key_last_received_at AS "vaultKeyLastReceivedAt",
        vault_key_source_from AS "vaultKeySourceFrom",
        vault_key_source_subject AS "vaultKeySourceSubject",
        vault_key_source_preview AS "vaultKeySourcePreview",
        last_notification_sent_at AS "lastNotificationSentAt",
        last_notification_message AS "lastNotificationMessage",
        last_auto_notification_attempt_at AS "lastAutoNotificationAttemptAt",
        last_auto_notification_sent AS "lastAutoNotificationSent",
        last_auto_notification_reason AS "lastAutoNotificationReason",
        last_auto_notification_items AS "lastAutoNotificationItems"
    `,
    [
      normalizeEmail(email),
      (vaultKeyCode || "").trim() || null,
      receivedAt,
      (sourceFrom || "").trim() || null,
      (sourceSubject || "").trim() || null,
      (sourcePreview || "").trim() || null,
    ],
  );

  return result.rows[0] || null;
}

async function listNotificationRecipients() {
  await seedUsersFromEnv();

  const result = await getPool().query(
    `
      SELECT
        id,
        email,
        role,
        is_active AS "isActive",
        pushover_user_key AS "pushoverUserKey",
        notifications_enabled AS "notificationsEnabled",
        notify_initial_load AS "notifyInitialLoad",
        notify_added AS "notifyAdded",
        notify_changed AS "notifyChanged",
        notify_removed AS "notifyRemoved",
        notify_purchasable AS "notifyPurchasable",
        notifications_critical AS "notificationsCritical",
        critical_initial_load AS "criticalInitialLoad",
        critical_added AS "criticalAdded",
        critical_changed AS "criticalChanged",
        critical_removed AS "criticalRemoved",
        critical_purchasable AS "criticalPurchasable",
        last_notification_sent_at AS "lastNotificationSentAt",
        last_notification_message AS "lastNotificationMessage",
        last_auto_notification_attempt_at AS "lastAutoNotificationAttemptAt",
        last_auto_notification_sent AS "lastAutoNotificationSent",
        last_auto_notification_reason AS "lastAutoNotificationReason",
        last_auto_notification_items AS "lastAutoNotificationItems"
      FROM app_users
      WHERE is_active = TRUE
        AND pushover_user_key IS NOT NULL
        AND pushover_user_key <> ''
      ORDER BY email ASC
    `,
  );

  return result.rows;
}

async function recordNotificationSent(email, message, sentAt = new Date().toISOString()) {
  await seedUsersFromEnv();

  const result = await getPool().query(
    `
      UPDATE app_users
      SET
        last_notification_sent_at = $2,
        last_notification_message = $3,
        updated_at = NOW()
      WHERE email = $1
      RETURNING
        id,
        email,
        role,
        is_active AS "isActive",
        pushover_user_key AS "pushoverUserKey",
        notifications_enabled AS "notificationsEnabled",
        notify_initial_load AS "notifyInitialLoad",
        notify_added AS "notifyAdded",
        notify_changed AS "notifyChanged",
        notify_removed AS "notifyRemoved",
        notify_purchasable AS "notifyPurchasable",
        notifications_critical AS "notificationsCritical",
        critical_initial_load AS "criticalInitialLoad",
        critical_added AS "criticalAdded",
        critical_changed AS "criticalChanged",
        critical_removed AS "criticalRemoved",
        critical_purchasable AS "criticalPurchasable",
        last_notification_sent_at AS "lastNotificationSentAt",
        last_notification_message AS "lastNotificationMessage",
        last_auto_notification_attempt_at AS "lastAutoNotificationAttemptAt",
        last_auto_notification_sent AS "lastAutoNotificationSent",
        last_auto_notification_reason AS "lastAutoNotificationReason",
        last_auto_notification_items AS "lastAutoNotificationItems"
    `,
    [normalizeEmail(email), sentAt, message],
  );

  return result.rows[0] || null;
}

async function recordAutoNotificationAttempt(
  email,
  { attemptedAt = new Date().toISOString(), sent = false, reason = "", items = "" } = {},
) {
  await seedUsersFromEnv();

  const result = await getPool().query(
    `
      UPDATE app_users
      SET
        last_auto_notification_attempt_at = $2,
        last_auto_notification_sent = $3,
        last_auto_notification_reason = $4,
        last_auto_notification_items = $5,
        updated_at = NOW()
      WHERE email = $1
      RETURNING
        id,
        email,
        role,
        is_active AS "isActive",
        pushover_user_key AS "pushoverUserKey",
        notifications_enabled AS "notificationsEnabled",
        notify_initial_load AS "notifyInitialLoad",
        notify_added AS "notifyAdded",
        notify_changed AS "notifyChanged",
        notify_removed AS "notifyRemoved",
        notify_purchasable AS "notifyPurchasable",
        notifications_critical AS "notificationsCritical",
        critical_initial_load AS "criticalInitialLoad",
        critical_added AS "criticalAdded",
        critical_changed AS "criticalChanged",
        critical_removed AS "criticalRemoved",
        critical_purchasable AS "criticalPurchasable",
        last_notification_sent_at AS "lastNotificationSentAt",
        last_notification_message AS "lastNotificationMessage",
        last_auto_notification_attempt_at AS "lastAutoNotificationAttemptAt",
        last_auto_notification_sent AS "lastAutoNotificationSent",
        last_auto_notification_reason AS "lastAutoNotificationReason",
        last_auto_notification_items AS "lastAutoNotificationItems"
    `,
    [normalizeEmail(email), attemptedAt, sent, reason || "", items || ""],
  );

  return result.rows[0] || null;
}

module.exports = {
  findAppUserByVaultForwardingEmail,
  getAppUserByEmail,
  isAppUserStorageConfigured,
  listNotificationRecipients,
  normalizeEmail,
  parseEmailList,
  recordAutoNotificationAttempt,
  recordNotificationSent,
  recordVaultKeyForUser,
  updateAppUserProfile,
};
