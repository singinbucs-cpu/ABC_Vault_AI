import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const STORAGE_KEY = "abc-vault-live-scanner:last-scan:v1";
const THEME_STORAGE_KEY = "abc-vault-live-scanner:theme:v1";
const MAGIC_LINK_COOLDOWN_KEY = "abc-vault-live-scanner:magic-link-cooldown:v1";
const APP_BASE_URL = "https://abc-vault-live-scanner.vercel.app/";
const AUTO_REFRESH_SECONDS = 30;
const REFRESH_RATE_OPTIONS = [1, 2, 5, 10, 15, 30];
const SERVER_REFRESH_INTERVAL_OPTIONS = [1, 5, 10, 30, 60];
const MAGIC_LINK_COOLDOWN_SECONDS = 60;
const CELEBRATION_CONFETTI_COUNT = 18;

function createEmptyChangeFeed() {
  return {
    added: [],
    changed: [],
    removed: [],
  };
}

function mergeChangeItems(existingItems, incomingItems, getKey) {
  const merged = new Map(existingItems.map((item) => [getKey(item), item]));

  incomingItems.forEach((item) => {
    merged.set(getKey(item), item);
  });

  return Array.from(merged.values());
}

function buildAddedItems(items, detectedAt) {
  return items.map((item) => ({
    productId: item.productId || item.productName,
    productName: item.productName,
    productUrl: item.productUrl || null,
    detectedAt,
  }));
}

function playNotificationSound(audioContextRef) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    const audioContext = audioContextRef.current || new AudioContextClass();
    audioContextRef.current = audioContext;

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    const startAt = audioContext.currentTime;
    const playTone = ({ offset = 0, duration = 0.24, type = "triangle", frequency = 440, volume = 0.06, endFrequency = null }) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const filterNode = audioContext.createBiquadFilter();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, startAt + offset);
      if (endFrequency && endFrequency !== frequency) {
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + offset + duration);
      }

      filterNode.type = "lowpass";
      filterNode.frequency.setValueAtTime(2100, startAt + offset);
      filterNode.Q.value = 0.9;

      gainNode.gain.setValueAtTime(0.0001, startAt + offset);
      gainNode.gain.exponentialRampToValueAtTime(volume, startAt + offset + 0.03);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(volume * 0.48, 0.0001), startAt + offset + duration * 0.6);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + duration);

      oscillator.connect(filterNode);
      filterNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.start(startAt + offset);
      oscillator.stop(startAt + offset + duration + 0.02);
    };

    const playClink = (offset = 0.2) => {
      [1320, 1760, 2240].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        const filterNode = audioContext.createBiquadFilter();
        const noteOffset = offset + index * 0.016;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startAt + noteOffset);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.94, startAt + noteOffset + 0.14);

        filterNode.type = "bandpass";
        filterNode.frequency.setValueAtTime(frequency, startAt + noteOffset);
        filterNode.Q.value = 7;

        gainNode.gain.setValueAtTime(0.0001, startAt + noteOffset);
        gainNode.gain.exponentialRampToValueAtTime(0.048, startAt + noteOffset + 0.008);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + noteOffset + 0.16);

        oscillator.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.start(startAt + noteOffset);
        oscillator.stop(startAt + noteOffset + 0.18);
      });
    };

    playTone({ offset: 0, duration: 0.34, type: "triangle", frequency: 196, endFrequency: 233, volume: 0.06 });
    playTone({ offset: 0.08, duration: 0.34, type: "triangle", frequency: 246.94, endFrequency: 293.66, volume: 0.05 });
    playTone({ offset: 0.16, duration: 0.38, type: "triangle", frequency: 392, endFrequency: 493.88, volume: 0.072 });
    playTone({ offset: 0.24, duration: 0.46, type: "sawtooth", frequency: 587.33, endFrequency: 659.25, volume: 0.04 });
    playClink(0.26);
  } catch {
    // Ignore browser audio restrictions and keep the app functional.
  }
}

function parseSseChunks(buffer, onEvent) {
  const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
  const events = normalizedBuffer.split("\n\n");
  const remaining = events.pop() || "";

  events.forEach((rawEvent) => {
    const lines = rawEvent.split("\n");
    let eventName = "message";
    const dataLines = [];

    lines.forEach((line) => {
      if (!line || line.startsWith(":")) {
        return;
      }

      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
        return;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    });

    if (!dataLines.length) {
      return;
    }

    try {
      onEvent(eventName, JSON.parse(dataLines.join("\n")));
    } catch {
      // Ignore malformed event payloads and keep the stream alive.
    }
  });

  return remaining;
}

function formatChangedFieldLabel(field) {
  const labels = {
    productName: "Product name updated",
    category: "Category changed",
    bottleSizeDisplay: "Bottle size changed",
    price: "Price changed",
    newBadge: "New badge changed",
    sourcedCertifiedBadge: "Sourced & Certified badge changed",
    isPurchasableFromListingPage: "Purchasable status changed",
    soldOutIndicatorPresent: "Sold-out status changed",
    buttonStatesShown: "Buttons shown changed",
  };

  return labels[field] || field;
}

function buildCelebrationConfetti() {
  return Array.from({ length: CELEBRATION_CONFETTI_COUNT }, (_, index) => ({
    id: `confetti-${index}`,
    left: `${5 + (index * 90) / Math.max(CELEBRATION_CONFETTI_COUNT - 1, 1)}%`,
    delay: `${(index % 6) * 0.08}s`,
    duration: `${2.2 + (index % 5) * 0.18}s`,
    rotation: `${(index % 2 === 0 ? 1 : -1) * (18 + (index % 4) * 9)}deg`,
  }));
}

function fallbackCopyText(value) {
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-1000px";
  textArea.style.left = "-1000px";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);

  let copied = false;

  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textArea);
  }

  return copied;
}

function formatBooleanText(value) {
  return value ? "Yes" : "No";
}

function summarizeChangedFields(fields) {
  if (!fields?.length) {
    return "Listing details changed";
  }

  return fields.map((field) => formatChangedFieldLabel(field)).join(", ");
}

function getVaultStatusDisplay(status) {
  if (status === "closed") {
    return { label: "Closed", tone: "tag-no", icon: "🔒" };
  }

  if (status === "open") {
    return { label: "Open", tone: "tag-yes", icon: "🔓" };
  }

  return { label: "Unknown", tone: "tag-neutral", icon: "❔" };
}

function readPreviousSnapshot() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function formatScanTime(value) {
  if (!value) {
    return "Not scanned yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatNotificationMessage(value) {
  return value || "No notification has been sent yet.";
}

function formatBooleanStatus(value) {
  if (value === true) {
    return "Yes";
  }

  if (value === false) {
    return "No";
  }

  return "Not attempted yet";
}

function formatServerRefreshMode(intervalMinutes) {
  const numericInterval = Number(intervalMinutes) || 30;
  return numericInterval >= 60 ? "Every 1 hour" : `Every ${numericInterval} minute${numericInterval === 1 ? "" : "s"}`;
}

function getNextServerRefreshLabel(settings, enabledOverride, intervalOverride) {
  const enabled = typeof enabledOverride === "boolean" ? enabledOverride : Boolean(settings?.settings?.enabled);
  const intervalMinutes = Number(intervalOverride || settings?.settings?.intervalMinutes) || 30;

  if (!enabled) {
    return "Disabled";
  }

  const lastServerRefresh = settings?.lastServerRefresh?.scannedAt;
  if (!lastServerRefresh) {
    return "On the next available Vercel cron tick";
  }

  const lastRunAt = new Date(lastServerRefresh).getTime();
  if (!Number.isFinite(lastRunAt)) {
    return "On the next available Vercel cron tick";
  }

  return formatScanTime(new Date(lastRunAt + intervalMinutes * 60 * 1000).toISOString());
}

function getInitialTheme() {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch {
    // Ignore storage access failures and fall back to system preference.
  }

  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialMagicLinkCooldown() {
  try {
    const raw = window.localStorage.getItem(MAGIC_LINK_COOLDOWN_KEY);
    const nextAllowedAt = raw ? Number(raw) : 0;
    if (!nextAllowedAt || Number.isNaN(nextAllowedAt)) {
      return 0;
    }

    return Math.max(0, Math.ceil((nextAllowedAt - Date.now()) / 1000));
  } catch {
    return 0;
  }
}

function diffSnapshots(previousProducts, currentProducts) {
  const previousMap = new Map(previousProducts.map((item) => [item.productId || item.productName, item]));
  const currentMap = new Map(currentProducts.map((item) => [item.productId || item.productName, item]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, currentItem] of currentMap) {
    const previousItem = previousMap.get(key);
    if (!previousItem) {
      added.push(currentItem);
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
      if (JSON.stringify(previousItem[field]) !== JSON.stringify(currentItem[field])) {
        fieldChanges.push(field);
      }
    }

    if (JSON.stringify(previousItem.buttonStatesShown) !== JSON.stringify(currentItem.buttonStatesShown)) {
      fieldChanges.push("buttonStatesShown");
    }

    if (fieldChanges.length > 0) {
      changed.push({
        productName: currentItem.productName,
        fields: fieldChanges,
      });
    }
  }

  for (const [key, previousItem] of previousMap) {
    if (!currentMap.has(key)) {
      removed.push(previousItem);
    }
  }

  return { added, removed, changed };
}

function getServerBackedDiff(payload, currentProducts) {
  const localDiff = diffSnapshots(currentProducts || [], payload?.products || []);

  if (payload?.changes) {
    const serverHasChanges = Boolean(payload.changes.totalChanges);
    const currentListIsEmpty = !(currentProducts || []).length;
    const localHasVisibleAdds = Boolean(localDiff.added?.length);

    if (!serverHasChanges && currentListIsEmpty && localHasVisibleAdds) {
      return localDiff;
    }

    return payload.changes;
  }

  return localDiff;
}

function truthyTag(value) {
  return html`<span className=${`tag ${value ? "tag-yes" : "tag-no"}`}>${value ? "Yes" : "No"}</span>`;
}

function isHotItem(hotItems, productId) {
  return hotItems.some((item) => item.productId === productId);
}

function renderLinkedProductName(item) {
  return item.productUrl
    ? html`
        <a className="product-link" href=${item.productUrl} target="_blank" rel="noreferrer">
          ${item.productName}
        </a>
      `
    : html`<span>${item.productName}</span>`;
}

function renderMetaCard(label, value, extra = null) {
  return html`
    <article className="meta-card">
      <div className="meta-card-label">${label}</div>
      <div className="meta-card-value">${value}</div>
      ${extra ? html`<div className="meta-card-extra">${extra}</div>` : null}
    </article>
  `;
}

function getPreviewNames(items, limit = 5) {
  return items
    .map((item) => item?.productName)
    .filter(Boolean)
    .slice(0, limit);
}

function renderStatPreview(items, emptyLabel) {
  const previewNames = getPreviewNames(items);

  if (!previewNames.length) {
    return html`<div className="stat-preview-empty">${emptyLabel}</div>`;
  }

  return html`
    <div className="stat-preview-list">
      ${previewNames.map((name) => html`<div className="stat-preview-item">${name}</div>`)}
    </div>
  `;
}

function getAuthErrorMessage(statusCode, payload, fallback) {
  if (payload?.message) {
    return payload.message;
  }

  if (statusCode === 401) {
    return "Please sign in again.";
  }

  if (statusCode === 403) {
    return "Your account is not approved for this app.";
  }

  return fallback;
}

function createEmptySnapshot() {
  return {
    scannedAt: "",
    sourceUrl: "https://theabcvault.com/shop/",
    productCount: 0,
    products: [],
    metadata: {},
    storageConfigured: true,
  };
}

function App() {
  const [data, setData] = useState(null);
  const [previousSnapshot, setPreviousSnapshot] = useState(null);
  const [theme, setTheme] = useState(() => getInitialTheme());
  const [authConfig, setAuthConfig] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [session, setSession] = useState(null);
  const [appUser, setAppUser] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [magicLinkCooldownSeconds, setMagicLinkCooldownSeconds] = useState(() => getInitialMagicLinkCooldown());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
    const [statusMessage, setStatusMessage] = useState("Preparing first scan...");
    const [vaultKeyCopyMessage, setVaultKeyCopyMessage] = useState("");
    const [vaultKeyToast, setVaultKeyToast] = useState(null);
    const [celebrationBurst, setCelebrationBurst] = useState(null);
    const [lastCompletedScanAt, setLastCompletedScanAt] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [purchasableFilter, setPurchasableFilter] = useState("All");
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(AUTO_REFRESH_SECONDS);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [changeAlert, setChangeAlert] = useState(null);
  const [changeFeed, setChangeFeed] = useState(createEmptyChangeFeed());
  const [changesCollapsed, setChangesCollapsed] = useState(false);
  const [hotItems, setHotItems] = useState([]);
  const [hotStorageConfigured, setHotStorageConfigured] = useState(false);
  const [hotStorageMessage, setHotStorageMessage] = useState("");
  const [activePage, setActivePage] = useState("listings");
  const [hotFilter, setHotFilter] = useState("All");
  const [clearingListings, setClearingListings] = useState(false);
  const [profilePushoverUserKey, setProfilePushoverUserKey] = useState("");
  const [profileNotificationsEnabled, setProfileNotificationsEnabled] = useState(false);
  const [profileNotifyInitialLoad, setProfileNotifyInitialLoad] = useState(false);
  const [profileNotifyAdded, setProfileNotifyAdded] = useState(true);
  const [profileNotifyChanged, setProfileNotifyChanged] = useState(false);
  const [profileNotifyRemoved, setProfileNotifyRemoved] = useState(false);
  const [profileNotifyPurchasable, setProfileNotifyPurchasable] = useState(false);
  const [profileNotifyVaultOpen, setProfileNotifyVaultOpen] = useState(true);
  const [profileNotifyVaultClosed, setProfileNotifyVaultClosed] = useState(true);
  const [profileNotificationsCritical, setProfileNotificationsCritical] = useState(false);
  const [profileCriticalInitialLoad, setProfileCriticalInitialLoad] = useState(false);
  const [profileCriticalAdded, setProfileCriticalAdded] = useState(false);
  const [profileCriticalChanged, setProfileCriticalChanged] = useState(false);
  const [profileCriticalRemoved, setProfileCriticalRemoved] = useState(false);
  const [profileCriticalPurchasable, setProfileCriticalPurchasable] = useState(false);
  const [profileCriticalVaultOpen, setProfileCriticalVaultOpen] = useState(false);
  const [profileCriticalVaultClosed, setProfileCriticalVaultClosed] = useState(false);
  const [profileVaultKeyAutoImportEnabled, setProfileVaultKeyAutoImportEnabled] = useState(false);
  const [profileVaultKeyForwardingEmail, setProfileVaultKeyForwardingEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileTestingNotification, setProfileTestingNotification] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [pushoverConfigured, setPushoverConfigured] = useState(false);
  const [vaultEmailConfigured, setVaultEmailConfigured] = useState(false);
  const [vaultEmailForwardingAddress, setVaultEmailForwardingAddress] = useState("");
  const [vaultEmailAppUrl, setVaultEmailAppUrl] = useState(APP_BASE_URL);
  const [serverRefreshSettings, setServerRefreshSettings] = useState(null);
  const [serverRefreshEnabled, setServerRefreshEnabled] = useState(true);
  const [serverRefreshIntervalMinutes, setServerRefreshIntervalMinutes] = useState(30);
  const [serverRefreshSaving, setServerRefreshSaving] = useState(false);
  const [serverRefreshMessage, setServerRefreshMessage] = useState("");
  const loadingRef = useRef(false);
  const dataRef = useRef(null);
  const runScanRef = useRef(null);
  const loadLatestSnapshotRef = useRef(null);
  const loadServerRefreshSettingsRef = useRef(null);
  const appUserRef = useRef(null);
  const lastServerRefreshSeenRef = useRef("");
  const supabaseRef = useRef(null);
  const audioContextRef = useRef(null);
  const previousAlertSignatureRef = useRef("");
  const latestLoadRef = useRef(false);

  const applySnapshotPayload = (payload, previous) => {
    setPreviousSnapshot(previous);
    setData(payload);
    saveSnapshot(payload);
    setLastCompletedScanAt(payload.scannedAt || new Date().toISOString());
  };

  const handleLiveServerRefreshUpdate = (payload) => {
    const nextServerRefreshScannedAt = payload?.lastServerRefreshScannedAt || payload?.lastServerRefresh?.scannedAt || "";

    if (!nextServerRefreshScannedAt || nextServerRefreshScannedAt === lastServerRefreshSeenRef.current) {
      return;
    }

    lastServerRefreshSeenRef.current = nextServerRefreshScannedAt;

    const refreshFromServer = () => {
      if (loadingRef.current || latestLoadRef.current) {
        window.setTimeout(refreshFromServer, 1200);
        return;
      }

      setStatusMessage("Background server refresh detected. Loading the latest stored scan...");

      if (loadLatestSnapshotRef.current) {
        loadLatestSnapshotRef.current();
      }

      if (appUserRef.current?.role === "admin" && loadServerRefreshSettingsRef.current) {
        loadServerRefreshSettingsRef.current().catch(() => {});
      }
    };

    refreshFromServer();
  };

  const apiFetch = async (url, options = {}) => {
    const client = supabaseRef.current;

    if (!client) {
      throw new Error("Authentication is not ready yet.");
    }

    const {
      data: { session: activeSession },
    } = await client.auth.getSession();

    if (!activeSession?.access_token) {
      throw new Error("Please sign in to continue.");
    }

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${activeSession.access_token}`);

    return fetch(url, {
      ...options,
      headers,
      cache: "no-store",
    });
  };

  const applyAppUserPayload = (payload, options = {}) => {
    const { syncProfileFields = false } = options;
    const nextAppUser = payload?.appUser || null;

    setAppUser(nextAppUser);
    setPushoverConfigured(Boolean(payload?.pushoverConfigured));
    setVaultEmailConfigured(Boolean(payload?.vaultEmailConfigured));
    setVaultEmailForwardingAddress(payload?.vaultEmailForwardingAddress || "");
    setVaultEmailAppUrl(payload?.vaultEmailAppUrl || APP_BASE_URL);

    if (!syncProfileFields || !nextAppUser) {
      return;
    }

    setProfilePushoverUserKey(nextAppUser.pushoverUserKey || "");
    setProfileNotificationsEnabled(Boolean(nextAppUser.notificationsEnabled));
    setProfileNotifyInitialLoad(Boolean(nextAppUser.notifyInitialLoad));
    setProfileNotifyAdded(Boolean(nextAppUser.notifyAdded));
    setProfileNotifyChanged(Boolean(nextAppUser.notifyChanged));
    setProfileNotifyRemoved(Boolean(nextAppUser.notifyRemoved));
    setProfileNotifyPurchasable(Boolean(nextAppUser.notifyPurchasable));
    setProfileNotifyVaultOpen(Boolean(nextAppUser.notifyVaultOpen));
    setProfileNotifyVaultClosed(Boolean(nextAppUser.notifyVaultClosed));
    setProfileNotificationsCritical(Boolean(nextAppUser.notificationsCritical));
    setProfileCriticalInitialLoad(Boolean(nextAppUser.criticalInitialLoad));
    setProfileCriticalAdded(Boolean(nextAppUser.criticalAdded));
    setProfileCriticalChanged(Boolean(nextAppUser.criticalChanged));
    setProfileCriticalRemoved(Boolean(nextAppUser.criticalRemoved));
    setProfileCriticalPurchasable(Boolean(nextAppUser.criticalPurchasable));
    setProfileCriticalVaultOpen(Boolean(nextAppUser.criticalVaultOpen));
    setProfileCriticalVaultClosed(Boolean(nextAppUser.criticalVaultClosed));
    setProfileVaultKeyAutoImportEnabled(Boolean(nextAppUser.vaultKeyAutoImportEnabled));
    setProfileVaultKeyForwardingEmail(nextAppUser.vaultKeyForwardingEmail || nextAppUser.email || "");
  };

    const applyLiveVaultKeyUpdate = (payload) => {
    const nextVaultKeyCode = payload?.vaultKeyCode || "";
    const nextVaultKeyLastReceivedAt = payload?.vaultKeyLastReceivedAt || "";
    const nextVaultKeySourceFrom = payload?.vaultKeySourceFrom || "";
    const nextVaultKeySourceSubject = payload?.vaultKeySourceSubject || "";
    const currentVaultKeyCode = appUserRef.current?.vaultKeyCode || "";
    const currentVaultKeyLastReceivedAt = appUserRef.current?.vaultKeyLastReceivedAt || "";
    const didVaultKeyActuallyChange =
      nextVaultKeyCode !== currentVaultKeyCode || nextVaultKeyLastReceivedAt !== currentVaultKeyLastReceivedAt;

    setAppUser((currentAppUser) => {
      if (!currentAppUser) {
        return currentAppUser;
      }

      return {
        ...currentAppUser,
        vaultKeyCode: nextVaultKeyCode,
        vaultKeyLastReceivedAt: nextVaultKeyLastReceivedAt,
        vaultKeySourceFrom: nextVaultKeySourceFrom,
        vaultKeySourceSubject: nextVaultKeySourceSubject,
      };
    });

      if (nextVaultKeyCode && didVaultKeyActuallyChange) {
        setVaultKeyToast({
          key: nextVaultKeyCode,
          receivedAt: nextVaultKeyLastReceivedAt || new Date().toISOString(),
        });
        setCelebrationBurst({
          id: `vault-${Date.now()}`,
          type: "vault-key",
          confetti: buildCelebrationConfetti(),
        });
        playNotificationSound(audioContextRef);
      }
    };

  const loadAppUser = async () => {
    try {
      const response = await apiFetch("/api/me");
      const payload = await response.json();

      if (!response.ok) {
        throw Object.assign(new Error(getAuthErrorMessage(response.status, payload, "Access check failed.")), {
          statusCode: response.status,
        });
      }

      applyAppUserPayload(payload, { syncProfileFields: true });
      setAuthError("");
    } catch (loadError) {
      setAppUser(null);
      setAuthError(loadError.message || "Access check failed.");
    }
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileMessage("");

    try {
      const response = await apiFetch("/api/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pushoverUserKey: profilePushoverUserKey,
          notificationsEnabled: profileNotificationsEnabled,
          notifyInitialLoad: profileNotifyInitialLoad,
          notifyAdded: profileNotifyAdded,
          notifyChanged: profileNotifyChanged,
          notifyRemoved: profileNotifyRemoved,
          notifyPurchasable: profileNotifyPurchasable,
          notifyVaultOpen: profileNotifyVaultOpen,
          notifyVaultClosed: profileNotifyVaultClosed,
          notificationsCritical: profileNotificationsCritical,
          criticalInitialLoad: profileCriticalInitialLoad,
          criticalAdded: profileCriticalAdded,
          criticalChanged: profileCriticalChanged,
          criticalRemoved: profileCriticalRemoved,
          criticalPurchasable: profileCriticalPurchasable,
          criticalVaultOpen: profileCriticalVaultOpen,
          criticalVaultClosed: profileCriticalVaultClosed,
          vaultKeyAutoImportEnabled: profileVaultKeyAutoImportEnabled,
          vaultKeyForwardingEmail: profileVaultKeyForwardingEmail,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to save your profile settings.");
      }

      applyAppUserPayload(payload, { syncProfileFields: true });
      setProfileMessage(
        "Profile saved. Your alert and Vault Key settings were updated.",
      );
    } catch (saveError) {
      setProfileMessage(saveError.message || "Unable to save your profile settings.");
    } finally {
      setProfileSaving(false);
    }
  };

  const sendTestNotification = async () => {
    setProfileTestingNotification(true);
    setProfileMessage("");

    try {
      const response = await apiFetch("/api/pushover-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to send a test notification.");
      }

      if (payload.appUser) {
        applyAppUserPayload(payload, { syncProfileFields: false });
      }
      setProfileMessage(payload.message || "Test notification sent.");
    } catch (testError) {
      setProfileMessage(testError.message || "Unable to send a test notification.");
    } finally {
      setProfileTestingNotification(false);
    }
  };

  const runScan = async (mode = "manual") => {
    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError("");
    if (autoRefreshEnabled) {
      setCountdown(refreshIntervalSeconds);
    }
    setStatusMessage(
      dataRef.current
        ? mode === "auto"
          ? "Automatic refresh running..."
          : "Refreshing live shop data..."
        : "Running first live scan...",
    );

    try {
      const previous = readPreviousSnapshot();
      const response = await apiFetch(`/api/scan?refresh=1&trigger=${encodeURIComponent(mode)}`);
      const contentType = response.headers.get("content-type") || "";
      let payload;

      if (contentType.includes("application/json")) {
        payload = await response.json();
      } else {
        const text = await response.text();
        throw new Error(`Scan endpoint returned non-JSON content: ${text.slice(0, 160)}`);
      }

      if (!response.ok) {
        throw new Error(payload.message || "Scan failed.");
      }

      const currentData = dataRef.current;
      const detectedAt = payload.scannedAt || new Date().toISOString();

      const liveDiff = getServerBackedDiff(payload, currentData?.products || []);
      const totalChanges = (liveDiff.added?.length || 0) + (liveDiff.removed?.length || 0) + (liveDiff.changed?.length || 0);

      if (!currentData?.products?.length) {
        if (liveDiff.added?.length) {
          setChangeFeed((previousFeed) => ({
            ...previousFeed,
            added: mergeChangeItems(
              previousFeed.added,
              buildAddedItems(liveDiff.added, detectedAt),
              (item) => item.productId,
            ),
          }));

          setChangeAlert({
            detectedAt,
            added: liveDiff.added.length,
            removed: liveDiff.removed?.length || 0,
            changed: liveDiff.changed?.length || 0,
            totalChanges,
          });
        }
      } else {
        if (totalChanges > 0) {
          setChangeFeed((previousFeed) => ({
            added: mergeChangeItems(
              previousFeed.added,
              buildAddedItems(liveDiff.added, detectedAt),
              (item) => item.productId,
            ),
            changed: mergeChangeItems(
              previousFeed.changed,
              liveDiff.changed.map((item) => ({
                productId: item.productId || item.productName,
                productName: item.productName,
                productUrl: item.productUrl || null,
                fields: item.fields,
                detectedAt,
              })),
              (item) => item.productId,
            ),
            removed: mergeChangeItems(
              previousFeed.removed,
              liveDiff.removed.map((item) => ({
                productId: item.productId || item.productName,
                productName: item.productName,
                productUrl: item.productUrl || null,
                detectedAt,
              })),
              (item) => item.productId,
            ),
          }));
        }

        if (totalChanges > 0) {
          setChangeAlert({
            detectedAt,
            added: liveDiff.added.length,
            removed: liveDiff.removed.length,
            changed: liveDiff.changed.length,
            totalChanges,
          });
        }
      }

      applySnapshotPayload(payload, previous);
      setStatusMessage("Scan complete. Results refreshed.");
    } catch (scanError) {
      setError(scanError.message || "Scan failed.");
      setStatusMessage("Scan failed. Showing the most recent available data.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const loadLatestSnapshot = async () => {
    if (latestLoadRef.current) {
      return;
    }

    latestLoadRef.current = true;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    setStatusMessage("Loading the latest stored scan...");

    try {
      const previous = readPreviousSnapshot();
      const response = await apiFetch("/api/scan");
      const contentType = response.headers.get("content-type") || "";
      let payload;

      if (contentType.includes("application/json")) {
        payload = await response.json();
      } else {
        const text = await response.text();
        throw new Error(`Scan endpoint returned non-JSON content: ${text.slice(0, 160)}`);
      }

      if (!response.ok) {
        throw new Error(payload.message || "Unable to load the latest stored scan.");
      }

      applySnapshotPayload(payload, previous);
      if (payload?.triggerSource === "vercel-cron" && payload?.scannedAt) {
        lastServerRefreshSeenRef.current = payload.scannedAt;
      }
      setStatusMessage("Latest stored scan loaded.");
    } catch (loadError) {
      setError(loadError.message || "Unable to load the latest stored scan.");
      setStatusMessage("Unable to load the latest stored scan. Trying a fresh live scan...");
      latestLoadRef.current = false;
      loadingRef.current = false;
      setLoading(false);
      await runScan("initial-load");
      return;
    } finally {
      latestLoadRef.current = false;
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const loadHotItems = async () => {
    const response = await apiFetch("/api/hot-items");
    const contentType = response.headers.get("content-type") || "";
    let payload;

    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      const text = await response.text();
      throw new Error(`Hot item endpoint returned non-JSON content: ${text.slice(0, 160)}`);
    }

    setHotStorageConfigured(Boolean(payload.storageConfigured));
    setHotStorageMessage(payload.message || "");
    setHotItems(payload.items || []);

    if (!response.ok) {
      throw new Error(payload.message || "Unable to load hot items.");
    }
  };

  const loadServerRefreshSettings = async () => {
    const response = await apiFetch("/api/server-refresh-settings");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "Unable to load server refresh settings.");
    }

    setServerRefreshSettings(payload);
    setServerRefreshEnabled(Boolean(payload.settings?.enabled));
    setServerRefreshIntervalMinutes(Number(payload.settings?.intervalMinutes) || 30);
    lastServerRefreshSeenRef.current = payload.lastServerRefresh?.scannedAt || lastServerRefreshSeenRef.current;
    setServerRefreshMessage("");
  };

  const saveServerRefreshSettings = async () => {
    setServerRefreshSaving(true);
    setServerRefreshMessage("");

    try {
      const response = await apiFetch("/api/server-refresh-settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: serverRefreshEnabled,
          intervalMinutes: serverRefreshIntervalMinutes,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to save server refresh settings.");
      }

      setServerRefreshSettings(payload);
      setServerRefreshEnabled(Boolean(payload.settings?.enabled));
      setServerRefreshIntervalMinutes(Number(payload.settings?.intervalMinutes) || 30);
      setServerRefreshMessage("Server refresh settings saved.");
    } catch (saveError) {
      setServerRefreshMessage(saveError.message || "Unable to save server refresh settings.");
    } finally {
      setServerRefreshSaving(false);
    }
  };

  const syncHotItem = async (item, shouldBeHot) => {
    const response = await apiFetch("/api/hot-items", {
      method: shouldBeHot ? "POST" : "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        shouldBeHot
          ? {
              productId: item.productId || item.productName,
              productName: item.productName,
              category: item.category,
              bottleSizeDisplay: item.bottleSizeDisplay,
              price: item.price,
              isPurchasableFromListingPage: item.isPurchasableFromListingPage,
            }
          : {
              productId: item.productId || item.productName,
            },
        ),
    });

    const contentType = response.headers.get("content-type") || "";
    let payload;

    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      const text = await response.text();
      throw new Error(`Hot item endpoint returned non-JSON content: ${text.slice(0, 160)}`);
    }

    setHotStorageConfigured(Boolean(payload.storageConfigured));
    setHotStorageMessage(payload.message || "");
    setHotItems(payload.items || []);

    if (!response.ok) {
      throw new Error(payload.message || "Failed to update hot items.");
    }
  };

  useEffect(() => {
    let isActive = true;
    let authSubscription;

    async function initializeAuth() {
      try {
        const response = await fetch("/api/auth-config", { cache: "no-store" });
        const payload = await response.json();

        if (!isActive) {
          return;
        }

        setAuthConfig(payload);

        if (!payload.configured) {
          setAuthReady(true);
          return;
        }

        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.57.4");

        if (!isActive) {
          return;
        }

        const client = createClient(payload.supabaseUrl, payload.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });

        supabaseRef.current = client;

        const {
          data: { session: currentSession },
        } = await client.auth.getSession();

        if (!isActive) {
          return;
        }

        setSession(currentSession);
        setAuthReady(true);

        const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
          if (!isActive) {
            return;
          }

          setSession(nextSession);
          setAppUser(null);
          setAuthError("");
        });

        authSubscription = data.subscription;
      } catch (setupError) {
        if (!isActive) {
          return;
        }

        setAuthError(setupError.message || "Unable to initialize authentication.");
        setAuthReady(true);
      }
    }

    initializeAuth();

    return () => {
      isActive = false;
      authSubscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !authConfig?.configured) {
      return;
    }

    if (!session) {
      setAppUser(null);
      setData(null);
      setHotItems([]);
      setAuthCode("");
      setOtpRequested(false);
      setProfilePushoverUserKey("");
      setProfileNotificationsEnabled(false);
      setProfileNotifyInitialLoad(false);
      setProfileNotifyAdded(true);
      setProfileNotifyChanged(false);
      setProfileNotifyRemoved(false);
      setProfileNotifyPurchasable(false);
      setProfileNotifyVaultOpen(true);
      setProfileNotifyVaultClosed(true);
      setProfileNotificationsCritical(false);
      setProfileCriticalInitialLoad(false);
      setProfileCriticalAdded(false);
      setProfileCriticalChanged(false);
      setProfileCriticalRemoved(false);
      setProfileCriticalPurchasable(false);
      setProfileCriticalVaultOpen(false);
      setProfileCriticalVaultClosed(false);
      setProfileVaultKeyAutoImportEnabled(false);
      setProfileVaultKeyForwardingEmail("");
      setProfileTestingNotification(false);
      setProfileMessage("");
      setVaultEmailConfigured(false);
      setVaultEmailForwardingAddress("");
      setVaultEmailAppUrl(APP_BASE_URL);
      setServerRefreshSettings(null);
      setServerRefreshEnabled(true);
      setServerRefreshIntervalMinutes(30);
      setServerRefreshSaving(false);
      setServerRefreshMessage("");
      return;
    }

    loadAppUser();
  }, [authReady, authConfig, session]);

  useEffect(() => {
    if (!authReady || !authConfig?.configured || !session || !appUser) {
      return;
    }

    loadLatestSnapshot();
    loadHotItems().catch((loadError) => {
      setHotStorageConfigured(false);
      setHotStorageMessage(loadError.message || "Unable to load hot items.");
    });
    if (appUser.role === "admin") {
      loadServerRefreshSettings().catch((loadError) => {
        setServerRefreshMessage(loadError.message || "Unable to load server refresh settings.");
      });
    }
  }, [authReady, authConfig, session, appUser?.email, appUser?.role]);

  useEffect(() => {
    if (!authReady || !authConfig?.configured || !session) {
      return undefined;
    }

    const refreshAppUserFromServer = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await apiFetch("/api/me");
        const payload = await response.json();

        if (!response.ok) {
          return;
        }

        handleLiveServerRefreshUpdate(payload);
        applyAppUserPayload(payload, { syncProfileFields: false });
      } catch {
        // Ignore background refresh failures and keep the current session intact.
      }
    };

    const intervalId = window.setInterval(() => {
      refreshAppUserFromServer();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [authReady, authConfig, session]);

  useEffect(() => {
    if (!authReady || !authConfig?.configured || !session) {
      return undefined;
    }

    let cancelled = false;
    let reconnectTimeoutId = null;
    let activeAbortController = null;

    const connectVaultKeyStream = async () => {
      const client = supabaseRef.current;
      if (!client || cancelled) {
        return;
      }

      try {
        const {
          data: { session: activeSession },
        } = await client.auth.getSession();

        if (!activeSession?.access_token || cancelled) {
          return;
        }

        activeAbortController = new AbortController();

        const response = await fetch("/api/me-stream", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${activeSession.access_token}`,
          },
          cache: "no-store",
          signal: activeAbortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error("Unable to subscribe to live Vault key updates.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          buffer = parseSseChunks(buffer, (eventName, payload) => {
            if (eventName === "ready" || eventName === "server-refresh-updated") {
              handleLiveServerRefreshUpdate(payload);
            }

            if (eventName === "vault-key-updated") {
              handleLiveServerRefreshUpdate(payload);
              applyLiveVaultKeyUpdate(payload);
            }
          });
        }
      } catch (streamError) {
        if (cancelled || streamError?.name === "AbortError") {
          return;
        }
      } finally {
        activeAbortController = null;

        if (!cancelled) {
          reconnectTimeoutId = window.setTimeout(() => {
            connectVaultKeyStream();
          }, 1500);
        }
      }
    };

    connectVaultKeyStream();

    return () => {
      cancelled = true;
      if (reconnectTimeoutId) {
        window.clearTimeout(reconnectTimeoutId);
      }
      if (activeAbortController) {
        activeAbortController.abort();
      }
    };
  }, [authReady, authConfig, session]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage access failures and keep theme switching working.
    }
  }, [theme]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    runScanRef.current = runScan;
  }, [data, loading, changeFeed, refreshIntervalSeconds, autoRefreshEnabled]);

  useEffect(() => {
    loadLatestSnapshotRef.current = loadLatestSnapshot;
  }, [loadLatestSnapshot]);

  useEffect(() => {
    loadServerRefreshSettingsRef.current = loadServerRefreshSettings;
  }, [loadServerRefreshSettings]);

  useEffect(() => {
    appUserRef.current = appUser;
  }, [appUser]);

    useEffect(() => {
      if (!changeAlert) {
        previousAlertSignatureRef.current = "";
        return;
      }

      const signature = JSON.stringify(changeAlert);
      if (signature !== previousAlertSignatureRef.current) {
        setCelebrationBurst({
          id: `changes-${Date.now()}`,
          type: "change-alert",
          confetti: buildCelebrationConfetti(),
        });
        playNotificationSound(audioContextRef);
        previousAlertSignatureRef.current = signature;
      }
    }, [changeAlert]);

  useEffect(() => {
    if (autoRefreshEnabled) {
      setCountdown(refreshIntervalSeconds);
    }
  }, [refreshIntervalSeconds, autoRefreshEnabled]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCountdown((previousValue) => {
        if (!autoRefreshEnabled) {
          return previousValue;
        }

        if (loadingRef.current) {
          return previousValue;
        }

        if (previousValue <= 1) {
          if (runScanRef.current) {
            runScanRef.current("auto");
          }
          return refreshIntervalSeconds;
        }

        return previousValue - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [refreshIntervalSeconds, autoRefreshEnabled]);

  const categories = useMemo(() => {
    if (!data?.products) {
      return [];
    }

    return Array.from(
      new Set(
        data.products
          .map((item) => item.category)
          .filter((value) => value && value !== "Not Shown"),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }, [data]);

  const filteredProducts = useMemo(() => {
    const products = data?.products || [];

    return products.filter((item) => {
      const matchesCategory = categoryFilter === "All" || item.category === categoryFilter;
      const matchesPurchasable =
        purchasableFilter === "All" ||
        (purchasableFilter === "Yes" && item.isPurchasableFromListingPage) ||
        (purchasableFilter === "No" && !item.isPurchasableFromListingPage);
      const itemKey = item.productId || item.productName;
      const matchesHot =
        hotFilter === "All" ||
        (hotFilter === "Hot" && hotItems.some((hotItem) => hotItem.productId === itemKey)) ||
        (hotFilter === "Not Hot" && !hotItems.some((hotItem) => hotItem.productId === itemKey));

      return matchesCategory && matchesPurchasable && matchesHot;
    });
  }, [categoryFilter, purchasableFilter, hotFilter, data, hotItems]);

  const notPurchasableCount = useMemo(() => {
    return (data?.products || []).filter((item) => !item.isPurchasableFromListingPage).length;
  }, [data]);

  const hotProducts = useMemo(() => {
    return hotItems;
  }, [hotItems]);

  const notPurchasableProducts = useMemo(() => {
    return (data?.products || []).filter((item) => !item.isPurchasableFromListingPage);
  }, [data]);

  const changedOrRemovedItems = useMemo(() => {
    return [...changeFeed.changed, ...changeFeed.removed];
  }, [changeFeed]);

  const vaultStatus = data?.metadata?.vaultStatus?.status || "unknown";
  const vaultStatusDisplay = getVaultStatusDisplay(vaultStatus);
  const vaultStatusCheckedAt = data?.metadata?.vaultStatus?.checkedAt || data?.scannedAt || "";

  const changeCounts = useMemo(
    () => ({
      added: changeFeed.added.length,
      changed: changeFeed.changed.length,
      removed: changeFeed.removed.length,
    }),
    [changeFeed],
  );

  const dismissChangeItem = (section, productId) => {
    setChangeFeed((previousFeed) => ({
      ...previousFeed,
      [section]: previousFeed[section].filter((item) => item.productId !== productId),
    }));
  };

  const clearChangeSection = (section) => {
    setChangeFeed((previousFeed) => ({
      ...previousFeed,
      [section]: [],
    }));
  };

  const clearAllChanges = () => {
    setChangeFeed(createEmptyChangeFeed());
    setChangeAlert(null);
  };

  const toggleHotItem = (item) => {
    const itemKey = item.productId || item.productName;
    const alreadyHot = hotItems.some((hotItem) => hotItem.productId === itemKey);

    syncHotItem(item, !alreadyHot).catch((syncError) => {
      setError(syncError.message || "Failed to update hot items.");
    });
  };

  const openChanges = () => {
    const target = document.getElementById("what-changed");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const clearStoredListings = async () => {
    if (clearingListings) {
      return;
    }

    const confirmed = window.confirm(
      "Clear all stored listings from the database for testing? The next background or manual scan can add them back.",
    );

    if (!confirmed) {
      return;
    }

    setClearingListings(true);
    setError("");

    try {
      const response = await apiFetch("/api/scan", {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Failed to clear stored listings.");
      }

      window.localStorage.removeItem(STORAGE_KEY);
      setPreviousSnapshot(null);
      setData(createEmptySnapshot());
      setLastCompletedScanAt("");
      setChangeFeed(createEmptyChangeFeed());
      setChangeAlert(null);
      setStatusMessage(payload.message || "Stored listings cleared.");
    } catch (clearError) {
      setError(clearError.message || "Failed to clear stored listings.");
    } finally {
      setClearingListings(false);
    }
  };

  const copyVaultKey = async () => {
    const key = (appUser?.vaultKeyCode || "").trim();
    if (!key) {
      setVaultKeyCopyMessage("No Vault key is stored yet.");
      return;
    }

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(key);
        setVaultKeyCopyMessage("Vault key copied.");
        return;
      }

      const copied = fallbackCopyText(key);
      setVaultKeyCopyMessage(copied ? "Vault key copied." : "Unable to copy the Vault key on this device.");
    } catch {
      const copied = fallbackCopyText(key);
      setVaultKeyCopyMessage(copied ? "Vault key copied." : "Unable to copy the Vault key on this device.");
    }
  };

  const sendMagicLink = async (event) => {
    event.preventDefault();

    if (!supabaseRef.current) {
      setAuthError("Authentication is not ready yet.");
      return;
    }

    if (magicLinkCooldownSeconds > 0) {
      setAuthError(`Please wait ${magicLinkCooldownSeconds}s before requesting another one-time code.`);
      return;
    }

    const email = authEmail.trim();
    if (!email) {
      setAuthError("Enter an email address to continue.");
      return;
    }

    setSendingOtp(true);
    setAuthError("");

    try {
      const prepareResponse = await fetch("/api/request-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ email }),
      });
      const preparePayload = await prepareResponse.json().catch(() => ({}));

      if (!prepareResponse.ok) {
        throw new Error(preparePayload.message || "Unable to prepare your approved account for OTP sign-in.");
      }

      const { error: signInError } = await supabaseRef.current.auth.signInWithOtp({
        email,
        options: {
            shouldCreateUser: false,
        },
      });

      if (signInError) {
        throw signInError;
      }

      try {
        const nextAllowedAt = Date.now() + MAGIC_LINK_COOLDOWN_SECONDS * 1000;
        window.localStorage.setItem(MAGIC_LINK_COOLDOWN_KEY, String(nextAllowedAt));
        setMagicLinkCooldownSeconds(MAGIC_LINK_COOLDOWN_SECONDS);
      } catch {
        // Ignore storage issues and still allow sign-in.
      }

      setOtpRequested(true);
      setAuthCode("");
      setAuthError(`One-time code sent to ${email}. Enter the code from your email to sign in.`);
      } catch (signInError) {
        const message = signInError.message || "Unable to send the one-time code.";
        if (message.toLowerCase().includes("rate limit")) {
        try {
          const nextAllowedAt = Date.now() + MAGIC_LINK_COOLDOWN_SECONDS * 1000;
          window.localStorage.setItem(MAGIC_LINK_COOLDOWN_KEY, String(nextAllowedAt));
          setMagicLinkCooldownSeconds(MAGIC_LINK_COOLDOWN_SECONDS);
        } catch {
          // Ignore storage issues and still surface the error.
          }
          setAuthError("Too many code requests were sent. Please wait about a minute and try again.");
        } else if (message.toLowerCase().includes("signups not allowed for otp")) {
          setAuthError(
            "This email is approved in the app, but Supabase is currently blocking first-time OTP sign-ins. Enable Email signups in Supabase Auth, or add a Supabase service role key so approved users can be provisioned automatically.",
          );
        } else {
          setAuthError(message);
        }
    } finally {
      setSendingOtp(false);
    }
  };

  const verifyEmailCode = async (event) => {
    event.preventDefault();

    if (!supabaseRef.current) {
      setAuthError("Authentication is not ready yet.");
      return;
    }

    const email = authEmail.trim();
    const code = authCode.trim();

    if (!email) {
      setAuthError("Enter your email address first.");
      return;
    }

    if (!code) {
      setAuthError("Enter the one-time code from your email.");
      return;
    }

    setVerifyingOtp(true);
    setAuthError("");

    try {
      const { error: verifyError } = await supabaseRef.current.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });

      if (verifyError) {
        throw verifyError;
      }

      setAuthCode("");
      setOtpRequested(false);
      setAuthError("");
    } catch (verifyError) {
      setAuthError(verifyError.message || "Unable to verify the one-time code.");
    } finally {
      setVerifyingOtp(false);
    }
  };

  useEffect(() => {
    if (magicLinkCooldownSeconds <= 0) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setMagicLinkCooldownSeconds((currentValue) => {
        if (currentValue <= 1) {
          try {
            window.localStorage.removeItem(MAGIC_LINK_COOLDOWN_KEY);
          } catch {
            // Ignore storage failures.
          }
          return 0;
        }

        return currentValue - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [magicLinkCooldownSeconds]);

  useEffect(() => {
    if (!vaultKeyCopyMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setVaultKeyCopyMessage("");
    }, 2400);

    return () => window.clearTimeout(timeoutId);
  }, [vaultKeyCopyMessage]);

  useEffect(() => {
    if (!vaultKeyToast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setVaultKeyToast(null);
    }, 7000);

    return () => window.clearTimeout(timeoutId);
  }, [vaultKeyToast]);

  useEffect(() => {
    if (!celebrationBurst) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCelebrationBurst(null);
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [celebrationBurst]);

  const signOut = async () => {
    if (!supabaseRef.current) {
      return;
    }

    await supabaseRef.current.auth.signOut();
    setAppUser(null);
    setSession(null);
    setData(null);
    setHotItems([]);
  };

  if (!authReady) {
    return html`
      <main className="app-shell">
        <section className="hero">
          <div className="hero-panel auth-panel">
            <div className="eyebrow">Secure Access</div>
            <h1>Preparing your secure Toyota-themed workspace</h1>
            <p className="hero-copy">Checking authentication and access rules before loading the live scanner.</p>
          </div>
        </section>
      </main>
    `;
  }

  if (!authConfig?.configured) {
    return html`
      <main className="app-shell">
        <section className="hero">
          <div className="hero-panel auth-panel">
            <div className="eyebrow">Auth Setup Needed</div>
            <h1>Supabase Auth is not connected yet</h1>
            <p className="hero-copy">
              Add
              <code>SUPABASE_URL</code>,
              <code>SUPABASE_ANON_KEY</code>,
              and at least one email in
              <code>ADMIN_EMAILS</code>
              to finish invite-only access.
            </p>
            ${authError ? html`<div className="error-state">${authError}</div>` : null}
          </div>
        </section>
      </main>
    `;
  }

  if (!session) {
    return html`
      <main className="app-shell">
        <section className="hero">
          <div className="hero-panel auth-panel" role="region" aria-labelledby="sign-in-title">
            <div className="eyebrow">Invite-Only Access</div>
            <h1 id="sign-in-title">Sign in to open the scanner</h1>
            <p className="hero-copy">
              Use your approved email address and we will send a one-time passcode. Only emails on the allowlist can enter
              the app.
            </p>
            <form className="auth-form" onSubmit=${sendMagicLink}>
              <label className="auth-field">
                <span className="filter-label">Email</span>
                <input
                  className="auth-input"
                  type="email"
                  value=${authEmail}
                  onInput=${(event) => setAuthEmail(event.target.value)}
                  placeholder="you@example.com"
                  autocomplete="email"
                  inputMode="email"
                  aria-required="true"
                  aria-invalid=${Boolean(authError)}
                  enterKeyHint="send"
                />
              </label>
              <button className="button button-primary" type="submit" disabled=${sendingOtp || magicLinkCooldownSeconds > 0}>
                ${sendingOtp
                  ? "Sending code..."
                  : magicLinkCooldownSeconds > 0
                  ? `Try again in ${magicLinkCooldownSeconds}s`
                  : otpRequested
                  ? "Resend code"
                  : "Send code"}
              </button>
            </form>
            ${otpRequested
              ? html`
                  <form className="auth-form" onSubmit=${verifyEmailCode}>
                    <label className="auth-field">
                      <span className="filter-label">One-time code</span>
                      <input
                        className="auth-input"
                        type="text"
                        inputmode="numeric"
                        value=${authCode}
                        onInput=${(event) => setAuthCode(event.target.value)}
                        placeholder="123456"
                        autocomplete="one-time-code"
                        aria-required="true"
                        aria-invalid=${Boolean(authError)}
                        enterKeyHint="done"
                      />
                    </label>
                    <button className="button button-primary" type="submit" disabled=${verifyingOtp}>
                      ${verifyingOtp ? "Verifying code..." : "Verify code"}
                    </button>
                  </form>
                `
              : null}
            ${authError ? html`<div className="auth-note" role="status" aria-live="polite">${authError}</div>` : null}
          </div>
        </section>
      </main>
    `;
  }

  if (!appUser) {
    return html`
      <main className="app-shell">
        <section className="hero">
          <div className="hero-panel auth-panel">
            <div className="eyebrow">Checking Access</div>
            <h1>Validating your access</h1>
            <p className="hero-copy">
              Your Supabase session is active. We are now checking whether your email is approved for this app.
            </p>
            ${authError ? html`<div className="error-state">${authError}</div>` : null}
            <button className="button button-secondary" onClick=${signOut}>Sign out</button>
          </div>
        </section>
      </main>
    `;
  }

  return html`
      <main className="app-shell" aria-busy=${loading}>
        <a className="skip-link" href="#current-listings">Skip to current listings</a>
        ${celebrationBurst || vaultKeyToast || changeAlert
          ? html`
              <section className="notification-overlay" aria-live="assertive" aria-atomic="true">
                ${celebrationBurst
                  ? html`
                      <div className="celebration-layer" aria-hidden="true" key=${celebrationBurst.id}>
                        <div className="celebration-confetti">
                          ${celebrationBurst.confetti.map(
                            (piece, index) => html`
                              <span
                                key=${piece.id}
                                className=${`confetti-piece confetti-tone-${(index % 4) + 1}`}
                                style=${{
                                  left: piece.left,
                                  animationDelay: piece.delay,
                                  animationDuration: piece.duration,
                                  "--confetti-rotation": piece.rotation,
                                }}
                              ></span>
                            `,
                          )}
                        </div>
                      </div>
                    `
                  : null}
                <div className="notification-overlay-stage">
                  ${celebrationBurst
                    ? html`
                        <div className="bourbon-cheers" aria-hidden="true">
                          <div className="glencairn glencairn-left">
                            <div className="glencairn-bowl">
                              <div className="glencairn-bourbon"></div>
                              <div className="glencairn-shine"></div>
                            </div>
                            <div className="glencairn-stem"></div>
                            <div className="glencairn-base"></div>
                          </div>
                          <div className="cheers-spark"></div>
                          <div className="glencairn glencairn-right">
                            <div className="glencairn-bowl">
                              <div className="glencairn-bourbon"></div>
                              <div className="glencairn-shine"></div>
                            </div>
                            <div className="glencairn-stem"></div>
                            <div className="glencairn-base"></div>
                          </div>
                        </div>
                      `
                    : null}
                  <div className="notification-spotlight-stack">
                    ${vaultKeyToast
                      ? html`
                          <div className="vault-key-toast" role="alert">
                            <div className="vault-key-toast-copy">
                              <div className="vault-key-toast-title">New Vault key received</div>
                              <div className="vault-key-toast-body">
                                Vault key ${vaultKeyToast.key} was imported at ${formatScanTime(vaultKeyToast.receivedAt)}.
                              </div>
                            </div>
                            <button
                              className="change-toast-close"
                              type="button"
                              onClick=${() => setVaultKeyToast(null)}
                              aria-label="Close Vault key alert"
                            >
                              Close
                            </button>
                          </div>
                        `
                      : null}
                    ${changeAlert
                      ? html`
                          <div className="change-toast" role="alert">
                            <button className="change-toast-close" type="button" onClick=${() => setChangeAlert(null)} aria-label="Close alert">
                              Close
                            </button>
                            <div className="change-toast-title">Changes detected in the latest scan</div>
                            <div className="change-toast-copy">
                              ${changeAlert.totalChanges} update${changeAlert.totalChanges === 1 ? "" : "s"} found:
                              ${changeAlert.added} added, ${changeAlert.changed} changed, ${changeAlert.removed} removed.
                            </div>
                            <div className="change-toast-actions">
                              <button className="button button-secondary" type="button" onClick=${openChanges}>View changes</button>
                              <button className="button button-primary" type="button" onClick=${clearAllChanges}>Mark as read</button>
                            </div>
                          </div>
                        `
                      : null}
                  </div>
                </div>
              </section>
            `
          : null}
      <section className="hero" aria-label="Scanner overview">
        <div className="hero-panel" role="region" aria-labelledby="dashboard-title">
          <div className="hero-topline">
            <h1 id="dashboard-title">ABC Vault listing tracker</h1>
            <div className="hero-status-stack">
              <div
                className=${`vault-status-banner vault-status-${vaultStatus}`}
                role="status"
                aria-live="polite"
                aria-label=${`Vault status ${vaultStatusDisplay.label}. Last checked ${formatScanTime(vaultStatusCheckedAt)}`}
              >
                <span className="vault-status-icon" aria-hidden="true">${vaultStatusDisplay.icon}</span>
                <div className="vault-status-content">
                  <span className="vault-status-label">Vault ${vaultStatusDisplay.label}</span>
                  <span className="vault-status-time">Checked ${formatScanTime(vaultStatusCheckedAt)}</span>
                </div>
              </div>
              <div className=${`scan-status ${loading ? "scan-status-running" : "scan-status-idle"} scan-status-compact`} role="status" aria-live="polite">
                <span className="scan-status-dot"></span>
                <span>${statusMessage}</span>
              </div>
            </div>
          </div>
          <div className="hero-actions">
            <button className="button button-primary" type="button" onClick=${runScan} disabled=${loading}>
              ${loading ? "Scanning live HTML..." : "Run fresh scan"}
            </button>
            <button
              className=${`button button-secondary ${activePage === "listings" ? "page-nav-active" : ""}`}
              type="button"
              onClick=${() => setActivePage("listings")}
            >
              Listings
            </button>
            <button
              className=${`button button-secondary ${activePage === "profile" ? "page-nav-active" : ""}`}
              type="button"
              onClick=${() => setActivePage("profile")}
            >
              Profile
            </button>
            ${appUser.role === "admin"
              ? html`
                  <button
                    className=${`button button-secondary ${activePage === "settings" || activePage === "server-refresh" || activePage === "hot-manager" ? "page-nav-active" : ""}`}
                    type="button"
                    onClick=${() => setActivePage("settings")}
                  >
                    Settings
                  </button>
                `
              : null}
            <a className="button button-secondary" href="https://theabcvault.com/shop/" target="_blank" rel="noreferrer">
              Open source page
            </a>
          </div>
          ${activePage === "listings"
            ? html`
                <div className="scan-meta">
                  <div className="countdown-row" aria-live="polite">
                    <strong>Next auto refresh:</strong>
                    <span>
                      ${!autoRefreshEnabled ? "Paused" : loading ? "Waiting for current scan..." : `${countdown}s`}
                    </span>
                  </div>
                  <div className="refresh-controls-row">
                    <div className="refresh-rate-row">
                      <strong>Refresh rate:</strong>
                      <div className="refresh-rate-group" role="group" aria-label="Auto refresh rate">
                        ${REFRESH_RATE_OPTIONS.map(
                          (seconds) => html`
                            <button
                              className=${`button button-secondary button-small ${refreshIntervalSeconds === seconds ? "refresh-rate-active" : ""}`}
                              type="button"
                              onClick=${() => setRefreshIntervalSeconds(seconds)}
                              aria-pressed=${refreshIntervalSeconds === seconds}
                            >
                              ${seconds}s
                            </button>
                          `,
                        )}
                      </div>
                    </div>
                    <div className="refresh-rate-row">
                      <strong>Browser auto refresh:</strong>
                      <div className="refresh-rate-group" role="group" aria-label="Browser auto refresh controls">
                        <button
                          className=${`button button-secondary button-small ${autoRefreshEnabled ? "refresh-rate-active" : ""}`}
                          type="button"
                          onClick=${() => {
                            setAutoRefreshEnabled(true);
                            setCountdown(refreshIntervalSeconds);
                          }}
                          aria-pressed=${autoRefreshEnabled}
                        >
                          Start
                        </button>
                        <button
                          className=${`button button-secondary button-small ${!autoRefreshEnabled ? "refresh-rate-active" : ""}`}
                          type="button"
                          onClick=${() => setAutoRefreshEnabled(false)}
                          aria-pressed=${!autoRefreshEnabled}
                        >
                          Stop
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="scan-meta-grid" role="list" aria-label="Scanner summary">
                    ${renderMetaCard(
                      "Current scan",
                      formatScanTime(data?.scannedAt),
                      html`
                        <div>Previous: ${formatScanTime(previousSnapshot?.scannedAt)}</div>
                        <div>
                          Server: ${
                            appUser?.role === "admin"
                              ? getNextServerRefreshLabel(
                                  serverRefreshSettings,
                                  serverRefreshEnabled,
                                  serverRefreshIntervalMinutes,
                                )
                              : "Admin only"
                          }
                        </div>
                      `,
                    )}
                    ${renderMetaCard(
                      "Latest Vault key",
                      appUser?.vaultKeyCode || "Not stored yet",
                      html`
                        <div className="vault-key-row">
                          <span>${appUser?.vaultKeyLastReceivedAt ? formatScanTime(appUser.vaultKeyLastReceivedAt) : "Not received yet"}</span>
                          <button
                            className="button button-secondary button-small"
                            type="button"
                            onClick=${copyVaultKey}
                            disabled=${!appUser?.vaultKeyCode}
                            aria-label="Copy latest Vault key"
                          >
                            Copy
                          </button>
                        </div>
                      `,
                    )}
                  </div>
                  ${vaultKeyCopyMessage ? html`<div className="scan-status">${vaultKeyCopyMessage}</div>` : null}
                  ${hotStorageMessage ? html`<div><strong>Hot item note:</strong> ${hotStorageMessage}</div>` : null}
                </div>
              `
            : null}
        </div>

        ${activePage === "listings"
          ? html`
              <div className="stats-grid" role="list" aria-label="Scanner totals">
                <div className="stat-card" role="listitem">
                  <div className="stat-number">${data?.productCount ?? "0"}</div>
                  <div className="stat-label">Products currently listed</div>
                  ${renderStatPreview(data?.products || [], "No products in the current snapshot.")}
                </div>
                <div className="stat-card" role="listitem">
                  <div className="stat-number">${hotItems.length}</div>
                  <div className="stat-label">Hot items</div>
                  ${renderStatPreview(hotProducts, "No hot items yet.")}
                </div>
                <div className="stat-card" role="listitem">
                  <div className="stat-number">${notPurchasableCount}</div>
                  <div className="stat-label">Not purchasable on listing page</div>
                  ${renderStatPreview(notPurchasableProducts, "Everything is purchasable right now.")}
                </div>
                <div className="stat-card" role="listitem">
                  <div className="stat-number">${changeCounts.added}</div>
                  <div className="stat-label">Unread added items</div>
                  ${renderStatPreview(changeFeed.added, "No unread added items.")}
                </div>
              </div>
            `
          : null}
      </section>

      ${error ? html`<section className="surface"><div className="error-state" role="alert">${error}</div></section>` : null}

      ${activePage === "listings"
        ? html`
            <section className="surface changes-surface" id="what-changed" role="region" aria-labelledby="what-changed-title">
              <div className="surface-header">
                <div>
                  <h2 className="section-title" id="what-changed-title">What Changed</h2>
                  <p className="section-note">New items stay here until the user dismisses them individually or clears a section.</p>
                </div>
                <div className="changes-actions">
                  <button className="button button-secondary" type="button" onClick=${() => setChangesCollapsed((value) => !value)} aria-expanded=${!changesCollapsed} aria-controls="what-changed-panels">
                    ${changesCollapsed ? "Expand" : "Collapse"}
                  </button>
                  <button className="button button-secondary" type="button" onClick=${clearAllChanges}>Mark all as read</button>
                </div>
              </div>
              ${changesCollapsed
                ? html`<div className="empty-state">Change inbox collapsed. Expand to review added, changed, and removed items.</div>`
                : changeCounts.added || changeCounts.changed || changeCounts.removed
                  ? html`
                      <div className="diff-columns" id="what-changed-panels">
                        <div className="diff-column">
                          <div className="change-column-header">
                            <h3>Added</h3>
                            <button className="text-button" type="button" onClick=${() => clearChangeSection("added")}>Clear all</button>
                          </div>
                          ${changeFeed.added.length
                            ? html`
                                <ul className="plain-list plain-list-tight">
                                  ${changeFeed.added.map(
                                    (item) => html`
                                      <li className="change-item-row">
                                        <div className="change-item-content">
                                          <strong>${renderLinkedProductName(item)}</strong>
                                          <div className="change-item-meta">${formatScanTime(item.detectedAt)}</div>
                                        </div>
                                        <button
                                          className="text-button"
                                          type="button"
                                          onClick=${() => dismissChangeItem("added", item.productId)}
                                        >
                                          Mark read
                                        </button>
                                      </li>
                                    `,
                                  )}
                                </ul>
                              `
                            : html`<div className="empty-state">No unread added listings.</div>`}
                        </div>
                        <div className="diff-column">
                          <div className="change-column-header">
                            <h3>Changed</h3>
                            <button className="text-button" type="button" onClick=${() => clearChangeSection("changed")}>Clear all</button>
                          </div>
                          ${changeFeed.changed.length
                            ? html`
                                <ul className="plain-list plain-list-tight">
                                  ${changeFeed.changed.map(
                                    (item) => html`
                                      <li className="change-item-row">
                                        <div className="change-item-content">
                                          <strong>${renderLinkedProductName(item)}</strong>
                                          <div className="change-item-meta">
                                            ${formatScanTime(item.detectedAt)} | ${summarizeChangedFields(item.fields)}
                                          </div>
                                        </div>
                                        <button
                                          className="text-button"
                                          type="button"
                                          onClick=${() => dismissChangeItem("changed", item.productId)}
                                        >
                                          Mark read
                                        </button>
                                      </li>
                                    `,
                                  )}
                                </ul>
                              `
                            : html`<div className="empty-state">No unread field-level changes.</div>`}
                        </div>
                        <div className="diff-column">
                          <div className="change-column-header">
                            <h3>Removed</h3>
                            <button className="text-button" type="button" onClick=${() => clearChangeSection("removed")}>Clear all</button>
                          </div>
                          ${changeFeed.removed.length
                            ? html`
                                <ul className="plain-list plain-list-tight">
                                  ${changeFeed.removed.map(
                                    (item) => html`
                                      <li className="change-item-row">
                                        <div className="change-item-content">
                                          <strong>${renderLinkedProductName(item)}</strong>
                                          <div className="change-item-meta">${formatScanTime(item.detectedAt)}</div>
                                        </div>
                                        <button
                                          className="text-button"
                                          type="button"
                                          onClick=${() => dismissChangeItem("removed", item.productId)}
                                        >
                                          Mark read
                                        </button>
                                      </li>
                                    `,
                                  )}
                                </ul>
                              `
                            : html`<div className="empty-state">No unread removals.</div>`}
                        </div>
                      </div>
                    `
                  : html`<div className="empty-state">Changes will appear here after later scans detect something new.</div>`}
            </section>
          `
        : null}

      ${activePage === "profile"
        ? html`
            <section className="surface manager-surface">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">Profile</h2>
                  <p className="section-note">Manage your account preferences and choose how the app looks.</p>
                </div>
                <button className="button button-secondary" onClick=${() => setActivePage("listings")}>
                  Back to listings
                </button>
              </div>
              <div className="profile-grid">
                <article className="manager-card">
                  <div className="manager-kicker">Account</div>
                  <h3 className="manager-title">${appUser.email}</h3>
                  <div className="manager-meta">
                    <span>Role: ${appUser.role}</span>
                    <span>Theme: ${theme === "dark" ? "Dark" : "Light"}</span>
                    <span>Pushover: ${appUser.notificationsEnabled ? "Enabled" : "Disabled"}</span>
                    <span>Vault Key: ${appUser?.vaultKeyCode ? "Saved" : "Not saved yet"}</span>
                  </div>
                </article>
                <article className="manager-card">
                  <div className="manager-kicker">Appearance</div>
                  <h3 className="manager-title">Theme settings</h3>
                  <p className="section-note">Choose the color mode that feels best for your workspace.</p>
                  <div className="profile-theme-options">
                    <button
                      className=${`button button-secondary profile-theme-button ${theme === "light" ? "profile-theme-active" : ""}`}
                      onClick=${() => setTheme("light")}
                    >
                      Light mode
                    </button>
                    <button
                      className=${`button button-secondary profile-theme-button ${theme === "dark" ? "profile-theme-active" : ""}`}
                      onClick=${() => setTheme("dark")}
                    >
                      Dark mode
                    </button>
                  </div>
                </article>
                <article className="manager-card">
                  <div className="manager-kicker">Vault Access</div>
                  <h3 className="manager-title">Vault Key email import</h3>
                  <p className="section-note">
                    Forward your ABC Vault invitation email through your inbound email service, and the app will try to
                    capture the Vault Key code automatically into your profile.
                  </p>
                  <label className="auth-field">
                    <span className="filter-label">Forwarded from email</span>
                    <input
                      className="auth-input"
                      type="email"
                      value=${profileVaultKeyForwardingEmail}
                      onInput=${(event) => setProfileVaultKeyForwardingEmail(event.target.value)}
                      placeholder=${appUser.email}
                      autocomplete="email"
                    />
                  </label>
                  <div className="profile-toggle-row">
                    <span>
                      <strong>Enable automatic Vault Key import</strong>
                      <small>
                        When on, the inbound email endpoint will save the latest Vault Key code for the forwarded email
                        address above.
                      </small>
                    </span>
                    <button
                      type="button"
                      className=${`profile-toggle ${profileVaultKeyAutoImportEnabled ? "profile-toggle-on" : ""}`}
                      aria-pressed=${profileVaultKeyAutoImportEnabled}
                      onClick=${() => setProfileVaultKeyAutoImportEnabled((currentValue) => !currentValue)}
                    >
                      <span className="profile-toggle-knob"></span>
                    </button>
                  </div>
                  <div className="manager-meta manager-meta-stack">
                    <span>Latest Vault Key: ${appUser?.vaultKeyCode || "No code stored yet"}</span>
                    <span>
                      Last imported:
                      ${appUser?.vaultKeyLastReceivedAt ? formatScanTime(appUser.vaultKeyLastReceivedAt) : "No email processed yet"}
                    </span>
                    <span>Source sender: ${appUser?.vaultKeySourceFrom || "Not captured yet"}</span>
                    <span>Source subject: ${appUser?.vaultKeySourceSubject || "Not captured yet"}</span>
                    <span>Preview: ${appUser?.vaultKeySourcePreview || "No inbound email preview stored yet."}</span>
                  </div>
                  <div className="manager-meta manager-meta-stack">
                    <span>Inbound endpoint: <code>/api/vault-key-email</code></span>
                    <span>
                      Forwarding address:
                      ${vaultEmailForwardingAddress ? html`<code>${vaultEmailForwardingAddress}</code>` : "Not configured yet"}
                    </span>
                    <span>
                      App URL used after sign-in:
                      <a className="product-link" href=${vaultEmailAppUrl} target="_blank" rel="noreferrer">
                        ${vaultEmailAppUrl}
                      </a>
                    </span>
                  </div>
                  ${!vaultEmailConfigured
                    ? html`
                        <div className="empty-state">
                          Add <code>VAULT_EMAIL_WEBHOOK_SECRET</code> on the server to enable secure inbound email
                          processing. If you are using a forwarding provider, set
                          <code>VAULT_EMAIL_FORWARDING_ADDRESS</code>
                          too so the setup instructions show the right destination.
                        </div>
                      `
                    : null}
                </article>
                <article className="manager-card">
                  <div className="manager-kicker">Alerts</div>
                  <h3 className="manager-title">Pushover notifications</h3>
                  <p className="section-note">
                    Save your personal Pushover User Key here, then turn alerts on if you want a push notification
                    whenever newly added items are detected.
                  </p>
                  <label className="auth-field">
                    <span className="filter-label">Pushover User Key</span>
                    <input
                      className="auth-input"
                      type="text"
                      value=${profilePushoverUserKey}
                      onInput=${(event) => setProfilePushoverUserKey(event.target.value)}
                      placeholder="uQiRzpo4DXghDmr9QzzfQu27cmVRsG"
                      autocomplete="off"
                    />
                  </label>
                  <label className="profile-toggle-row">
                    <span>
                      <strong>Enable Pushover notifications</strong>
                      <small>Turn all Pushover notifications on or off for your account.</small>
                    </span>
                    <button
                      type="button"
                      className=${`profile-toggle ${profileNotificationsEnabled ? "profile-toggle-on" : ""}`}
                      aria-pressed=${profileNotificationsEnabled}
                      onClick=${() => setProfileNotificationsEnabled((currentValue) => !currentValue)}
                    >
                      <span className="profile-toggle-knob"></span>
                    </button>
                  </label>
                  <div className="profile-alert-grid">
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Initial load</strong>
                        <small>Notify when the first stored scan after a reset loads items.</small>
                      </span>
                      <div className="profile-toggle-pair">
                        <button
                          type="button"
                          className=${`profile-toggle ${profileNotifyInitialLoad ? "profile-toggle-on" : ""}`}
                          aria-pressed=${profileNotifyInitialLoad}
                          onClick=${() => setProfileNotifyInitialLoad((currentValue) => !currentValue)}
                        >
                          <span className="profile-toggle-knob"></span>
                        </button>
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${profileCriticalInitialLoad ? "profile-critical-active" : ""}`}
                          onClick=${(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileCriticalInitialLoad((currentValue) => !currentValue);
                          }}
                        >
                          Critical
                        </button>
                      </div>
                    </div>
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Added after load</strong>
                        <small>Notify when new items appear after the initial stored load.</small>
                      </span>
                      <div className="profile-toggle-pair">
                        <button
                          type="button"
                          className=${`profile-toggle ${profileNotifyAdded ? "profile-toggle-on" : ""}`}
                          aria-pressed=${profileNotifyAdded}
                          onClick=${() => setProfileNotifyAdded((currentValue) => !currentValue)}
                        >
                          <span className="profile-toggle-knob"></span>
                        </button>
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${profileCriticalAdded ? "profile-critical-active" : ""}`}
                          onClick=${(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileCriticalAdded((currentValue) => !currentValue);
                          }}
                        >
                          Critical
                        </button>
                      </div>
                    </div>
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Changed</strong>
                        <small>Notify when existing items change details like price or badges.</small>
                      </span>
                      <div className="profile-toggle-pair">
                        <button
                          type="button"
                          className=${`profile-toggle ${profileNotifyChanged ? "profile-toggle-on" : ""}`}
                          aria-pressed=${profileNotifyChanged}
                          onClick=${() => setProfileNotifyChanged((currentValue) => !currentValue)}
                        >
                          <span className="profile-toggle-knob"></span>
                        </button>
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${profileCriticalChanged ? "profile-critical-active" : ""}`}
                          onClick=${(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileCriticalChanged((currentValue) => !currentValue);
                          }}
                        >
                          Critical
                        </button>
                      </div>
                    </div>
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Removed</strong>
                        <small>Notify when items disappear from the listing.</small>
                      </span>
                      <div className="profile-toggle-pair">
                        <button
                          type="button"
                          className=${`profile-toggle ${profileNotifyRemoved ? "profile-toggle-on" : ""}`}
                          aria-pressed=${profileNotifyRemoved}
                          onClick=${() => setProfileNotifyRemoved((currentValue) => !currentValue)}
                        >
                          <span className="profile-toggle-knob"></span>
                        </button>
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${profileCriticalRemoved ? "profile-critical-active" : ""}`}
                          onClick=${(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileCriticalRemoved((currentValue) => !currentValue);
                          }}
                        >
                          Critical
                        </button>
                      </div>
                    </div>
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Purchasable again</strong>
                        <small>Notify when an item becomes purchasable from the listing page.</small>
                      </span>
                      <div className="profile-toggle-pair">
                        <button
                          type="button"
                          className=${`profile-toggle ${profileNotifyPurchasable ? "profile-toggle-on" : ""}`}
                          aria-pressed=${profileNotifyPurchasable}
                          onClick=${() => setProfileNotifyPurchasable((currentValue) => !currentValue)}
                        >
                          <span className="profile-toggle-knob"></span>
                        </button>
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${profileCriticalPurchasable ? "profile-critical-active" : ""}`}
                          onClick=${(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileCriticalPurchasable((currentValue) => !currentValue);
                          }}
                        >
                          Critical
                        </button>
                      </div>
                    </div>
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Vault invite</strong>
                        <small>Notify when CloudMailin reaches the Vault invite email endpoint so you can jump straight into the Vault.</small>
                      </span>
                      <div className="profile-toggle-pair">
                        <button
                          type="button"
                          className=${`profile-toggle ${profileNotifyVaultOpen ? "profile-toggle-on" : ""}`}
                          aria-pressed=${profileNotifyVaultOpen}
                          onClick=${() => setProfileNotifyVaultOpen((currentValue) => !currentValue)}
                        >
                          <span className="profile-toggle-knob"></span>
                        </button>
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${profileCriticalVaultOpen ? "profile-critical-active" : ""}`}
                          onClick=${(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileCriticalVaultOpen((currentValue) => !currentValue);
                          }}
                        >
                          Critical
                        </button>
                      </div>
                    </div>
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Vault opened</strong>
                        <small>Notify when the live Vault homepage changes from Closed to Open.</small>
                      </span>
                      <div className="profile-toggle-pair">
                        <button
                          type="button"
                          className=${`profile-toggle ${profileNotifyVaultClosed ? "profile-toggle-on" : ""}`}
                          aria-pressed=${profileNotifyVaultClosed}
                          onClick=${() => setProfileNotifyVaultClosed((currentValue) => !currentValue)}
                        >
                          <span className="profile-toggle-knob"></span>
                        </button>
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${profileCriticalVaultClosed ? "profile-critical-active" : ""}`}
                          onClick=${(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileCriticalVaultClosed((currentValue) => !currentValue);
                          }}
                        >
                          Critical
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="manager-meta">
                    <span>Server token: ${pushoverConfigured ? "Configured" : "Missing"}</span>
                    <span>Your key: ${profilePushoverUserKey.trim() ? "Saved locally in your profile" : "Not saved yet"}</span>
                  </div>
                  <div className="manager-meta manager-meta-stack">
                    <span>Last notification sent: ${appUser?.lastNotificationSentAt ? formatScanTime(appUser.lastNotificationSentAt) : "Not sent yet"}</span>
                    <span>Message: ${formatNotificationMessage(appUser?.lastNotificationMessage)}</span>
                  </div>
                  <div className="manager-meta manager-meta-stack notification-audit">
                    <span>
                      Last automatic notification attempt:
                      ${appUser?.lastAutoNotificationAttemptAt ? formatScanTime(appUser.lastAutoNotificationAttemptAt) : "Not attempted yet"}
                    </span>
                    <span>Was sent: ${formatBooleanStatus(appUser?.lastAutoNotificationSent)}</span>
                    <span>
                      Why skipped / status:
                      ${appUser?.lastAutoNotificationReason || "No automatic attempt has been recorded yet."}
                    </span>
                    <span className="notification-audit-items">
                      Items included:
                      ${appUser?.lastAutoNotificationItems || "No automatic notification items recorded yet."}
                    </span>
                  </div>
                  ${!pushoverConfigured
                    ? html`
                        <div className="empty-state">
                          The app-level Pushover token is not configured on the server yet, so alerts will stay off until
                          <code>PUSHOVER_APP_TOKEN</code> is added to Vercel.
                        </div>
                      `
                    : null}
                  ${profileMessage ? html`<div className="scan-status">${profileMessage}</div>` : null}
                  <div className="change-toast-actions">
                    <button className="button button-primary" onClick=${saveProfile} disabled=${profileSaving}>
                      ${profileSaving ? "Saving profile..." : "Save profile settings"}
                    </button>
                    <button
                      className="button button-secondary"
                      onClick=${sendTestNotification}
                      disabled=${profileTestingNotification || !pushoverConfigured || !appUser?.pushoverUserKey}
                    >
                      ${profileTestingNotification ? "Sending test..." : "Send test notification"}
                    </button>
                  </div>
                </article>
              </div>
            </section>
          `
        : activePage === "settings"
        ? html`
            <section className="surface manager-surface">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">Settings</h2>
                  <p className="section-note">Account actions and app management tools live here so the listings page stays focused.</p>
                </div>
                <button className="button button-secondary" onClick=${() => setActivePage("listings")}>
                  Back to listings
                </button>
              </div>
              <div className="profile-grid">
                <article className="manager-card">
                  <div className="manager-kicker">Account</div>
                  <h3 className="manager-title">Session</h3>
                  <p className="section-note">Sign out of your current approved account on this device.</p>
                  <div className="change-toast-actions">
                    <button className="button button-secondary" onClick=${signOut}>Sign out</button>
                  </div>
                </article>
                <article className="manager-card">
                  <div className="manager-kicker">Hot Items</div>
                  <h3 className="manager-title">Manage hot items</h3>
                  <p className="section-note">Review and remove hot items stored in Postgres.</p>
                  <div className="change-toast-actions">
                    <button className="button button-secondary" onClick=${() => setActivePage("hot-manager")}>
                      Manage hot items
                    </button>
                  </div>
                </article>
                ${appUser.role === "admin"
                  ? html`
                      <article className="manager-card">
                        <div className="manager-kicker">Admin</div>
                        <h3 className="manager-title">Server refresh</h3>
                        <p className="section-note">Manage the background server-side refresh schedule and review the next run.</p>
                        <div className="change-toast-actions">
                          <button className="button button-secondary" onClick=${() => setActivePage("server-refresh")}>
                            Open server refresh
                          </button>
                        </div>
                      </article>
                      <article className="manager-card">
                        <div className="manager-kicker">Admin</div>
                        <h3 className="manager-title">Stored listings</h3>
                        <p className="section-note">
                          Clear the stored listings snapshot for testing. The next manual or server refresh can add items back.
                        </p>
                        <div className="change-toast-actions">
                          <button
                            className="button button-secondary"
                            onClick=${clearStoredListings}
                            disabled=${clearingListings || loading}
                          >
                            ${clearingListings ? "Clearing stored listings..." : "Clear stored listings"}
                          </button>
                        </div>
                      </article>
                    `
                  : null}
              </div>
            </section>
          `
        : activePage === "server-refresh"
        ? html`
            <section className="surface manager-surface">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">Server Refresh</h2>
                  <p className="section-note">Admin controls for background Vercel cron scans.</p>
                </div>
                <button className="button button-secondary" onClick=${() => setActivePage("settings")}>
                  Back to settings
                </button>
              </div>
              <div className="profile-grid">
                <article className="manager-card">
                  <div className="manager-kicker">Server Schedule</div>
                  <h3 className="manager-title">Background refresh controls</h3>
                  <label className="profile-toggle-row">
                    <span>
                      <strong>Enable server-side refresh</strong>
                      <small>Turn background Vercel cron scans on or off.</small>
                    </span>
                    <button
                      type="button"
                      className=${`profile-toggle ${serverRefreshEnabled ? "profile-toggle-on" : ""}`}
                      aria-pressed=${serverRefreshEnabled}
                      onClick=${() => setServerRefreshEnabled((currentValue) => !currentValue)}
                    >
                      <span className="profile-toggle-knob"></span>
                    </button>
                  </label>
                  <div className="profile-alert-grid">
                    ${SERVER_REFRESH_INTERVAL_OPTIONS.map(
                      (intervalMinutes) => html`
                        <div className="profile-toggle-row profile-toggle-card" key=${`server-refresh-${intervalMinutes}`}>
                          <span>
                            <strong>${formatServerRefreshMode(intervalMinutes)}</strong>
                            <small>
                              ${intervalMinutes === 1
                                ? "Checks on each available Vercel cron tick."
                                : `Runs a stored scan when ${intervalMinutes} minutes have passed since the last server refresh.`}
                            </small>
                          </span>
                          <button
                            type="button"
                            className=${`button button-secondary button-small ${
                              serverRefreshIntervalMinutes === intervalMinutes ? "profile-critical-active" : ""
                            }`}
                            onClick=${() => setServerRefreshIntervalMinutes(intervalMinutes)}
                          >
                            Select
                          </button>
                        </div>
                      `,
                    )}
                  </div>
                  <div className="manager-meta manager-meta-stack">
                    <span>
                      Last server-side refresh:
                      ${serverRefreshSettings?.lastServerRefresh?.scannedAt
                        ? formatScanTime(serverRefreshSettings.lastServerRefresh.scannedAt)
                        : "Not run yet"}
                    </span>
                    <span>
                      Active refresh rate:
                      ${formatServerRefreshMode(serverRefreshIntervalMinutes)}
                    </span>
                    <span>
                      Next eligible refresh:
                      ${getNextServerRefreshLabel(serverRefreshSettings, serverRefreshEnabled, serverRefreshIntervalMinutes)}
                    </span>
                    <span>
                      Platform limit:
                      ${serverRefreshSettings?.limitations?.schedulingExplanation ||
                      "Vercel cron jobs wake the server once per minute."}
                    </span>
                  </div>
                  ${serverRefreshMessage ? html`<div className="scan-status">${serverRefreshMessage}</div>` : null}
                  <div className="change-toast-actions">
                    <button className="button button-primary" onClick=${saveServerRefreshSettings} disabled=${serverRefreshSaving}>
                      ${serverRefreshSaving ? "Saving schedule..." : "Save server refresh settings"}
                    </button>
                  </div>
                </article>
              </div>
            </section>
          `
        : activePage === "hot-manager"
        ? html`
            <section className="surface manager-surface">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">Hot Item Manager</h2>
                  <p className="section-note">
                    Mark products as hot here or from the current listings page. Hot status is stored in Vercel
                    Postgres when the database is connected.
                  </p>
                  ${hotStorageMessage ? html`<p className="section-note">${hotStorageMessage}</p>` : null}
                </div>
                <button className="button button-secondary" onClick=${() => setActivePage("settings")}>
                  Back to settings
                </button>
              </div>
              ${hotProducts.length
                ? html`
                    <div className="manager-list">
                      ${hotProducts.map(
                        (item) => html`
                          <article className="manager-card" key=${`hot-${item.productId || item.productName}`}>
                            <div className="manager-card-head">
                              <div>
                                <div className="manager-kicker">Hot item</div>
                                <h3 className="manager-title">${item.productName}</h3>
                              </div>
                              <button className="button button-secondary" onClick=${() => toggleHotItem(item)} disabled=${!hotStorageConfigured}>
                                Remove hot
                              </button>
                            </div>
                            <div className="manager-meta">
                              <span>${item.category || "Not shown"}</span>
                              <span>${item.bottleSizeDisplay || "Not shown"}</span>
                              <span>${item.price || "Not shown"}</span>
                              <span>${item.isPurchasableFromListingPage ? "Purchasable" : "Not purchasable"}</span>
                            </div>
                          </article>
                        `,
                      )}
                    </div>
                  `
                : html`<div className="empty-state">${hotStorageConfigured ? "No hot items yet. Mark items as hot from the current listings page." : "Connect Vercel Postgres to start saving hot items permanently."}</div>`}
            </section>
          `
        : html`
            <section className="table-shell">
        ${loading
          ? html`
              <div className="loading-banner" role="status" aria-live="polite">
                <div className="loading-banner-title">Live scan in progress</div>
                <div className="loading-banner-copy">
                  ${data
                    ? "Keeping the current table visible while the latest results load."
                    : "Pulling the first live dataset from the shop page now."}
                </div>
              </div>
            `
          : null}
        <div className="table-toolbar" id="current-listings">
          <div>
            <h2 className="section-title">Current Listings</h2>
            <p className="section-note">
              Showing ${filteredProducts.length} of ${data?.products?.length || 0} products from the latest scan.
            </p>
          </div>
          <div className="filters">
            <label className="filter-control">
              <span className="filter-label">Category</span>
              <select value=${categoryFilter} onChange=${(event) => setCategoryFilter(event.target.value)}>
                <option value="All">All</option>
                ${categories.map((category) => html`<option value=${category}>${category}</option>`)}
              </select>
            </label>
            <label className="filter-control">
              <span className="filter-label">Purchasable</span>
              <select value=${purchasableFilter} onChange=${(event) => setPurchasableFilter(event.target.value)}>
                <option value="All">All</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="filter-control">
              <span className="filter-label">Hot Items</span>
              <select value=${hotFilter} onChange=${(event) => setHotFilter(event.target.value)}>
                <option value="All">All</option>
                <option value="Hot">Hot only</option>
                <option value="Not Hot">Not hot</option>
              </select>
            </label>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Line Item</th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Bottle Size (mL)</th>
                <th>Price</th>
                <th>New</th>
                <th>Sourced & Certified</th>
                <th>Purchasable</th>
                <th>Hot</th>
              </tr>
            </thead>
            <tbody>
              ${filteredProducts.map(
                (item) => html`
                  <tr key=${item.productId || `${item.pageNumber}-${item.lineItemNumber}`}>
                    <td>${item.pageNumber}</td>
                    <td>${item.lineItemNumber}</td>
                    <td className="name-cell">
                      <div className="product-name-wrap">
                        ${item.productUrl
                          ? html`
                              <a
                                className="product-link"
                                href=${item.productUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                ${item.productName}
                              </a>
                            `
                          : html`<span>${item.productName}</span>`}
                        ${isHotItem(hotItems, item.productId || item.productName) ? html`<span className="hot-badge" aria-label="Hot item">🔥</span>` : null}
                      </div>
                    </td>
                    <td>${item.category}</td>
                    <td>${item.bottleSizeMl ?? item.bottleSizeDisplay}</td>
                    <td>${item.price}</td>
                    <td>${truthyTag(item.newBadge)}</td>
                    <td>${truthyTag(item.sourcedCertifiedBadge)}</td>
                    <td>${truthyTag(item.isPurchasableFromListingPage)}</td>
                    <td>
                      <button className="button button-secondary button-small" type="button" onClick=${() => toggleHotItem(item)} disabled=${!hotStorageConfigured} aria-label=${`${isHotItem(hotItems, item.productId || item.productName) ? "Remove" : "Mark"} ${item.productName} hot`}>
                        ${isHotItem(hotItems, item.productId || item.productName) ? "Remove hot" : "Mark hot"}
                      </button>
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-listings">
          ${filteredProducts.map(
            (item) => html`
              <article className="mobile-card" key=${`mobile-${item.productId || `${item.pageNumber}-${item.lineItemNumber}`}`}>
                <div className="mobile-card-top">
                  <div>
                    <div className="mobile-card-kicker">Page ${item.pageNumber} | Item ${item.lineItemNumber}</div>
                    <h3 className="mobile-card-title">
                      ${item.productUrl
                        ? html`
                            <a className="product-link" href=${item.productUrl} target="_blank" rel="noreferrer">
                              ${item.productName}
                            </a>
                          `
                        : item.productName}
                      ${isHotItem(hotItems, item.productId || item.productName) ? html`<span className="hot-badge" aria-label="Hot item">🔥</span>` : null}
                    </h3>
                  </div>
                </div>
                <div className="mobile-card-grid">
                  <div className="mobile-field">
                    <span className="mobile-field-label">Purchasable</span>
                    <span>${formatBooleanText(item.isPurchasableFromListingPage)}</span>
                  </div>
                </div>
              </article>
            `,
          )}
        </div>
        <div className="footer-note">
          Fresh runs always hit the live shop endpoint through the server, and the local diff compares only against the
          last successful scan saved in this browser.
        </div>
        <div className="footer-note">
          Testing reset: clearing stored listings empties the saved Postgres snapshot, but scheduled background scans
          can repopulate the list on the next run.
        </div>
      </section>
          `}
    </main>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);




