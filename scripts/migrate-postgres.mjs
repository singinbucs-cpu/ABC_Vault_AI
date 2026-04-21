import pg from "pg";

const { Pool } = pg;

const TABLES = [
  "app_users",
  "scan_snapshots",
  "scan_runtime_state",
  "hot_items",
  "server_refresh_settings",
];

const SCHEMA_SQL = `
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
  notify_vault_open BOOLEAN NOT NULL DEFAULT TRUE,
  notify_vault_closed BOOLEAN NOT NULL DEFAULT TRUE,
  notifications_critical BOOLEAN NOT NULL DEFAULT FALSE,
  critical_initial_load BOOLEAN NOT NULL DEFAULT FALSE,
  critical_added BOOLEAN NOT NULL DEFAULT FALSE,
  critical_changed BOOLEAN NOT NULL DEFAULT FALSE,
  critical_removed BOOLEAN NOT NULL DEFAULT FALSE,
  critical_purchasable BOOLEAN NOT NULL DEFAULT FALSE,
  critical_vault_open BOOLEAN NOT NULL DEFAULT FALSE,
  critical_vault_closed BOOLEAN NOT NULL DEFAULT FALSE,
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

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS app_users_vault_key_forwarding_email_idx
ON app_users (vault_key_forwarding_email)
WHERE vault_key_forwarding_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS scan_snapshots (
  id BIGSERIAL PRIMARY KEY,
  scanned_at TIMESTAMPTZ NOT NULL,
  source_url TEXT NOT NULL,
  product_count INTEGER NOT NULL,
  products JSONB NOT NULL,
  metadata JSONB NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scan_snapshots ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS scan_snapshots_scanned_at_idx
ON scan_snapshots (scanned_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS scan_runtime_state (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  force_next_scan_as_initial_load BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scan_runtime_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS hot_items (
  product_id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  category TEXT,
  bottle_size_display TEXT,
  price TEXT,
  is_purchasable BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hot_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS server_refresh_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mode TEXT NOT NULL DEFAULT 'interval_minutes',
  interval_minutes INTEGER NOT NULL DEFAULT 30,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE server_refresh_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO scan_runtime_state (id, force_next_scan_as_initial_load)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO server_refresh_settings (id, enabled, mode, interval_minutes)
VALUES (1, TRUE, 'interval_minutes', 30)
ON CONFLICT (id) DO NOTHING;
`;

function parseArgs() {
  const args = new Set(process.argv.slice(2));

  return {
    dryRun: args.has("--dry-run"),
    schemaOnly: args.has("--schema-only"),
    replaceTarget: args.has("--replace-target"),
  };
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it before running the migration.`);
  }

  return value;
}

function createPool(connectionString) {
  const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

  return new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 20_000,
    allowExitOnIdle: true,
  });
}

async function tableExists(pool, tableName) {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName],
  );

  return Boolean(result.rows[0]?.exists);
}

async function listColumns(pool, tableName) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName],
  );

  return result.rows.map((row) => row.column_name);
}

async function countRows(pool, tableName) {
  if (!(await tableExists(pool, tableName))) {
    return 0;
  }

  const result = await pool.query(`SELECT COUNT(*)::INTEGER AS count FROM ${tableName}`);
  return Number(result.rows[0]?.count || 0);
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function copyTable({ sourcePool, targetPool, tableName }) {
  if (!(await tableExists(sourcePool, tableName))) {
    return {
      tableName,
      sourceCount: 0,
      copiedCount: 0,
      skipped: true,
      reason: "Source table does not exist.",
    };
  }

  const sourceColumns = await listColumns(sourcePool, tableName);
  const targetColumns = new Set(await listColumns(targetPool, tableName));
  const columns = sourceColumns.filter((column) => targetColumns.has(column));

  if (!columns.length) {
    return {
      tableName,
      sourceCount: await countRows(sourcePool, tableName),
      copiedCount: 0,
      skipped: true,
      reason: "No matching columns found in target table.",
    };
  }

  const selectColumns = columns.map(quoteIdentifier).join(", ");
  const sourceRows = (await sourcePool.query(`SELECT ${selectColumns} FROM ${tableName}`)).rows;

  if (!sourceRows.length) {
    return {
      tableName,
      sourceCount: 0,
      copiedCount: 0,
      skipped: false,
    };
  }

  const insertColumns = columns.map(quoteIdentifier).join(", ");
  const valuePlaceholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const insertSql = `
    INSERT INTO ${tableName} (${insertColumns})
    VALUES (${valuePlaceholders})
    ON CONFLICT DO NOTHING
  `;

  let copiedCount = 0;
  for (const row of sourceRows) {
    const values = columns.map((column) => {
      const value = row[column];
      return value && typeof value === "object" && !(value instanceof Date) ? JSON.stringify(value) : value;
    });
    const result = await targetPool.query(insertSql, values);
    copiedCount += result.rowCount || 0;
  }

  return {
    tableName,
    sourceCount: sourceRows.length,
    copiedCount,
    skipped: false,
  };
}

async function resetSequences(pool) {
  await pool.query(`
    SELECT setval(
      pg_get_serial_sequence('app_users', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 0) FROM app_users), 1),
      (SELECT COUNT(*) > 0 FROM app_users)
    );
  `);

  await pool.query(`
    SELECT setval(
      pg_get_serial_sequence('scan_snapshots', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 0) FROM scan_snapshots), 1),
      (SELECT COUNT(*) > 0 FROM scan_snapshots)
    );
  `);
}

async function main() {
  const options = parseArgs();
  const targetUrl = requireEnv("TARGET_DATABASE_URL");
  const sourceUrl = options.schemaOnly ? "" : requireEnv("SOURCE_DATABASE_URL");

  const targetPool = createPool(targetUrl);
  const sourcePool = sourceUrl ? createPool(sourceUrl) : null;

  try {
    console.log("Creating target schema if needed...");
    await targetPool.query(SCHEMA_SQL);

    if (options.schemaOnly) {
      console.log("Schema-only run complete. No data was copied.");
      return;
    }

    console.log("Checking source and target row counts...");
    const beforeCounts = {};
    for (const tableName of TABLES) {
      beforeCounts[tableName] = {
        source: await countRows(sourcePool, tableName),
        target: await countRows(targetPool, tableName),
      };
    }
    console.table(beforeCounts);

    if (options.dryRun) {
      console.log("Dry run complete. No data was copied.");
      return;
    }

    if (options.replaceTarget) {
      console.log("Replacing target data...");
      await targetPool.query(
        "TRUNCATE TABLE scan_snapshots, scan_runtime_state, hot_items, server_refresh_settings, app_users RESTART IDENTITY",
      );
      await targetPool.query(SCHEMA_SQL);
    }

    console.log("Copying data...");
    const results = [];
    for (const tableName of TABLES) {
      results.push(await copyTable({ sourcePool, targetPool, tableName }));
    }
    console.table(results);

    await resetSequences(targetPool);

    console.log("Migration complete.");
    console.log("Next: set Vercel POSTGRES_URL to the Supabase connection string and redeploy.");
  } finally {
    await sourcePool?.end();
    await targetPool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:");
  console.error(error);
  process.exit(1);
});
