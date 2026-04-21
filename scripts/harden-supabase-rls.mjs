import pg from "pg";

const { Pool } = pg;

const TABLES = [
  "app_users",
  "scan_snapshots",
  "scan_runtime_state",
  "hot_items",
  "server_refresh_settings",
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it to your Supabase direct database URL.`);
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

async function main() {
  const databaseUrl = requireEnv("TARGET_DATABASE_URL");
  const pool = createPool(databaseUrl);

  try {
    const results = [];

    for (const tableName of TABLES) {
      if (!(await tableExists(pool, tableName))) {
        results.push({
          table: tableName,
          status: "skipped",
          detail: "table does not exist",
        });
        continue;
      }

      await pool.query(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
      results.push({
        table: tableName,
        status: "hardened",
        detail: "RLS enabled",
      });
    }

    console.table(results);
    console.log("Supabase RLS hardening complete.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Supabase RLS hardening failed:");
  console.error(error);
  process.exit(1);
});
