function trimEnv(name) {
  return (process.env[name] || "").trim();
}

function getRemoteBrowserConfig() {
  const baseUrl = trimEnv("REMOTE_BROWSER_BASE_URL").replace(/\/+$/, "");
  const apiToken = trimEnv("REMOTE_BROWSER_API_TOKEN");
  const dashboardUrl = trimEnv("REMOTE_BROWSER_DASHBOARD_URL") || (baseUrl ? `${baseUrl}/dashboard` : "");

  return {
    baseUrl,
    apiToken,
    dashboardUrl,
  };
}

function isRemoteBrowserConfigured() {
  const { baseUrl, apiToken } = getRemoteBrowserConfig();
  return Boolean(baseUrl && apiToken);
}

async function callRemoteBrowser(path, options = {}) {
  const { baseUrl, apiToken } = getRemoteBrowserConfig();

  if (!baseUrl || !apiToken) {
    throw new Error("Remote browser is not configured yet.");
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${apiToken}`);

    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "Remote browser request failed.");
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Remote browser request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRemoteBrowserStatus() {
  return callRemoteBrowser("/status", { timeoutMs: 20_000 });
}

async function openRemoteBrowserUrl(url) {
  return callRemoteBrowser("/open", {
    method: "POST",
    body: { url },
    timeoutMs: 70_000,
  });
}

async function openRemoteBrowserFlow({ vaultUrl, productUrl, vaultKey, label }) {
  return callRemoteBrowser("/open-flow", {
    method: "POST",
    body: {
      vaultUrl,
      productUrl,
      vaultKey,
      label,
    },
    timeoutMs: 90_000,
  });
}

module.exports = {
  fetchRemoteBrowserStatus,
  getRemoteBrowserConfig,
  isRemoteBrowserConfigured,
  openRemoteBrowserFlow,
  openRemoteBrowserUrl,
};
