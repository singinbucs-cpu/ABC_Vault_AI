const { authenticateRequest } = require("../lib/auth");
const { getAppUserByEmail } = require("../lib/app-users-db");
const { getLatestServerRefreshSnapshotSummary } = require("../lib/scan-history-db");

function sendSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ error: "method_not_allowed" }, null, 2));
    return;
  }

  const auth = await authenticateRequest(req);

  if (!auth.ok) {
    res.writeHead(auth.statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(auth.payload, null, 2));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let closed = false;
  const initialServerRefresh = await getLatestServerRefreshSnapshotSummary().catch(() => null);
  let lastVaultKeySignature = JSON.stringify({
    vaultKeyCode: auth.appUser?.vaultKeyCode || "",
    vaultKeyLastReceivedAt: auth.appUser?.vaultKeyLastReceivedAt || "",
  });
  let lastServerRefreshScannedAt = initialServerRefresh?.scannedAt || "";

  sendSseEvent(res, "ready", {
    ok: true,
    vaultKeyCode: auth.appUser?.vaultKeyCode || "",
    vaultKeyLastReceivedAt: auth.appUser?.vaultKeyLastReceivedAt || "",
    lastServerRefreshScannedAt: initialServerRefresh?.scannedAt || "",
  });

  const pollForChanges = async () => {
    if (closed) {
      return;
    }

    try {
      const latestAppUser = await getAppUserByEmail(auth.user.email);
      const latestServerRefresh = await getLatestServerRefreshSnapshotSummary().catch(() => null);
      const nextVaultKeySignature = JSON.stringify({
        vaultKeyCode: latestAppUser?.vaultKeyCode || "",
        vaultKeyLastReceivedAt: latestAppUser?.vaultKeyLastReceivedAt || "",
      });
      const nextServerRefreshScannedAt = latestServerRefresh?.scannedAt || "";
      let sentEvent = false;

      if (nextServerRefreshScannedAt && nextServerRefreshScannedAt !== lastServerRefreshScannedAt) {
        lastServerRefreshScannedAt = nextServerRefreshScannedAt;
        sendSseEvent(res, "server-refresh-updated", {
          lastServerRefreshScannedAt: nextServerRefreshScannedAt,
        });
        sentEvent = true;
      }

      if (nextVaultKeySignature !== lastVaultKeySignature) {
        lastVaultKeySignature = nextVaultKeySignature;
        sendSseEvent(res, "vault-key-updated", {
          vaultKeyCode: latestAppUser?.vaultKeyCode || "",
          vaultKeyLastReceivedAt: latestAppUser?.vaultKeyLastReceivedAt || "",
          vaultKeySourceFrom: latestAppUser?.vaultKeySourceFrom || "",
          vaultKeySourceSubject: latestAppUser?.vaultKeySourceSubject || "",
        });
        sentEvent = true;
      }

      if (!sentEvent) {
        res.write(": keep-alive\n\n");
      }
    } catch (error) {
      sendSseEvent(res, "error", {
        message: error.message || "Unable to watch for Vault key updates.",
      });
    }
  };

  const pollInterval = setInterval(pollForChanges, 1000);
  const shutdownTimer = setTimeout(() => {
    if (!closed) {
      sendSseEvent(res, "end", { reconnect: true });
      cleanup();
    }
  }, 50000);

  const cleanup = () => {
    if (closed) {
      return;
    }

    closed = true;
    clearInterval(pollInterval);
    clearTimeout(shutdownTimer);
    res.end();
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
};
