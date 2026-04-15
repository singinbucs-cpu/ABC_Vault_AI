const { Pool } = require("pg");
const { notifyUsersAboutChanges } = require("./pushover");

let pool;
let initialized = false;

function getConnectionString() {
  return process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL || "";
}

function isScanStorageConfigured() {
  return Boolean(getConnectionString());
}

function getPool() {
  if (!isScanStorageConfigured()) {
    throw new Error("Scan storage is not configured. Add a Postgres connection to the Vercel project first.");
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

async function ensureScanSnapshotsTable() {
  if (initialized) {
    return;
  }

  await getPool().query(`
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
  `);

  await getPool().query(`
    CREATE INDEX IF NOT EXISTS scan_snapshots_scanned_at_idx
    ON scan_snapshots (scanned_at DESC, id DESC);
  `);

  initialized = true;
}

function mapSnapshotRow(row) {
  if (!row) {
    return null;
  }

  return {
    snapshotId: Number(row.id),
    scannedAt: row.scannedAt,
    sourceUrl: row.sourceUrl,
    productCount: row.productCount,
    products: row.products || [],
    metadata: row.metadata || {},
    triggerSource: row.triggerSource,
    storageConfigured: true,
  };
}

function getProductKey(product) {
  return product?.productId || product?.productName;
}

function diffStoredProducts(previousProducts = [], currentProducts = []) {
  const previousMap = new Map(previousProducts.map((product) => [getProductKey(product), product]).filter(([key]) => Boolean(key)));
  const currentMap = new Map(currentProducts.map((product) => [getProductKey(product), product]).filter(([key]) => Boolean(key)));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, currentProduct] of currentMap) {
    const previousProduct = previousMap.get(key);

    if (!previousProduct) {
      added.push(currentProduct);
      continue;
    }

    const fieldChanges = [];
    for (const field of [
      "productName",
      "category",
      "bottleSizeDisplay",
      "price",
      "newBadge",
      "sourcedCertifiedBadge",
      "isPurchasableFromListingPage",
      "soldOutIndicatorPresent",
    ]) {
      if (JSON.stringify(previousProduct[field]) !== JSON.stringify(currentProduct[field])) {
        fieldChanges.push(field);
      }
    }

    if (JSON.stringify(previousProduct.buttonStatesShown) !== JSON.stringify(currentProduct.buttonStatesShown)) {
      fieldChanges.push("buttonStatesShown");
    }

    if (fieldChanges.length) {
      changed.push({
        productId: currentProduct.productId || currentProduct.productName,
        productName: currentProduct.productName,
        productUrl: currentProduct.productUrl || null,
        category: currentProduct.category || "Not Shown",
        bottleSizeDisplay: currentProduct.bottleSizeDisplay || "Not Shown",
        price: currentProduct.price || "Not Shown",
        isPurchasableFromListingPage: Boolean(currentProduct.isPurchasableFromListingPage),
        fields: fieldChanges,
      });
    }
  }

  for (const [key, previousProduct] of previousMap) {
    if (!currentMap.has(key)) {
      removed.push(previousProduct);
    }
  }

  return {
    added,
    removed,
    changed,
    totalChanges: added.length + removed.length + changed.length,
  };
}

async function getLatestStoredSnapshot() {
  await ensureScanSnapshotsTable();

  const result = await getPool().query(
    `
      SELECT
        id,
        scanned_at AS "scannedAt",
        source_url AS "sourceUrl",
        product_count AS "productCount",
        products,
        metadata,
        trigger_source AS "triggerSource"
      FROM scan_snapshots
      ORDER BY scanned_at DESC, id DESC
      LIMIT 1
    `,
  );

  return mapSnapshotRow(result.rows[0]);
}

async function getLatestServerRefreshSnapshot() {
  await ensureScanSnapshotsTable();

  const result = await getPool().query(
    `
      SELECT
        id,
        scanned_at AS "scannedAt",
        source_url AS "sourceUrl",
        product_count AS "productCount",
        products,
        metadata,
        trigger_source AS "triggerSource"
      FROM scan_snapshots
      WHERE trigger_source = 'vercel-cron'
      ORDER BY scanned_at DESC, id DESC
      LIMIT 1
    `,
  );

  return mapSnapshotRow(result.rows[0]);
}

async function saveSnapshot(snapshot, triggerSource = "manual") {
  await ensureScanSnapshotsTable();
  const previousSnapshot = await getLatestStoredSnapshot();

  const result = await getPool().query(
    `
      INSERT INTO scan_snapshots (
        scanned_at,
        source_url,
        product_count,
        products,
        metadata,
        trigger_source
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
      RETURNING
        id,
        scanned_at AS "scannedAt",
        source_url AS "sourceUrl",
        product_count AS "productCount",
        products,
        metadata,
        trigger_source AS "triggerSource"
    `,
    [
      snapshot.scannedAt,
      snapshot.sourceUrl,
      snapshot.productCount,
      JSON.stringify(snapshot.products || []),
      JSON.stringify(snapshot.metadata || {}),
      triggerSource,
    ],
  );

  const storedSnapshot = mapSnapshotRow(result.rows[0]);
  const shouldTreatFirstStoredScanAsAdded = !previousSnapshot && triggerSource !== "initial-bootstrap";
  const changes = previousSnapshot
    ? diffStoredProducts(previousSnapshot.products, storedSnapshot.products)
    : shouldTreatFirstStoredScanAsAdded
    ? {
        added: storedSnapshot.products || [],
        removed: [],
        changed: [],
        totalChanges: (storedSnapshot.products || []).length,
      }
    : {
        added: [],
        removed: [],
        changed: [],
        totalChanges: 0,
      };

  if (changes.totalChanges > 0) {
    await notifyUsersAboutChanges(changes, storedSnapshot, {
      isInitialLoad: shouldTreatFirstStoredScanAsAdded,
    });
  }

  return {
    ...storedSnapshot,
    changes,
  };
}

async function clearSnapshots() {
  await ensureScanSnapshotsTable();
  await getPool().query("TRUNCATE TABLE scan_snapshots RESTART IDENTITY");
}

module.exports = {
  clearSnapshots,
  diffStoredProducts,
  getLatestServerRefreshSnapshot,
  getLatestStoredSnapshot,
  isScanStorageConfigured,
  saveSnapshot,
};
