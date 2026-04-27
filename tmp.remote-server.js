import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const app = express();
app.use(express.json({ limit: '256kb' }));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3100);
const API_TOKEN = (process.env.API_TOKEN || '').trim();
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '/opt/vault-remote-opener/screenshots';
const SCREENSHOT_PATH = path.join(SCREENSHOT_DIR, 'latest.png');
const CHROME_CDP_URL = process.env.CHROME_CDP_URL || 'http://127.0.0.1:9222';

let connectedBrowser;
let browserContext;
let currentPage;
let pendingLoginContinuation;
let lastState = {
  busy: false,
  lastUrl: '',
  lastVaultUrl: '',
  lastProductUrl: '',
  lastVaultKey: '',
  lastFlowMode: '',
  lastFinalUrl: '',
  lastTitle: '',
  lastOpenedAt: '',
  lastError: '',
};

function authOk(req) {
  if (!API_TOKEN) return false;
  const header = req.headers.authorization || '';
  return header === `Bearer ${API_TOKEN}`;
}

function requireAuth(req, res, next) {
  if (!authOk(req)) {
    res.status(401).json({ ok: false, message: 'Unauthorized.' });
    return;
  }
  next();
}

async function ensureLiveChrome() {
  if (connectedBrowser?.isConnected() && browserContext) {
    return browserContext;
  }

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  connectedBrowser = await chromium.connectOverCDP(CHROME_CDP_URL);
  connectedBrowser.on('disconnected', () => {
    connectedBrowser = undefined;
    browserContext = undefined;
    currentPage = undefined;
  });

  browserContext = connectedBrowser.contexts()[0];
  if (!browserContext) {
    throw new Error('Live Chrome context is not available.');
  }

  currentPage = chooseBestPage(browserContext.pages()) || await browserContext.newPage();
  return browserContext;
}

function chooseBestPage(pages) {
  const candidates = pages.filter((page) => {
    if (!page || page.isClosed()) return false;
    const url = page.url() || '';
    return !url.startsWith('devtools://') && !url.startsWith('chrome-extension://');
  });

  const preferred = candidates.filter((page) => {
    const url = page.url() || '';
    return url && url !== 'about:blank' && url !== 'chrome://newtab/';
  });

  return preferred.at(-1) || candidates.at(-1);
}

async function ensurePage() {
  await ensureLiveChrome();

  if (!currentPage || currentPage.isClosed()) {
    currentPage = chooseBestPage(browserContext.pages()) || await browserContext.newPage();
  }

  await currentPage.bringToFront().catch(() => null);
  return currentPage;
}

async function captureState(options = {}) {
  if (!currentPage || currentPage.isClosed()) return;

  const { screenshot = true } = options;
  const title = await currentPage.title().catch(() => '');
  if (screenshot) {
    await currentPage.screenshot({ path: SCREENSHOT_PATH, fullPage: false }).catch(() => null);
  }
  lastState.lastFinalUrl = currentPage.url();
  lastState.lastTitle = title;
  lastState.lastOpenedAt = new Date().toISOString();
}

async function preparePage(url) {
  const page = await ensurePage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);
  await page.bringToFront().catch(() => null);
}

async function attemptVaultKeyStep(vaultKey) {
  if (!vaultKey || !currentPage || currentPage.isClosed()) {
    return { usedVaultKey: false, gateFound: false };
  }

  const inputSelectors = ['#vault-key', 'input[name="vault-key"]', 'input#vault-key'];
  const buttonSelectors = ['#vault-key-submit', 'button#vault-key-submit', 'button[type="submit"]'];

  let inputHandle = null;
  for (const selector of inputSelectors) {
    inputHandle = await currentPage.$(selector);
    if (inputHandle) break;
  }

  if (!inputHandle) {
    return { usedVaultKey: false, gateFound: false };
  }

  await inputHandle.fill(vaultKey).catch(() => null);

  let submitted = false;
  for (const selector of buttonSelectors) {
    const buttonHandle = await currentPage.$(selector);
    if (buttonHandle) {
      await buttonHandle.click().catch(() => null);
      submitted = true;
      break;
    }
  }

  if (!submitted) {
    await inputHandle.press('Enter').catch(() => null);
  }

  await currentPage.waitForTimeout(3000);
  await currentPage.bringToFront().catch(() => null);
  return { usedVaultKey: true, gateFound: true };
}

async function isLikelyLoginPage(page = currentPage) {
  if (!page || page.isClosed()) {
    return false;
  }

  const url = page.url() || '';
  if (url.includes('/login.php')) {
    return true;
  }

  const passwordField = await page.$('input[type="password"], input[name="login_pass"], input#login_pass').catch(() => null);
  return Boolean(passwordField);
}

function startManualLoginContinuation({ productUrl, label }) {
  if (pendingLoginContinuation) {
    return;
  }

  lastState.busy = true;
  lastState.lastFlowMode = 'waiting-for-manual-login';
  lastState.lastError = '';

  pendingLoginContinuation = (async () => {
    const timeoutMs = 60 * 1000;
    const pollMs = 2000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await ensurePage();
      await captureState().catch(() => null);

      if (!(await isLikelyLoginPage())) {
        if (productUrl) {
          await preparePage(productUrl);
        }

        if (await isLikelyLoginPage()) {
          await currentPage.waitForTimeout(pollMs);
          continue;
        }

        lastState.lastFlowMode = 'live-chrome-vault-login-product-complete';
        await captureState().catch(() => null);
        lastState.busy = false;
        return;
      }

      await currentPage.waitForTimeout(pollMs);
    }

    lastState.lastError = `Timed out waiting for manual login${label ? ` for ${label}` : ''}.`;
    lastState.lastFlowMode = 'manual-login-timeout';
    lastState.busy = false;
  })().finally(() => {
    pendingLoginContinuation = undefined;
  });
}

async function openUrl(targetUrl) {
  lastState.busy = true;
  lastState.lastError = '';
  lastState.lastFlowMode = 'live-chrome-open';
  lastState.lastUrl = targetUrl;
  lastState.lastVaultUrl = '';
  lastState.lastProductUrl = '';
  lastState.lastVaultKey = '';

  try {
    await preparePage(targetUrl);
    await captureState();
    return { ok: true, title: lastState.lastTitle, finalUrl: currentPage.url() };
  } catch (error) {
    lastState.lastError = error?.message || 'Unknown error';
    return { ok: false, message: lastState.lastError };
  } finally {
    lastState.busy = false;
  }
}

async function openFlow({ vaultUrl, productUrl, vaultKey, label }) {
  lastState.busy = true;
  lastState.lastError = '';
  lastState.lastFlowMode = 'live-chrome-vault-login-product';
  lastState.lastVaultUrl = vaultUrl || '';
  lastState.lastProductUrl = productUrl || '';
  lastState.lastUrl = productUrl || vaultUrl || '';
  lastState.lastVaultKey = vaultKey || '';

  try {
    if (vaultUrl) {
      await preparePage(vaultUrl);
      await attemptVaultKeyStep(vaultKey);

      if (await isLikelyLoginPage()) {
        await captureState();
        startManualLoginContinuation({ productUrl, label });
        return {
          ok: true,
          waitingForManualLogin: true,
          label: label || 'Vault flow',
          title: lastState.lastTitle,
          finalUrl: currentPage.url(),
          message: 'Manual login required. Finish login in the live Chrome session and the opener will continue to the selected product page automatically.',
          vaultUrl: vaultUrl || '',
          productUrl: productUrl || '',
          vaultKey: vaultKey || '',
        };
      }
    }

    if (productUrl) {
      await preparePage(productUrl);

      if (await isLikelyLoginPage()) {
        await captureState();
        startManualLoginContinuation({ productUrl, label });
        return {
          ok: true,
          waitingForManualLogin: true,
          label: label || 'Vault flow',
          title: lastState.lastTitle,
          finalUrl: currentPage.url(),
          message: 'Manual login required. Finish login in the live Chrome session and the opener will continue to the selected product page automatically.',
          vaultUrl: vaultUrl || '',
          productUrl: productUrl || '',
          vaultKey: vaultKey || '',
        };
      }
    }

    await captureState();
    return {
      ok: true,
      label: label || 'Vault flow',
      title: lastState.lastTitle,
      finalUrl: currentPage.url(),
      vaultUrl: vaultUrl || '',
      productUrl: productUrl || '',
      vaultKey: vaultKey || '',
    };
  } catch (error) {
    lastState.lastError = error?.message || 'Unknown error';
    return { ok: false, message: lastState.lastError };
  } finally {
    lastState.busy = false;
  }
}

function renderDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vault Remote Browser</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Arial, sans-serif; background: #101318; color: #f4f7fb; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
    .panel { background: #181d25; border: 1px solid #2d3542; border-radius: 18px; padding: 18px; margin-bottom: 18px; }
    h1, h2 { margin: 0 0 10px; }
    p, li, span { line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .stat { background: #11161d; border: 1px solid #2b3340; border-radius: 14px; padding: 12px; }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #95a2b5; }
    .value { margin-top: 6px; font-size: 14px; word-break: break-word; }
    form { display: flex; gap: 10px; flex-wrap: wrap; }
    input { flex: 1 1 420px; border-radius: 12px; border: 1px solid #354051; background: #0f141a; color: #fff; padding: 12px 14px; }
    button { border: 0; border-radius: 999px; background: #ef3340; color: #fff; padding: 12px 18px; font-weight: 700; cursor: pointer; }
    button.secondary { background: #283140; }
    .message { margin-top: 12px; color: #ffd98b; }
    img { width: 100%; border-radius: 16px; border: 1px solid #2d3542; background: #0b0f14; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <h1>Vault Remote Browser</h1>
      <p>Open a page on the live Chrome desktop session, then keep an eye on the latest screenshot and status from here.</p>
      <form id="open-form">
        <input id="url" name="url" type="url" placeholder="https://theabcvault.com/shop/" required />
        <button type="submit">Open URL</button>
        <button class="secondary" type="button" id="refresh">Refresh status</button>
      </form>
      <div class="message" id="message"></div>
    </div>
    <div class="panel">
      <h2>Status</h2>
      <div class="grid" id="stats"></div>
    </div>
    <div class="panel">
      <h2>Latest screenshot</h2>
      <img id="shot" src="/dashboard-screenshot?ts=${Date.now()}" alt="Latest remote browser screenshot" />
    </div>
  </div>
  <script>
    const stats = document.getElementById('stats');
    const message = document.getElementById('message');
    const shot = document.getElementById('shot');
    const form = document.getElementById('open-form');
    const urlInput = document.getElementById('url');
    const refreshButton = document.getElementById('refresh');

    function renderStat(label, value) {
      const div = document.createElement('div');
      div.className = 'stat';
      div.innerHTML = '<div class="label"></div><div class="value"></div>';
      div.querySelector('.label').textContent = label;
      div.querySelector('.value').textContent = value || '?';
      return div;
    }

    async function loadStatus() {
      const response = await fetch('/dashboard-data', { cache: 'no-store' });
      const payload = await response.json();
      stats.innerHTML = '';
      [
        ['Busy', payload.busy ? 'Yes' : 'No'],
        ['Flow mode', payload.lastFlowMode],
        ['Vault URL', payload.lastVaultUrl],
        ['Product URL', payload.lastProductUrl],
        ['Vault key', payload.lastVaultKey],
        ['Last requested URL', payload.lastUrl],
        ['Current page', payload.lastFinalUrl],
        ['Page title', payload.lastTitle],
        ['Last opened', payload.lastOpenedAt],
        ['Error', payload.lastError || 'No recent error'],
      ].forEach(([label, value]) => stats.appendChild(renderStat(label, value)));
      shot.src = '/dashboard-screenshot?ts=' + Date.now();
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = 'Opening URL on the live Chrome session...';
      const response = await fetch('/dashboard-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.value.trim() }),
      });
      const payload = await response.json();
      message.textContent = payload.ok ? ('Opened. Current page: ' + (payload.finalUrl || payload.title || 'Done')) : (payload.message || 'Open failed.');
      await loadStatus();
    });

    refreshButton.addEventListener('click', () => loadStatus().catch((error) => {
      message.textContent = error.message || 'Unable to refresh status.';
    }));

    loadStatus().catch((error) => {
      message.textContent = error.message || 'Unable to load status.';
    });
    setInterval(() => loadStatus().catch(() => {}), 15000);
  </script>
</body>
</html>`;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vault-remote-opener', mode: 'live-chrome', cdpUrl: CHROME_CDP_URL });
});

app.get('/status', requireAuth, async (_req, res) => {
  await captureState({ screenshot: false }).catch(() => null);
  res.json({ ok: true, ...lastState });
});

app.post('/open', requireAuth, async (req, res) => {
  const targetUrl = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    res.status(400).json({ ok: false, message: 'A full http or https URL is required.' });
    return;
  }
  if (lastState.busy) {
    res.status(409).json({ ok: false, message: 'The opener is already working on another request.' });
    return;
  }
  const result = await openUrl(targetUrl);
  res.status(result.ok ? 200 : 500).json(result);
});

app.post('/open-flow', requireAuth, async (req, res) => {
  const vaultUrl = String(req.body?.vaultUrl || '').trim();
  const productUrl = String(req.body?.productUrl || '').trim();
  const vaultKey = String(req.body?.vaultKey || '').trim();
  const label = String(req.body?.label || '').trim();

  if (!/^https?:\/\//i.test(productUrl)) {
    res.status(400).json({ ok: false, message: 'A full product URL is required.' });
    return;
  }
  if (vaultUrl && !/^https?:\/\//i.test(vaultUrl)) {
    res.status(400).json({ ok: false, message: 'A full vault URL is required.' });
    return;
  }
  if (lastState.busy) {
    res.status(409).json({ ok: false, message: 'The opener is already working on another request.' });
    return;
  }

  const result = await openFlow({ vaultUrl, productUrl, vaultKey, label });
  res.status(result.ok ? 200 : 500).json(result);
});

app.get('/dashboard', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderDashboardHtml());
});

app.get('/dashboard-data', async (_req, res) => {
  await captureState({ screenshot: false }).catch(() => null);
  res.json(lastState);
});

app.post('/dashboard-open', async (req, res) => {
  const targetUrl = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    res.status(400).json({ ok: false, message: 'A full http or https URL is required.' });
    return;
  }
  if (lastState.busy) {
    res.status(409).json({ ok: false, message: 'The opener is already working on another request.' });
    return;
  }

  const result = await openUrl(targetUrl);
  res.status(result.ok ? 200 : 500).json(result);
});

app.get(['/screenshot', '/dashboard-screenshot'], async (_req, res) => {
  try {
    await captureState().catch(() => null);
    await fs.access(SCREENSHOT_PATH);
    res.sendFile(SCREENSHOT_PATH);
  } catch {
    res.status(404).json({ ok: false, message: 'No screenshot captured yet.' });
  }
});

app.post('/close', requireAuth, async (_req, res) => {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.close().catch(() => null);
  }
  currentPage = undefined;
  await captureState().catch(() => null);
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`vault-remote-opener listening on ${HOST}:${PORT} (mode=live-chrome)`);
});
