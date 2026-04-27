const http = require("http");
const fs = require("fs");
const path = require("path");
const hotItemsHandler = require("./api/hot-items");
const scanHandler = require("./api/scan");
const cronScanHandler = require("./api/cron-scan");
const authConfigHandler = require("./api/auth-config");
const adminUsersHandler = require("./api/admin-users");
const requestOtpHandler = require("./api/request-otp");
const meHandler = require("./api/me");
const meStreamHandler = require("./api/me-stream");
const pushoverTestHandler = require("./api/pushover-test");
const changeNotificationsHandler = require("./api/change-notifications");
const serverRefreshSettingsHandler = require("./api/server-refresh-settings");
const vercelSpendWebhookHandler = require("./api/vercel-spend-webhook");
const vercelSpendWebhookSettingsHandler = require("./api/vercel-spend-webhook-settings");
const remoteBrowserHandler = require("./api/remote-browser");
const vaultKeyEmailHandler = require("./api/vault-key-email");
const vaultEmailEventsHandler = require("./api/vault-email-events");

const rootDir = __dirname;
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendNodeResponse(res) {
  return {
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    status(statusCode) {
      res.statusCode = statusCode;
      return this;
    },
    send(payload) {
      res.end(payload);
    },
  };
}

function createNodeRequest(req, url, body) {
  return {
    method: req.method,
    headers: req.headers,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
    rawBody: typeof body === "string" ? body : undefined,
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveFile(reqPath, res) {
  const safePath = reqPath === "/" ? "/index.html" : reqPath;
  const filePath = path.join(rootDir, safePath);

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, fileBuffer) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end(error.code === "ENOENT" ? "Not found" : "Internal server error");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300",
    });
    res.end(fileBuffer);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/scan") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;

      await scanHandler(createNodeRequest(req, url, parsedBody), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "scan_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/change-notifications") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;

      await changeNotificationsHandler(createNodeRequest(req, url, parsedBody), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "change_notifications_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/cron-scan") {
    try {
      await cronScanHandler(createNodeRequest(req, url), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "cron_scan_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/auth-config") {
    try {
      await authConfigHandler(createNodeRequest(req, url), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "auth_config_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/admin-users") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      await adminUsersHandler(createNodeRequest(req, url, parsedBody), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "admin_users_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/request-otp") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      await requestOtpHandler(createNodeRequest(req, url, parsedBody), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "request_otp_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/me") {
    try {
      await meHandler(createNodeRequest(req, url), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "me_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/me-stream") {
    try {
      req.query = Object.fromEntries(url.searchParams.entries());
      await meStreamHandler(req, res);
    } catch (error) {
      sendJson(res, 500, {
        error: "me_stream_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/hot-items") {
    try {
      const rawBody = ["POST", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      await hotItemsHandler(createNodeRequest(req, url, parsedBody), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "hot_items_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/pushover-test") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      await pushoverTestHandler(createNodeRequest(req, url, parsedBody), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "pushover_test_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/server-refresh-settings") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      await serverRefreshSettingsHandler(createNodeRequest(req, url, parsedBody), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "server_refresh_settings_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/vercel-spend-webhook-settings") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      const nodeReq = createNodeRequest(req, url, parsedBody);
      nodeReq.rawBody = rawBody;
      await vercelSpendWebhookSettingsHandler(nodeReq, sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "vercel_spend_webhook_settings_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/vercel-spend-webhook") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      let parsedBody = undefined;

      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = rawBody;
        }
      }

      const nodeReq = createNodeRequest(req, url, parsedBody);
      nodeReq.rawBody = rawBody;
      await vercelSpendWebhookHandler(nodeReq, sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "vercel_spend_webhook_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/remote-browser") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      let parsedBody = undefined;

      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = rawBody;
        }
      }

      await remoteBrowserHandler(createNodeRequest(req, url, parsedBody), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "remote_browser_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/vault-key-email") {
    try {
      const rawBody = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      let parsedBody = undefined;

      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = { raw: rawBody };
        }
      }

      await vaultKeyEmailHandler(createNodeRequest(req, url, parsedBody), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "vault_key_email_failed",
        message: error.message,
      });
    }
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end("Method not allowed");
    return;
  }

  if (url.pathname === "/api/vault-email-events") {
    try {
      await vaultEmailEventsHandler(createNodeRequest(req, url), sendNodeResponse(res));
    } catch (error) {
      sendJson(res, 500, {
        error: "vault_email_events_failed",
        message: error.message,
      });
    }
    return;
  }

  serveFile(url.pathname, res);
});

server.listen(port, () => {
  console.log(`ABC Vault scanner running at http://localhost:${port}`);
});
