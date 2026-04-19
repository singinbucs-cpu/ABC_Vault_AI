const { Pool } = require("pg");

function getConnectionString() {
  return process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL || "";
}

function isLocalConnection(connectionString) {
  return connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
}

function getPgPool() {
  const connectionString = getConnectionString();

  if (!connectionString) {
    throw new Error("Postgres is not configured. Add a runtime Postgres connection to the Vercel project first.");
  }

  if (!globalThis.__abcVaultPgPool) {
    globalThis.__abcVaultPgPool = new Pool({
      connectionString,
      ssl: isLocalConnection(connectionString) ? false : { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
  }

  return globalThis.__abcVaultPgPool;
}

module.exports = {
  getConnectionString,
  getPgPool,
};
