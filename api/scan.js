const { scanShop } = require("../lib/scan");
const {
  clearSnapshots,
  getLatestStoredSnapshot,
  isScanStorageConfigured,
  saveSnapshot,
} = require("../lib/scan-history-db");
const { requireAppUser } = require("../lib/auth");

async function runAndPersistScan(triggerSource) {
  const liveSnapshot = await scanShop();

  if (!isScanStorageConfigured()) {
    return {
      ...liveSnapshot,
      storageConfigured: false,
      triggerSource,
    };
  }

  return saveSnapshot(liveSnapshot, triggerSource);
}

module.exports = async (req, res) => {
  try {
    const auth = await requireAppUser(req, res, req.method === "DELETE" ? { requireRole: "admin" } : {});
    if (!auth) {
      return;
    }

    if (req.method === "DELETE") {
      if (!isScanStorageConfigured()) {
        throw new Error("Scan storage is not configured.");
      }

      await clearSnapshots();
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.status(200).send(
        JSON.stringify(
          {
            success: true,
            cleared: true,
            message: "Stored listings were cleared from Postgres. Background scans may repopulate them on the next run.",
          },
          null,
          2,
        ),
      );
      return;
    }

    const refreshRequested =
      req.method === "POST" ||
      req.query?.refresh === "1" ||
      req.query?.refresh === "true";

    let result;

    if (refreshRequested) {
      result = await runAndPersistScan(req.query?.trigger || "manual-refresh");
    } else if (isScanStorageConfigured()) {
      result = await getLatestStoredSnapshot();

      if (!result) {
        result = await runAndPersistScan("initial-bootstrap");
      }
    } else {
      result = await runAndPersistScan("manual-no-storage");
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(JSON.stringify(result, null, 2));
  } catch (error) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(500).send(
      JSON.stringify(
        {
          error: "scan_failed",
          message: error.message,
        },
        null,
        2,
      ),
    );
  }
};
