const http = require("http");
const fs = require("fs");
const path = require("path");
const { scanShop } = require("./lib/scan");
const hotItemsHandler = require("./api/hot-items");

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

  if (req.method === "GET" && url.pathname === "/api/scan") {
    try {
      const result = await scanShop();
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: "scan_failed",
        message: error.message,
      });
    }
    return;
  }

  if (url.pathname === "/api/hot-items") {
    try {
      const rawBody = ["POST", "DELETE"].includes(req.method) ? await readRequestBody(req) : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      await hotItemsHandler(
        {
          method: req.method,
          body: parsedBody,
        },
        sendNodeResponse(res),
      );
    } catch (error) {
      sendJson(res, 500, {
        error: "hot_items_failed",
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

  serveFile(url.pathname, res);
});

server.listen(port, () => {
  console.log(`ABC Vault scanner running at http://localhost:${port}`);
});
