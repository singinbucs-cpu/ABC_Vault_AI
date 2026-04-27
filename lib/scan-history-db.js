const { notifyUsersAboutChanges } = require("./pushover");
const { clearAllChangeNotifications, createUserChangeNotifications } = require("./change-notifications-db");
const { getConnectionString, getPgPool } = require("./db");

let initialized = false;
const SNAPSHOT_RETENTION_DAYS = 14;

function isScanStorageConfigured() {
  return Boolean(getConnectionString());
}

function getPool() {
  if (!isScanStorageConfigured()) {
    throw new Error("Scan storage is not configured. Add a Postgres connection to the Vercel project first.");
  }

  return getPgPool();
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

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS scan_runtime_state (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      force_next_scan_as_initial_load BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await getPool().query(`
    INSERT INTO scan_runtime_state (id, force_next_scan_as_initial_load)
    VALUES (1, FALSE)
    ON CONFLICT (id) DO NOTHING;
  `);

  initialized = true;
}

async function getScanRuntimeState() {
  await ensureScanSnapshotsTable();

  const result = await getPool().query(`
    SELECT
      force_next_scan_as_initial_load AS "forceNextScanAsInitialLoad"
    FROM scan_runtime_state
    WHERE id = 1
    LIMIT 1
  `);

  return {
    forceNextScanAsInitialLoad: Boolean(result.rows[0]?.forceNextScanAsInitialLoad),
  };
}

async function setForceNextScanAsInitialLoad(enabled) {
  await ensureScanSnapshotsTable();

  await getPool().query(
    `
      UPDATE scan_runtime_state
      SET
        force_next_scan_as_initial_load = $1,
        updated_at = NOW()
      WHERE id = 1
    `,
    [Boolean(enabled)],
  );
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

function mapSnapshotSummaryRow(row) {
  if (!row) {
    return null;
  }

  return {
    snapshotId: Number(row.id),
    scannedAt: row.scannedAt,
    sourceUrl: row.sourceUrl,
    productCount: row.productCount,
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
    const changeDetails = {};
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
        changeDetails[field] = {
          previous: previousProduct[field],
          current: currentProduct[field],
        };
      }
    }

    if (JSON.stringify(previousProduct.buttonStatesShown) !== JSON.stringify(currentProduct.buttonStatesShown)) {
      fieldChanges.push("buttonStatesShown");
      changeDetails.buttonStatesShown = {
        previous: previousProduct.buttonStatesShown,
        current: currentProduct.buttonStatesShown,
      };
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
        details: changeDetails,
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

async function getLatestServerRefreshSnapshotSummary() {
  await ensureScanSnapshotsTable();

  const result = await getPool().query(
    `
      SELECT
        id,
        scanned_at AS "scannedAt",
        source_url AS "sourceUrl",
        product_count AS "productCount",
        trigger_source AS "triggerSource"
      FROM scan_snapshots
      WHERE trigger_source = 'vercel-cron'
      ORDER BY scanned_at DESC, id DESC
      LIMIT 1
    `,
  );

  return mapSnapshotSummaryRow(result.rows[0]);
}

async function pruneOldScanSnapshots(retentionDays = SNAPSHOT_RETENTION_DAYS) {
  await ensureScanSnapshotsTable();

  const result = await getPool().query(
    `
      WITH latest_snapshot AS (
        SELECT id
        FROM scan_snapshots
        ORDER BY scanned_at DESC, id DESC
        LIMIT 1
      ),
      deleted_snapshots AS (
        DELETE FROM scan_snapshots
        WHERE scanned_at < NOW() - ($1::INTEGER * INTERVAL '1 day')
          AND id NOT IN (SELECT id FROM latest_snapshot)
        RETURNING id
      )
      SELECT COUNT(*)::INTEGER AS "deletedCount"
      FROM deleted_snapshots
    `,
    [Number(retentionDays) || SNAPSHOT_RETENTION_DAYS],
  );

  return {
    retentionDays: Number(retentionDays) || SNAPSHOT_RETENTION_DAYS,
    deletedCount: Number(result.rows[0]?.deletedCount || 0),
  };
}

async function saveSnapshot(snapshot, triggerSource = "manual") {
  await ensureScanSnapshotsTable();
  const previousSnapshot = await getLatestStoredSnapshot();
  const runtimeState = await getScanRuntimeState();

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
  const shouldTreatFirstStoredScanAsAdded =
    ((!previousSnapshot && triggerSource !== "initial-bootstrap") || runtimeState.forceNextScanAsInitialLoad) &&
    triggerSource !== "initial-bootstrap";
  const previousVaultStatus = previousSnapshot?.metadata?.vaultStatus?.status || null;
  const currentVaultStatus = storedSnapshot?.metadata?.vaultStatus?.status || null;
  const vaultStatusTransition =
    previousVaultStatus && currentVaultStatus && previousVaultStatus !== currentVaultStatus
      ? {
          previousStatus: previousVaultStatus,
          currentStatus: currentVaultStatus,
          vaultUrl: storedSnapshot?.metadata?.vaultStatus?.sourceUrl || "https://theabcvault.com/",
        }
      : null;
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

  if (runtimeState.forceNextScanAsInitialLoad) {
    await setForceNextScanAsInitialLoad(false);
  }

  if (changes.totalChanges > 0 || vaultStatusTransition) {
    if (changes.totalChanges > 0) {
      await createUserChangeNotifications(changes, storedSnapshot).catch((error) => {
        console.error(`Failed to create in-app change notifications: ${error.message}`);
      });
    }

    await notifyUsersAboutChanges(changes, storedSnapshot, {
      isInitialLoad: shouldTreatFirstStoredScanAsAdded,
      vaultStatusTransition,
    });
  }

  const cleanup = await pruneOldScanSnapshots(SNAPSHOT_RETENTION_DAYS);

  return {
    ...storedSnapshot,
    changes,
    vaultStatusTransition,
    cleanup,
  };
}

async function clearSnapshots() {
  await ensureScanSnapshotsTable();
  await getPool().query("TRUNCATE TABLE scan_snapshots RESTART IDENTITY");
  await clearAllChangeNotifications();
  await setForceNextScanAsInitialLoad(true);
}

module.exports = {
  clearSnapshots,
  diffStoredProducts,
  getLatestServerRefreshSnapshot,
  getLatestServerRefreshSnapshotSummary,
  getLatestStoredSnapshot,
  isScanStorageConfigured,
  pruneOldScanSnapshots,
  saveSnapshot,
};
