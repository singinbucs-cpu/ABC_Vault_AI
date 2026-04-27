import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const STORAGE_KEY = "abc-vault-live-scanner:last-scan:v1";
const THEME_STORAGE_KEY = "abc-vault-live-scanner:theme:v1";
const MAGIC_LINK_COOLDOWN_KEY = "abc-vault-live-scanner:magic-link-cooldown:v1";
const IN_APP_NOTIFICATIONS_KEY = "abc-vault-live-scanner:in-app-notifications:v1";
const PENDING_VAULT_PRODUCT_KEY = "abc-vault-live-scanner:pending-vault-product:v1";
const APP_BASE_URL = "https://abc-vault-live-scanner.vercel.app/";
const ABC_VAULT_URL = "https://theabcvault.com/";
const ABC_VAULT_SHOP_URL = "https://theabcvault.com/shop/";
const AUTO_REFRESH_SECONDS = 30;
const REFRESH_WINDOW_TIMEZONE = "America/New_York";
const REFRESH_WINDOW_START_HOUR = 8;
const REFRESH_WINDOW_END_HOUR = 17;
const AUTH_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const LIVE_SYNC_LEASE_KEY = "abc-vault-live-scanner:live-sync-owner:v1";
const LIVE_SYNC_LEASE_MS = 45 * 1000;
const LIVE_SYNC_HEARTBEAT_MS = 15 * 1000;
const LIVE_SYNC_BROADCAST_CHANNEL = "abc-vault-live-scanner:live-sync:v1";
const REFRESH_RATE_OPTIONS = [1, 2, 5, 10, 15, 30];
const VIEWER_REFRESH_RATE_OPTIONS = [5, 10, 15, 30];
const SERVER_REFRESH_INTERVAL_OPTIONS = [1, 5, 10, 30, 60];
const MAGIC_LINK_COOLDOWN_SECONDS = 60;
const CELEBRATION_CONFETTI_COUNT = 18;
const REFRESH_WINDOW_WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function createClientTabId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLiveSyncLease() {
  try {
    const rawValue = window.localStorage.getItem(LIVE_SYNC_LEASE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed?.tabId || !parsed?.expiresAt) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

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

  return Array.from(merged.values()).sort((a, b) => {
    const aTime = new Date(a.detectedAt || 0).getTime();
    const bTime = new Date(b.detectedAt || 0).getTime();
    return bTime - aTime;
  });
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

function formatChangeValue(field, value) {
  if (field === "isPurchasableFromListingPage" || field === "newBadge" || field === "sourcedCertifiedBadge" || field === "soldOutIndicatorPresent") {
    return value ? "Yes" : "No";
  }

  if (field === "buttonStatesShown") {
    return Array.isArray(value) && value.length ? value.join(", ") : "None shown";
  }

  if (value === undefined || value === null || value === "") {
    return "Not shown";
  }

  return String(value);
}

function buildChangeDescriptions(item) {
  const details = item?.details || {};
  const fields = item?.fields || [];

  if (!fields.length) {
    return ["Listing details changed."];
  }

  return fields.map((field) => {
    const detail = details[field] || {};
    const previousValue = detail.previous;
    const currentValue = detail.current;

    if (field === "isPurchasableFromListingPage") {
      if (currentValue === true) {
        return "Is now purchasable.";
      }

      if (currentValue === false) {
        return "Is no longer purchasable.";
      }
    }

    return `${formatChangedFieldLabel(field)} from ${formatChangeValue(field, previousValue)} to ${formatChangeValue(field, currentValue)}.`;
  });
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

function getRefreshWindowParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: REFRESH_WINDOW_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekdayIndex = REFRESH_WINDOW_WEEKDAY_INDEX[values.weekday] ?? -1;

  return {
    weekday: values.weekday || "",
    weekdayIndex,
    hour: Number(values.hour || 0),
    minute: Number(values.minute || 0),
  };
}

function getNextAllowedRefreshLabel(parts) {
  if (parts.weekdayIndex >= 1 && parts.weekdayIndex <= 5 && parts.hour < REFRESH_WINDOW_START_HOUR) {
    return "Today at 8:00 AM ET";
  }

  if (parts.weekdayIndex >= 1 && parts.weekdayIndex <= 4) {
    return "Tomorrow at 8:00 AM ET";
  }

  return "Monday at 8:00 AM ET";
}

function getRefreshWindowStatus(now = new Date()) {
  const parts = getRefreshWindowParts(now);
  const isWeekday = parts.weekdayIndex >= 1 && parts.weekdayIndex <= 5;
  const isWithinHours = parts.hour >= REFRESH_WINDOW_START_HOUR && parts.hour < REFRESH_WINDOW_END_HOUR;
  const allowed = isWeekday && isWithinHours;

  if (allowed) {
    return {
      allowed: true,
      scheduleLabel: "Monday-Friday, 8:00 AM-5:00 PM ET",
      blockedReason: "",
      nextAllowedLabel: null,
    };
  }

  const blockedReason = !isWeekday
    ? "Refreshes are blocked on weekends."
    : parts.hour < REFRESH_WINDOW_START_HOUR
    ? "Refreshes are blocked before 8:00 AM ET."
    : "Refreshes are blocked after 5:00 PM ET.";

  return {
    allowed: false,
    scheduleLabel: "Monday-Friday, 8:00 AM-5:00 PM ET",
    blockedReason,
    nextAllowedLabel: getNextAllowedRefreshLabel(parts),
  };
}

function formatBrowserRefreshStatus({ localEnabled, globalEnabled, refreshWindowAllowed, refreshWindowBlockedReason, nextAllowedLabel, loading, countdown }) {
  if (!globalEnabled) {
    return "Disabled by Server Page setting";
  }

  if (!refreshWindowAllowed) {
    return `${refreshWindowBlockedReason} Next window: ${nextAllowedLabel}.`;
  }

  if (!localEnabled) {
    return "Paused";
  }

  if (loading) {
    return "Waiting for current scan...";
  }

  return `${countdown}s`;
}

function formatVercelSpendEventType(eventType) {
  if (eventType === "budget_threshold_reached") {
    return "Budget threshold reached";
  }

  if (eventType === "end_of_billing_cycle") {
    return "Billing cycle ended";
  }

  return eventType || "No event received yet";
}

function getNextOvernightServerRefreshLabelForUi(now = new Date()) {
  const parts = getRefreshWindowParts(now);
  const isAllowedDay = parts.weekdayIndex >= 0 && parts.weekdayIndex <= 5;

  if (isAllowedDay && parts.hour === 0 && parts.minute < 30) {
    return "Today at 12:30 AM ET";
  }

  if (isAllowedDay && (parts.hour === 0 || (parts.hour === 1 && parts.minute === 0))) {
    return "Today at 1:00 AM ET";
  }

  if (parts.weekdayIndex >= 0 && parts.weekdayIndex <= 4) {
    return "Tomorrow at 12:30 AM ET";
  }

  return "Sunday at 12:30 AM ET";
}

function getNextServerRefreshLabel(settings, enabledOverride, intervalOverride, scheduleOverrides = {}) {
  const enabled = typeof enabledOverride === "boolean" ? enabledOverride : Boolean(settings?.settings?.enabled);
  const daytimeIntervalEnabled =
    typeof scheduleOverrides.daytimeIntervalEnabled === "boolean"
      ? scheduleOverrides.daytimeIntervalEnabled
      : settings?.settings?.daytimeIntervalEnabled !== false;
  const overnightScheduleEnabled =
    typeof scheduleOverrides.overnightScheduleEnabled === "boolean"
      ? scheduleOverrides.overnightScheduleEnabled
      : Boolean(settings?.settings?.overnightScheduleEnabled);
  const intervalMinutes = Number(intervalOverride || settings?.settings?.intervalMinutes) || 30;
  const refreshWindow = settings?.refreshWindow || getRefreshWindowStatus();
  const intervalRuleEnabled = enabled && daytimeIntervalEnabled;

  if (!intervalRuleEnabled && !overnightScheduleEnabled) {
    return "Disabled";
  }

  if (overnightScheduleEnabled && !intervalRuleEnabled) {
    return getNextOvernightServerRefreshLabelForUi();
  }

  if (intervalRuleEnabled && !overnightScheduleEnabled) {
    if (!refreshWindow.allowed) {
      return refreshWindow.nextAllowedLabel ? `Blocked until ${refreshWindow.nextAllowedLabel}` : "Blocked by schedule";
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

  const intervalLabel = refreshWindow.allowed
    ? `daytime interval (${formatServerRefreshMode(intervalMinutes)}) is active now`
    : `daytime interval waits until ${refreshWindow.nextAllowedLabel || "the next window"}`;
  const overnightLabel = `overnight refresh resumes ${getNextOvernightServerRefreshLabelForUi()}`;
  return `${intervalLabel}; ${overnightLabel}`;
}

function formatSelectedServerRefreshRules({
  daytimeIntervalEnabled,
  overnightScheduleEnabled,
  intervalMinutes,
}) {
  const rules = [];

  if (daytimeIntervalEnabled) {
    rules.push(`Daytime interval: ${formatServerRefreshMode(intervalMinutes)}`);
  }

  if (overnightScheduleEnabled) {
    rules.push("Overnight: Sunday-Friday at 12:30 AM and 1:00 AM ET");
  }

  if (!rules.length) {
    return "No schedules selected";
  }

  return rules.join(" + ");
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

function getInitialInAppNotificationsEnabled() {
  try {
    const storedValue = window.localStorage.getItem(IN_APP_NOTIFICATIONS_KEY);
    return storedValue !== "off";
  } catch {
    return true;
  }
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

function getInitialPendingVaultProduct() {
  try {
    const raw = window.localStorage.getItem(PENDING_VAULT_PRODUCT_KEY);
    if (!raw) {
      return null;
    }

    const product = JSON.parse(raw);
    return product?.productUrl ? product : null;
  } catch {
    return null;
  }
}

function savePendingVaultProduct(product) {
  try {
    window.localStorage.setItem(PENDING_VAULT_PRODUCT_KEY, JSON.stringify(product));
  } catch {
    // Keep the in-session helper working even when storage is unavailable.
  }
}

function clearPendingVaultProductStorage() {
  try {
    window.localStorage.removeItem(PENDING_VAULT_PRODUCT_KEY);
  } catch {
    // Ignore storage failures; the visible state is still cleared.
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
      if (JSON.stringify(previousItem[field]) !== JSON.stringify(currentItem[field])) {
        fieldChanges.push(field);
        changeDetails[field] = {
          previous: previousItem[field],
          current: currentItem[field],
        };
      }
    }

    if (JSON.stringify(previousItem.buttonStatesShown) !== JSON.stringify(currentItem.buttonStatesShown)) {
      fieldChanges.push("buttonStatesShown");
      changeDetails.buttonStatesShown = {
        previous: previousItem.buttonStatesShown,
        current: currentItem.buttonStatesShown,
      };
    }

    if (fieldChanges.length > 0) {
      changed.push({
        productName: currentItem.productName,
        productUrl: currentItem.productUrl || null,
        isPurchasableFromListingPage: Boolean(currentItem.isPurchasableFromListingPage),
        fields: fieldChanges,
        details: changeDetails,
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

function renderLinkedProductName(item, onProductLinkClick = null) {
  return item.productUrl
    ? html`
        <a
          className="product-link"
          href=${item.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick=${onProductLinkClick ? (event) => onProductLinkClick(event, item) : undefined}
        >
          ${item.productName}
        </a>
      `
    : html`<span>${item.productName}</span>`;
}

function renderProductThumbnail(item, className = "product-thumb", onOpen = null) {
  if (!item?.imageUrl) {
    return null;
  }

  const image = html`
    <img
      className=${className}
      src=${item.imageUrl}
      alt=${item.imageAlt || item.productName || ""}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError=${(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  `;

  if (!onOpen) {
    return image;
  }

  return html`
    <button
      className="product-thumb-button"
      type="button"
      onClick=${() => onOpen(item)}
      aria-label=${`View larger image for ${item.productName}`}
    >
      ${image}
    </button>
  `;
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

function renderStatPreview(items, emptyLabel, options = {}) {
  const limit = options.limit || 5;
  const showFullListOnHover = Boolean(options.showFullListOnHover);
  const previewNames = getPreviewNames(items, limit);
  const fullNames = getPreviewNames(items, items.length);
  const remainingCount = Math.max(fullNames.length - previewNames.length, 0);
  const fullListLabel = fullNames.join("\n");

  if (!previewNames.length) {
    return html`<div className="stat-preview-empty">${emptyLabel}</div>`;
  }

  return html`
    <div
      className=${`stat-preview-list ${showFullListOnHover && remainingCount ? "stat-preview-hoverable" : ""}`}
      tabIndex=${showFullListOnHover && remainingCount ? 0 : undefined}
      aria-label=${showFullListOnHover && remainingCount ? `${fullNames.length} items. Focus or hover to see the full list.` : undefined}
    >
      ${previewNames.map((name) => html`<div className="stat-preview-item">${name}</div>`)}
      ${remainingCount
        ? html`<div className="stat-preview-more">+${remainingCount} more. Hover to view all.</div>`
        : null}
      ${showFullListOnHover && remainingCount
        ? html`
            <div className="stat-preview-popover" role="tooltip">
              <div className="stat-preview-popover-title">Full list</div>
              ${fullNames.map((name) => html`<div className="stat-preview-popover-item">${name}</div>`)}
            </div>
          `
        : null}
    </div>
  `;
}

function renderVaultEmailEvent(event, onDelete) {
  const confirmationLinks = Array.isArray(event.confirmationLinks) ? event.confirmationLinks : [];
  const candidateEmails = Array.isArray(event.candidateEmails) ? event.candidateEmails : [];
  const recipientEmails = Array.isArray(event.recipientEmails) ? event.recipientEmails : [];
  const eventTime = event.receivedAt || event.createdAt;
  const eventTypeLabel =
    event.eventType === "order_confirmation"
      ? "Order confirmation"
      : event.eventType === "pickup_ready"
      ? "Pickup ready"
      : event.eventType === "gmail_forwarding_confirmation"
      ? "Gmail forwarding confirmation"
      : event.eventType === "vault_email"
      ? "Vault email"
      : event.eventType || "Inbound email";
  const statusLabel =
    event.eventType === "order_confirmation" && event.status === "notification_sent"
      ? "Order confirmation notification sent"
      : event.eventType === "order_confirmation" && event.status === "notification_skipped"
      ? "Order confirmation notification skipped"
      : event.eventType === "pickup_ready" && event.status === "notification_sent"
      ? "Pickup ready notification sent"
      : event.eventType === "pickup_ready" && event.status === "notification_skipped"
      ? "Pickup ready notification skipped"
      : event.status;
  const statusIsPositive = ["saved", "saved_global", "notification_sent"].includes(event.status);

  return html`
    <article className="manager-card email-event-card" key=${`email-event-${event.id}`}>
      <div className="manager-card-head">
        <div>
          <div className="manager-kicker">${eventTypeLabel}</div>
          <h3 className="manager-title">${event.subject || "No subject captured"}</h3>
        </div>
        <div className="email-event-actions">
          <span className=${`pill ${statusIsPositive ? "pill-yes" : "pill-no"}`}>${statusLabel}</span>
          <button className="button button-secondary button-small" type="button" onClick=${() => onDelete(event.id)}>
            Delete
          </button>
        </div>
      </div>
      <div className="manager-meta manager-meta-stack">
        <span>Subject: ${event.subject || "No subject captured"}</span>
        <span>Received: ${formatScanTime(eventTime)}</span>
        <span>From: ${event.fromAddress || "Not captured"}</span>
        <span>Matched user: ${event.matchedUserEmail || "No user matched"}</span>
        <span>Vault key: ${event.vaultKeyCode || "Not found"}</span>
        <span>Recipients: ${recipientEmails.length ? recipientEmails.join(", ") : "Not captured"}</span>
        <span>Candidate emails: ${candidateEmails.length ? candidateEmails.join(", ") : "None captured"}</span>
        <span>Message: ${event.message || "No message stored"}</span>
      </div>
      ${confirmationLinks.length
        ? html`
            <div className="manager-meta manager-meta-stack">
              ${confirmationLinks.map(
                (link, index) => html`
                  <a className="product-link" href=${link} target="_blank" rel="noopener noreferrer">
                    Open Gmail confirmation link ${index + 1}
                  </a>
                `,
              )}
            </div>
          `
        : null}
      ${event.preview
        ? html`
            <details className="email-event-preview">
              <summary>View stored email preview</summary>
              <div className="email-event-preview-body">
                <div className="email-event-preview-label">Stored message preview</div>
                <p>${event.preview}</p>
              </div>
            </details>
          `
        : null}
    </article>
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
  const [isLiveSyncOwner, setIsLiveSyncOwner] = useState(true);
  const [authEmail, setAuthEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [magicLinkCooldownSeconds, setMagicLinkCooldownSeconds] = useState(() => getInitialMagicLinkCooldown());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("Warming up the vault radar...");
    const [vaultKeyCopyMessage, setVaultKeyCopyMessage] = useState("");
    const [vaultKeyToast, setVaultKeyToast] = useState(null);
    const [celebrationBurst, setCelebrationBurst] = useState(null);
    const [selectedProductImage, setSelectedProductImage] = useState(null);
    const [pendingVaultProduct, setPendingVaultProduct] = useState(() => getInitialPendingVaultProduct());
    const [lastCompletedScanAt, setLastCompletedScanAt] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [purchasableFilter, setPurchasableFilter] = useState("All");
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(AUTO_REFRESH_SECONDS);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [refreshWindowNow, setRefreshWindowNow] = useState(() => Date.now());
  const [manualBlockedRefreshCooldownSeconds, setManualBlockedRefreshCooldownSeconds] = useState(0);
  const [inAppNotificationsEnabled, setInAppNotificationsEnabled] = useState(getInitialInAppNotificationsEnabled);
  const [changeAlert, setChangeAlert] = useState(null);
  const [changeFeed, setChangeFeed] = useState(createEmptyChangeFeed());
  const [changeInboxMessage, setChangeInboxMessage] = useState("");
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
  const [profileNotifyAddedHotOnly, setProfileNotifyAddedHotOnly] = useState(false);
  const [profileNotifyPurchasableHotOnly, setProfileNotifyPurchasableHotOnly] = useState(false);
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
  const [browserRefreshGloballyEnabled, setBrowserRefreshGloballyEnabled] = useState(true);
  const [serverRefreshDaytimeIntervalEnabled, setServerRefreshDaytimeIntervalEnabled] = useState(true);
  const [serverRefreshOvernightEnabled, setServerRefreshOvernightEnabled] = useState(false);
  const [serverRefreshIntervalMinutes, setServerRefreshIntervalMinutes] = useState(30);
  const [serverRefreshSaving, setServerRefreshSaving] = useState(false);
  const [serverRefreshMessage, setServerRefreshMessage] = useState("");
  const [vercelSpendWebhookSettings, setVercelSpendWebhookSettings] = useState(null);
  const [vercelSpendWebhookEnabled, setVercelSpendWebhookEnabled] = useState(true);
  const [vercelSpendNotifyBillingCycleEnd, setVercelSpendNotifyBillingCycleEnd] = useState(true);
  const [vercelSpendCriticalBudgetReached, setVercelSpendCriticalBudgetReached] = useState(true);
  const [vercelSpendCriticalBillingCycleEnd, setVercelSpendCriticalBillingCycleEnd] = useState(false);
  const [vercelSpendWebhookUrl, setVercelSpendWebhookUrl] = useState("");
  const [vercelSpendWebhookSecretConfigured, setVercelSpendWebhookSecretConfigured] = useState(false);
  const [vercelSpendWebhookSaving, setVercelSpendWebhookSaving] = useState(false);
  const [vercelSpendWebhookMessage, setVercelSpendWebhookMessage] = useState("");
  const [remoteBrowserConfigured, setRemoteBrowserConfigured] = useState(false);
  const [remoteBrowserDashboardUrl, setRemoteBrowserDashboardUrl] = useState("");
  const [remoteBrowserStatus, setRemoteBrowserStatus] = useState(null);
  const [remoteBrowserLoading, setRemoteBrowserLoading] = useState(false);
  const [remoteBrowserMessage, setRemoteBrowserMessage] = useState("");
  const [remoteBrowserOpeningKey, setRemoteBrowserOpeningKey] = useState("");
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersSaving, setAdminUsersSaving] = useState(false);
  const [adminUsersMessage, setAdminUsersMessage] = useState("");
  const [newViewerEmail, setNewViewerEmail] = useState("");
  const [vaultEmailEvents, setVaultEmailEvents] = useState([]);
  const [vaultEmailEventsLoading, setVaultEmailEventsLoading] = useState(false);
  const [vaultEmailEventsMessage, setVaultEmailEventsMessage] = useState("");
  const loadingRef = useRef(false);
  const dataRef = useRef(null);
  const runScanRef = useRef(null);
  const loadLatestSnapshotRef = useRef(null);
  const loadServerRefreshSettingsRef = useRef(null);
  const loadVercelSpendWebhookSettingsRef = useRef(null);
  const loadRemoteBrowserStatusRef = useRef(null);
  const appUserRef = useRef(null);
  const lastServerRefreshSeenRef = useRef("");
  const supabaseRef = useRef(null);
  const liveSyncTabIdRef = useRef(createClientTabId());
  const liveSyncChannelRef = useRef(null);
  const audioContextRef = useRef(null);
  const previousAlertSignatureRef = useRef("");
  const latestLoadRef = useRef(false);
  const refreshWindowStatus = useMemo(() => getRefreshWindowStatus(new Date(refreshWindowNow)), [refreshWindowNow]);
  const browserRefreshAllowed = browserRefreshGloballyEnabled && refreshWindowStatus.allowed;
  const remoteBrowserDesktopUrl = useMemo(() => {
    if (!remoteBrowserDashboardUrl) {
      return "";
    }

    try {
      const url = new URL(remoteBrowserDashboardUrl);
      url.pathname = "/desktop/vnc_lite.html";
      url.search = "path=desktop/websockify&autoconnect=true&resize=scale";
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }, [remoteBrowserDashboardUrl]);

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

  const broadcastLiveSyncMessage = (type, payload) => {
    const channel = liveSyncChannelRef.current;
    if (!channel) {
      return;
    }

    try {
      channel.postMessage({
        type,
        payload,
      });
    } catch {
      // Ignore cross-tab broadcast failures and keep the local tab working.
    }
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

  const readJsonResponse = async (response, fallbackMessage) => {
    const rawText = await response.text();

    if (!rawText) {
      return {
        message: fallbackMessage || "The server returned an empty response.",
      };
    }

    try {
      return JSON.parse(rawText);
    } catch {
      return {
        message: fallbackMessage || "The server returned an unreadable response.",
      };
    }
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
    setProfileNotifyAddedHotOnly(Boolean(nextAppUser.notifyAddedHotOnly));
    setProfileNotifyPurchasableHotOnly(Boolean(nextAppUser.notifyPurchasableHotOnly));
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

      if (nextVaultKeyCode && didVaultKeyActuallyChange && inAppNotificationsEnabled) {
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
      const response = await apiFetch("/api/me?recordLogin=1");
      const payload = await response.json();

      if (!response.ok) {
        throw Object.assign(new Error(getAuthErrorMessage(response.status, payload, "Access check failed.")), {
          statusCode: response.status,
        });
      }

      applyAppUserPayload(payload, { syncProfileFields: true });
      setAuthError("");
    } catch (loadError) {
      if (loadError.statusCode === 401 || loadError.statusCode === 403) {
        setAppUser(null);
      }
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
          notifyAddedHotOnly: profileNotifyAddedHotOnly,
          notifyPurchasableHotOnly: profileNotifyPurchasableHotOnly,
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

    if (!browserRefreshGloballyEnabled) {
      setError("Browser refreshes are disabled from the Server Page.");
      setStatusMessage("Browser refreshes are disabled from the Server Page.");
      return;
    }

    const isAutomaticMode = mode === "auto";
    if (!refreshWindowStatus.allowed && isAutomaticMode) {
      const blockedMessage = `${refreshWindowStatus.blockedReason} Next allowed window: ${refreshWindowStatus.nextAllowedLabel}.`;
      setError(blockedMessage);
      setStatusMessage(blockedMessage);
      return;
    }

    if (!refreshWindowStatus.allowed && manualBlockedRefreshCooldownSeconds > 0) {
      const cooldownMessage = `Blocked-window manual scan available again in ${manualBlockedRefreshCooldownSeconds}s.`;
      setError(cooldownMessage);
      setStatusMessage(cooldownMessage);
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
        if (payload?.error === "manual_refresh_cooldown" && Number(payload.remainingSeconds) > 0) {
          setManualBlockedRefreshCooldownSeconds(Number(payload.remainingSeconds));
        }
        throw new Error(payload.message || "Scan failed.");
      }

      if (Number(payload?.manualRefreshCooldownSeconds) > 0) {
        setManualBlockedRefreshCooldownSeconds(Number(payload.manualRefreshCooldownSeconds));
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

          if (inAppNotificationsEnabled) {
            setChangeAlert({
              detectedAt,
              added: liveDiff.added.length,
              removed: liveDiff.removed?.length || 0,
              changed: liveDiff.changed?.length || 0,
              totalChanges,
            });
          }
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
                details: item.details || {},
                isPurchasableFromListingPage: item.isPurchasableFromListingPage,
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
          if (inAppNotificationsEnabled) {
            setChangeAlert({
              detectedAt,
              added: liveDiff.added.length,
              removed: liveDiff.removed.length,
              changed: liveDiff.changed.length,
              totalChanges,
            });
          }
        }
      }

      applySnapshotPayload(payload, previous);
      await loadChangeNotifications().catch((notificationsError) => {
        setChangeInboxMessage(notificationsError.message || "Unable to load change notifications.");
      });
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
      await loadChangeNotifications().catch((notificationsError) => {
        setChangeInboxMessage(notificationsError.message || "Unable to load change notifications.");
      });
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

  const loadChangeNotifications = async () => {
    const response = await apiFetch("/api/change-notifications");
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : null;

    if (!payload) {
      const text = await response.text();
      throw new Error(`Change inbox endpoint returned non-JSON content: ${text.slice(0, 120)}`);
    }

    if (!response.ok) {
      throw new Error(payload.message || "Unable to load change notifications.");
    }

    setChangeFeed(payload.feed || createEmptyChangeFeed());
    setChangeInboxMessage(payload.message || "");
  };

  const markChangeNotificationsRead = async (options = {}) => {
    const response = await apiFetch("/api/change-notifications", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : null;

    if (!payload) {
      const text = await response.text();
      throw new Error(`Change inbox endpoint returned non-JSON content: ${text.slice(0, 120)}`);
    }

    if (!response.ok) {
      throw new Error(payload.message || "Unable to mark notifications read.");
    }

    setChangeFeed(payload.feed || createEmptyChangeFeed());
    setChangeInboxMessage(payload.message || "");
  };

  const loadServerRefreshSettings = async () => {
    const response = await apiFetch("/api/server-refresh-settings");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "Unable to load server refresh settings.");
    }

    setServerRefreshSettings(payload);
    setBrowserRefreshGloballyEnabled(payload.settings?.browserRefreshEnabled !== false);
    setServerRefreshDaytimeIntervalEnabled(payload.settings?.daytimeIntervalEnabled !== false);
    setServerRefreshOvernightEnabled(Boolean(payload.settings?.overnightScheduleEnabled));
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
          enabled: serverRefreshDaytimeIntervalEnabled,
          browserRefreshEnabled: browserRefreshGloballyEnabled,
          daytimeIntervalEnabled: serverRefreshDaytimeIntervalEnabled,
          overnightScheduleEnabled: serverRefreshOvernightEnabled,
          intervalMinutes: serverRefreshIntervalMinutes,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to save server refresh settings.");
      }

      setServerRefreshSettings(payload);
      setBrowserRefreshGloballyEnabled(payload.settings?.browserRefreshEnabled !== false);
      setServerRefreshDaytimeIntervalEnabled(payload.settings?.daytimeIntervalEnabled !== false);
      setServerRefreshOvernightEnabled(Boolean(payload.settings?.overnightScheduleEnabled));
      setServerRefreshIntervalMinutes(Number(payload.settings?.intervalMinutes) || 30);
      setServerRefreshMessage("Server refresh settings saved.");
    } catch (saveError) {
      setServerRefreshMessage(saveError.message || "Unable to save server refresh settings.");
    } finally {
      setServerRefreshSaving(false);
    }
  };

  const loadVercelSpendWebhookSettings = async () => {
    const response = await apiFetch("/api/vercel-spend-webhook-settings");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "Unable to load Billing Alerts settings.");
    }

    setVercelSpendWebhookSettings(payload.settings || null);
    setVercelSpendWebhookEnabled(Boolean(payload.settings?.enabled));
    setVercelSpendNotifyBillingCycleEnd(Boolean(payload.settings?.notifyBillingCycleEnd));
    setVercelSpendCriticalBudgetReached(Boolean(payload.settings?.criticalBudgetReached));
    setVercelSpendCriticalBillingCycleEnd(Boolean(payload.settings?.criticalBillingCycleEnd));
    setVercelSpendWebhookUrl(payload.webhookUrl || "");
    setVercelSpendWebhookSecretConfigured(Boolean(payload.secretConfigured));
    setVercelSpendWebhookMessage("");
  };

  const loadRemoteBrowserStatus = async () => {
    setRemoteBrowserLoading(true);

    try {
      const response = await apiFetch("/api/remote-browser");
      const payload = await readJsonResponse(response, "Unable to read the remote browser status.");

      if (!response.ok) {
        throw new Error(payload.message || "Unable to load remote browser status.");
      }

      setRemoteBrowserConfigured(Boolean(payload.configured));
      setRemoteBrowserDashboardUrl(payload.dashboardUrl || "");
      setRemoteBrowserStatus(payload.status || null);
      setRemoteBrowserMessage(payload.message || "");
    } catch (loadError) {
      setRemoteBrowserConfigured(false);
      setRemoteBrowserStatus(null);
      setRemoteBrowserMessage(loadError.message || "Unable to load remote browser status.");
    } finally {
      setRemoteBrowserLoading(false);
    }
  };

  const openOnRemoteBrowser = async (item) => {
    if (!item?.productUrl) {
      return;
    }

    const itemKey = item.productId || item.productName || item.productUrl;
    const latestVaultKey = (appUser?.vaultKeyCode || "").trim();
    setRemoteBrowserOpeningKey(itemKey);
    setRemoteBrowserMessage(
      latestVaultKey
        ? `Sending Vault key ${latestVaultKey} to the VPS, opening the vault link, then heading to ${item.productName}.`
        : `Opening the vault link on the VPS, then heading to ${item.productName}.`,
    );

    try {
      const response = await apiFetch("/api/remote-browser", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vaultUrl: ABC_VAULT_URL,
          productUrl: item.productUrl,
          vaultKey: latestVaultKey,
          label: item.productName || "Vault product",
        }),
      });
      const payload = await readJsonResponse(response, "Unable to read the remote browser opener response.");

      if (!response.ok) {
        throw new Error(payload.message || "Unable to open the product on the remote browser.");
      }

      setRemoteBrowserConfigured(Boolean(payload.configured));
      setRemoteBrowserDashboardUrl(payload.dashboardUrl || "");
      setRemoteBrowserStatus(payload.status || payload.result || null);
      setRemoteBrowserMessage(
        payload.result?.finalUrl
          ? `Remote browser used Vault key ${latestVaultKey || "not provided"}, opened the vault link, and reached ${payload.result.finalUrl}`
          : `Remote browser started the vault flow for ${item.productName}.`,
      );
    } catch (openError) {
      setRemoteBrowserMessage(openError.message || "Unable to open the product on the remote browser.");
    } finally {
      setRemoteBrowserOpeningKey("");
    }
  };

  const openVaultLinkOnRemoteBrowser = async () => {
    await openOnRemoteBrowser({
      productId: "vault-link",
      productName: "Vault Link",
      productUrl: ABC_VAULT_SHOP_URL,
    });
  };

  const saveVercelSpendWebhookSettings = async () => {
    setVercelSpendWebhookSaving(true);
    setVercelSpendWebhookMessage("");

    try {
      const response = await apiFetch("/api/vercel-spend-webhook-settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: vercelSpendWebhookEnabled,
          notifyBillingCycleEnd: vercelSpendNotifyBillingCycleEnd,
          criticalBudgetReached: vercelSpendCriticalBudgetReached,
          criticalBillingCycleEnd: vercelSpendCriticalBillingCycleEnd,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to save Billing Alerts settings.");
      }

      setVercelSpendWebhookSettings(payload.settings || null);
      setVercelSpendWebhookEnabled(Boolean(payload.settings?.enabled));
      setVercelSpendNotifyBillingCycleEnd(Boolean(payload.settings?.notifyBillingCycleEnd));
      setVercelSpendCriticalBudgetReached(Boolean(payload.settings?.criticalBudgetReached));
      setVercelSpendCriticalBillingCycleEnd(Boolean(payload.settings?.criticalBillingCycleEnd));
      setVercelSpendWebhookUrl(payload.webhookUrl || "");
      setVercelSpendWebhookSecretConfigured(Boolean(payload.secretConfigured));
      setVercelSpendWebhookMessage("Billing Alerts settings saved.");
    } catch (saveError) {
      setVercelSpendWebhookMessage(saveError.message || "Unable to save Billing Alerts settings.");
    } finally {
      setVercelSpendWebhookSaving(false);
    }
  };

  const loadAdminUsers = async () => {
    setAdminUsersLoading(true);
    setAdminUsersMessage("");

    try {
      const response = await apiFetch("/api/admin-users");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to load users.");
      }

      setAdminUsers(payload.users || []);
    } catch (loadError) {
      setAdminUsersMessage(loadError.message || "Unable to load users.");
    } finally {
      setAdminUsersLoading(false);
    }
  };

  const addViewerUser = async (event) => {
    event.preventDefault();

    const email = newViewerEmail.trim();
    if (!email) {
      setAdminUsersMessage("Enter an email address to add.");
      return;
    }

    setAdminUsersSaving(true);
    setAdminUsersMessage("");

    try {
      const response = await apiFetch("/api/admin-users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to add viewer.");
      }

      setAdminUsers(payload.users || []);
      setNewViewerEmail("");
      setAdminUsersMessage(payload.message || `${email} was added as a viewer.`);
    } catch (addError) {
      setAdminUsersMessage(addError.message || "Unable to add viewer.");
    } finally {
      setAdminUsersSaving(false);
    }
  };

  const loadVaultEmailEvents = async () => {
    setVaultEmailEventsLoading(true);
    setVaultEmailEventsMessage("");

    try {
      const response = await apiFetch("/api/vault-email-events?limit=25");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to load inbound email log.");
      }

      setVaultEmailEvents(payload.events || []);
      if (!payload.storageConfigured) {
        setVaultEmailEventsMessage(payload.message || "Inbound email event storage is not configured.");
      }
    } catch (loadError) {
      setVaultEmailEventsMessage(loadError.message || "Unable to load inbound email log.");
    } finally {
      setVaultEmailEventsLoading(false);
    }
  };

  const deleteVaultEmailEvent = async (eventId) => {
    const confirmed = window.confirm("Delete this inbound email log entry?");
    if (!confirmed) {
      return;
    }

    setVaultEmailEventsLoading(true);
    setVaultEmailEventsMessage("");

    try {
      const response = await apiFetch(`/api/vault-email-events?id=${encodeURIComponent(eventId)}`, {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to delete inbound email log entry.");
      }

      setVaultEmailEvents(payload.events || []);
      setVaultEmailEventsMessage("Inbound email log entry deleted.");
    } catch (deleteError) {
      setVaultEmailEventsMessage(deleteError.message || "Unable to delete inbound email log entry.");
    } finally {
      setVaultEmailEventsLoading(false);
    }
  };

  const deleteAllVaultEmailEvents = async () => {
    const confirmed = window.confirm("Delete ALL inbound email log entries? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    setVaultEmailEventsLoading(true);
    setVaultEmailEventsMessage("");

    try {
      const response = await apiFetch("/api/vault-email-events?all=1", {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to clear inbound email log.");
      }

      setVaultEmailEvents(payload.events || []);
      setVaultEmailEventsMessage(`Deleted ${payload.deletedCount || 0} inbound email log entries.`);
    } catch (deleteError) {
      setVaultEmailEventsMessage(deleteError.message || "Unable to clear inbound email log.");
    } finally {
      setVaultEmailEventsLoading(false);
    }
  };

  const setViewerActive = async (email, isActive) => {
    setAdminUsersSaving(true);
    setAdminUsersMessage("");

    try {
      const response = await apiFetch("/api/admin-users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, isActive }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to update viewer.");
      }

      setAdminUsers(payload.users || []);
      setAdminUsersMessage(payload.message || "Viewer updated.");
    } catch (updateError) {
      setAdminUsersMessage(updateError.message || "Unable to update viewer.");
    } finally {
      setAdminUsersSaving(false);
    }
  };

  const removeViewerUser = async (email) => {
    const confirmed = window.confirm(`Remove ${email} from approved viewers?`);
    if (!confirmed) {
      return;
    }

    setAdminUsersSaving(true);
    setAdminUsersMessage("");

    try {
      const response = await apiFetch(`/api/admin-users?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Unable to remove viewer.");
      }

      setAdminUsers(payload.users || []);
      setAdminUsersMessage(payload.message || "Viewer removed.");
    } catch (removeError) {
      setAdminUsersMessage(removeError.message || "Unable to remove viewer.");
    } finally {
      setAdminUsersSaving(false);
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

        const { data } = client.auth.onAuthStateChange((event, nextSession) => {
          if (!isActive) {
            return;
          }

          setSession(nextSession);
          setAuthError("");

          if (event === "SIGNED_OUT" || !nextSession) {
            setAppUser(null);
          }
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
      setProfileNotifyAddedHotOnly(false);
      setProfileNotifyPurchasableHotOnly(false);
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
      setBrowserRefreshGloballyEnabled(true);
      setServerRefreshDaytimeIntervalEnabled(true);
      setServerRefreshOvernightEnabled(false);
      setServerRefreshIntervalMinutes(30);
      setServerRefreshSaving(false);
      setServerRefreshMessage("");
      setVercelSpendWebhookSettings(null);
      setVercelSpendWebhookEnabled(true);
      setVercelSpendNotifyBillingCycleEnd(true);
      setVercelSpendCriticalBudgetReached(true);
      setVercelSpendCriticalBillingCycleEnd(false);
      setVercelSpendWebhookUrl("");
      setVercelSpendWebhookSecretConfigured(false);
      setVercelSpendWebhookSaving(false);
      setVercelSpendWebhookMessage("");
      setRemoteBrowserConfigured(false);
      setRemoteBrowserDashboardUrl("");
      setRemoteBrowserStatus(null);
      setRemoteBrowserLoading(false);
      setRemoteBrowserMessage("");
      setRemoteBrowserOpeningKey("");
      setAdminUsers([]);
      setAdminUsersLoading(false);
      setAdminUsersSaving(false);
      setAdminUsersMessage("");
      setNewViewerEmail("");
      setVaultEmailEvents([]);
      setVaultEmailEventsLoading(false);
      setVaultEmailEventsMessage("");
      return;
    }

    loadAppUser();
  }, [authReady, authConfig, session]);

  useEffect(() => {
    if (!authReady || !authConfig?.configured || !session || !appUser) {
      return;
    }

    loadLatestSnapshot();
    loadChangeNotifications().catch((loadError) => {
      setChangeInboxMessage(loadError.message || "Unable to load change notifications.");
    });
    loadHotItems().catch((loadError) => {
      setHotStorageConfigured(false);
      setHotStorageMessage(loadError.message || "Unable to load hot items.");
    });
    if (appUser.role === "admin") {
      loadServerRefreshSettings().catch((loadError) => {
        setServerRefreshMessage(loadError.message || "Unable to load server refresh settings.");
      });
      loadVercelSpendWebhookSettings().catch((loadError) => {
        setVercelSpendWebhookMessage(loadError.message || "Unable to load Billing Alerts settings.");
      });
      loadRemoteBrowserStatus().catch((loadError) => {
        setRemoteBrowserMessage(loadError.message || "Unable to load remote browser status.");
      });
      loadAdminUsers().catch((loadError) => {
        setAdminUsersMessage(loadError.message || "Unable to load users.");
      });
      loadVaultEmailEvents().catch((loadError) => {
        setVaultEmailEventsMessage(loadError.message || "Unable to load inbound email log.");
      });
    }
  }, [authReady, authConfig, session, appUser?.email, appUser?.role]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRefreshWindowNow(Date.now());
    }, 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (manualBlockedRefreshCooldownSeconds <= 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setManualBlockedRefreshCooldownSeconds((currentValue) => {
        if (currentValue <= 1) {
          return 0;
        }

        return currentValue - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [manualBlockedRefreshCooldownSeconds]);

  useEffect(() => {
    if (!authReady || !authConfig?.configured || !session) {
      setIsLiveSyncOwner(true);
      return undefined;
    }

    const tabId = liveSyncTabIdRef.current;
    const channel =
      typeof window.BroadcastChannel === "function" ? new window.BroadcastChannel(LIVE_SYNC_BROADCAST_CHANNEL) : null;
    liveSyncChannelRef.current = channel;

    const claimLease = () => {
      try {
        window.localStorage.setItem(
          LIVE_SYNC_LEASE_KEY,
          JSON.stringify({
            tabId,
            expiresAt: Date.now() + LIVE_SYNC_LEASE_MS,
          }),
        );
      } catch {
        // Ignore storage write failures and fall back to the current tab.
      }

      setIsLiveSyncOwner(true);
    };

    const releaseLease = () => {
      const activeLease = readLiveSyncLease();
      if (activeLease?.tabId === tabId) {
        try {
          window.localStorage.removeItem(LIVE_SYNC_LEASE_KEY);
        } catch {
          // Ignore storage removal failures.
        }
      }

      setIsLiveSyncOwner(false);
    };

    const reconcileLeaseOwnership = ({ preferClaim = false } = {}) => {
      const isVisible = document.visibilityState === "visible";
      const activeLease = readLiveSyncLease();
      const leaseExpired = !activeLease || Number(activeLease.expiresAt) <= Date.now();
      const leaseOwnedByThisTab = activeLease?.tabId === tabId;

      if (!isVisible) {
        if (leaseOwnedByThisTab) {
          releaseLease();
        } else {
          setIsLiveSyncOwner(false);
        }
        return;
      }

      if (preferClaim || leaseOwnedByThisTab || leaseExpired) {
        claimLease();
        return;
      }

      setIsLiveSyncOwner(false);
    };

    const handleVisibilityOrFocus = () => {
      reconcileLeaseOwnership({ preferClaim: document.visibilityState === "visible" });
    };

    const handleStorageChange = (event) => {
      if (event.key !== LIVE_SYNC_LEASE_KEY) {
        return;
      }

      reconcileLeaseOwnership();
    };

    const handleBroadcast = (event) => {
      const message = event?.data;
      if (!message?.type) {
        return;
      }

      if (message.type === "app-user-refreshed" && message.payload) {
        handleLiveServerRefreshUpdate(message.payload);
        applyAppUserPayload(message.payload, { syncProfileFields: false });
        return;
      }

      if (message.type === "server-refresh-updated" && message.payload) {
        handleLiveServerRefreshUpdate(message.payload);
        return;
      }

      if (message.type === "vault-key-updated" && message.payload) {
        handleLiveServerRefreshUpdate(message.payload);
        applyLiveVaultKeyUpdate(message.payload);
      }
    };

    reconcileLeaseOwnership({ preferClaim: true });

    const heartbeatId = window.setInterval(() => {
      reconcileLeaseOwnership();
    }, LIVE_SYNC_HEARTBEAT_MS);

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("pagehide", releaseLease);
    window.addEventListener("beforeunload", releaseLease);
    if (channel) {
      channel.addEventListener("message", handleBroadcast);
    }

    return () => {
      window.clearInterval(heartbeatId);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("pagehide", releaseLease);
      window.removeEventListener("beforeunload", releaseLease);
      if (channel) {
        channel.removeEventListener("message", handleBroadcast);
        channel.close();
      }
      liveSyncChannelRef.current = null;
      releaseLease();
    };
  }, [authReady, authConfig, session]);

  useEffect(() => {
    if (!authReady || !authConfig?.configured || !session || !isLiveSyncOwner) {
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
        broadcastLiveSyncMessage("app-user-refreshed", payload);
      } catch {
        // Ignore background refresh failures and keep the current session intact.
      }
    };

    const handleUserVisible = () => {
      if (document.visibilityState === "visible") {
        refreshAppUserFromServer();
      }
    };

    refreshAppUserFromServer();

    const intervalId = window.setInterval(() => {
      refreshAppUserFromServer();
    }, AUTH_SYNC_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleUserVisible);
    window.addEventListener("focus", handleUserVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleUserVisible);
      window.removeEventListener("focus", handleUserVisible);
    };
  }, [authReady, authConfig, session, isLiveSyncOwner]);

  useEffect(() => {
    if (!authReady || !authConfig?.configured || !session || !isLiveSyncOwner) {
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
              broadcastLiveSyncMessage("server-refresh-updated", payload);
            }

            if (eventName === "vault-key-updated") {
              handleLiveServerRefreshUpdate(payload);
              applyLiveVaultKeyUpdate(payload);
              broadcastLiveSyncMessage("vault-key-updated", payload);
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
  }, [authReady, authConfig, session, isLiveSyncOwner]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage access failures and keep theme switching working.
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(IN_APP_NOTIFICATIONS_KEY, inAppNotificationsEnabled ? "on" : "off");
    } catch {
      // Ignore storage failures and keep the mute toggle working for this session.
    }
  }, [inAppNotificationsEnabled]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    runScanRef.current = runScan;
  }, [
    data,
    loading,
    changeFeed,
    refreshIntervalSeconds,
    autoRefreshEnabled,
    browserRefreshGloballyEnabled,
    refreshWindowStatus.allowed,
    refreshWindowStatus.blockedReason,
    refreshWindowStatus.nextAllowedLabel,
  ]);

  useEffect(() => {
    loadLatestSnapshotRef.current = loadLatestSnapshot;
  }, [loadLatestSnapshot]);

  useEffect(() => {
    loadServerRefreshSettingsRef.current = loadServerRefreshSettings;
  }, [loadServerRefreshSettings]);

  useEffect(() => {
    loadVercelSpendWebhookSettingsRef.current = loadVercelSpendWebhookSettings;
  }, [loadVercelSpendWebhookSettings]);

  useEffect(() => {
    loadRemoteBrowserStatusRef.current = loadRemoteBrowserStatus;
  }, [loadRemoteBrowserStatus]);

  useEffect(() => {
    appUserRef.current = appUser;
  }, [appUser]);

  useEffect(() => {
    if (!changeAlert) {
      previousAlertSignatureRef.current = "";
      return;
    }

    if (!inAppNotificationsEnabled) {
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
  }, [changeAlert, inAppNotificationsEnabled]);

  useEffect(() => {
    if (autoRefreshEnabled && browserRefreshAllowed) {
      setCountdown(refreshIntervalSeconds);
    }
  }, [refreshIntervalSeconds, autoRefreshEnabled, browserRefreshAllowed]);

  useEffect(() => {
    if (!appUser || appUser.role === "admin" || VIEWER_REFRESH_RATE_OPTIONS.includes(refreshIntervalSeconds)) {
      return;
    }

    setRefreshIntervalSeconds(5);
    setCountdown(5);
  }, [appUser, refreshIntervalSeconds]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCountdown((previousValue) => {
        if (!autoRefreshEnabled || !browserRefreshAllowed) {
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
  }, [refreshIntervalSeconds, autoRefreshEnabled, browserRefreshAllowed]);

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

  const browserRefreshRateOptions = appUser?.role === "admin" ? REFRESH_RATE_OPTIONS : VIEWER_REFRESH_RATE_OPTIONS;
  const effectiveServerRefreshDaytimeIntervalEnabled =
    typeof serverRefreshSettings?.settings?.daytimeIntervalEnabled === "boolean"
      ? serverRefreshSettings.settings.daytimeIntervalEnabled !== false
      : serverRefreshDaytimeIntervalEnabled;
  const effectiveServerRefreshOvernightEnabled =
    typeof serverRefreshSettings?.settings?.overnightScheduleEnabled === "boolean"
      ? Boolean(serverRefreshSettings.settings.overnightScheduleEnabled)
      : serverRefreshOvernightEnabled;
  const effectiveServerRefreshIntervalMinutes =
    Number(serverRefreshSettings?.settings?.intervalMinutes || serverRefreshIntervalMinutes) || 30;
  const effectiveServerRefreshEnabled = effectiveServerRefreshDaytimeIntervalEnabled;
  const browserRefreshStatusLabel = formatBrowserRefreshStatus({
    localEnabled: autoRefreshEnabled,
    globalEnabled: browserRefreshGloballyEnabled,
    refreshWindowAllowed: refreshWindowStatus.allowed,
    refreshWindowBlockedReason: refreshWindowStatus.blockedReason,
    nextAllowedLabel: refreshWindowStatus.nextAllowedLabel,
    loading,
    countdown,
  });
  const browserRefreshBlocked = !browserRefreshGloballyEnabled || !refreshWindowStatus.allowed;
  const browserRefreshDisabledReason = !browserRefreshGloballyEnabled
    ? "Disabled on the Server Page."
    : !refreshWindowStatus.allowed
    ? `${refreshWindowStatus.blockedReason} Next window: ${refreshWindowStatus.nextAllowedLabel}.`
    : "";
  const manualRefreshButtonDisabled =
    loading ||
    !browserRefreshGloballyEnabled ||
    (!refreshWindowStatus.allowed && manualBlockedRefreshCooldownSeconds > 0);
  const manualRefreshHelperMessage = !browserRefreshGloballyEnabled
    ? "Manual scans are disabled on the Server Page."
    : !refreshWindowStatus.allowed && manualBlockedRefreshCooldownSeconds > 0
    ? `Blocked-window manual scan available again in ${manualBlockedRefreshCooldownSeconds}s.`
    : browserRefreshDisabledReason;

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

  const dismissChangeItem = (section, item) => {
    if (!item?.id) {
      const productId = item?.productId;
      setChangeFeed((previousFeed) => ({
        ...previousFeed,
        [section]: previousFeed[section].filter((changeItem) => changeItem.productId !== productId),
      }));
      return;
    }

    markChangeNotificationsRead({ ids: [item.id] }).catch((readError) => {
      setChangeInboxMessage(readError.message || "Unable to mark notification read.");
    });
  };

  const clearChangeSection = (section) => {
    markChangeNotificationsRead({ section }).catch((readError) => {
      setChangeInboxMessage(readError.message || "Unable to mark notifications read.");
    });
  };

  const clearAllChanges = () => {
    setChangeAlert(null);
    markChangeNotificationsRead({ all: true }).catch((readError) => {
      setChangeInboxMessage(readError.message || "Unable to mark notifications read.");
    });
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

    const openVaultSourcePage = () => {
      window.open(ABC_VAULT_URL, "_blank", "noopener,noreferrer");
    };

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(key);
        setVaultKeyCopyMessage("Vault key copied.");
        openVaultSourcePage();
        return;
      }

      const copied = fallbackCopyText(key);
      setVaultKeyCopyMessage(copied ? "Vault key copied." : "Unable to copy the Vault key on this device.");
      if (copied) {
        openVaultSourcePage();
      }
    } catch {
      const copied = fallbackCopyText(key);
      setVaultKeyCopyMessage(copied ? "Vault key copied." : "Unable to copy the Vault key on this device.");
      if (copied) {
        openVaultSourcePage();
      }
    }
  };

  const copyVercelSpendWebhookUrl = async () => {
    if (!vercelSpendWebhookUrl) {
      setVercelSpendWebhookMessage("Webhook URL is not available yet.");
      return;
    }

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(vercelSpendWebhookUrl);
        setVercelSpendWebhookMessage("Webhook URL copied.");
        return;
      }

      const copied = fallbackCopyText(vercelSpendWebhookUrl);
      setVercelSpendWebhookMessage(copied ? "Webhook URL copied." : "Unable to copy the webhook URL on this device.");
    } catch {
      const copied = fallbackCopyText(vercelSpendWebhookUrl);
      setVercelSpendWebhookMessage(copied ? "Webhook URL copied." : "Unable to copy the webhook URL on this device.");
    }
  };

  const copyLatestVaultKeyToClipboard = async () => {
    const key = (appUser?.vaultKeyCode || "").trim();
    if (!key) {
      return false;
    }

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(key);
        return true;
      }

      return fallbackCopyText(key);
    } catch {
      return fallbackCopyText(key);
    }
  };

  const rememberPendingVaultProduct = (item) => {
    const product = {
      productName: item.productName || "Vault product",
      productUrl: item.productUrl,
      imageUrl: item.imageUrl || "",
      imageAlt: item.imageAlt || item.productName || "Vault product image",
      savedAt: new Date().toISOString(),
    };

    setPendingVaultProduct(product);
    savePendingVaultProduct(product);
    return product;
  };

  const dismissPendingVaultProduct = () => {
    setPendingVaultProduct(null);
    clearPendingVaultProductStorage();
  };

  const reopenPendingVaultProduct = async () => {
    if (!pendingVaultProduct?.productUrl) {
      return;
    }

    const copied = await copyLatestVaultKeyToClipboard();
    setVaultKeyCopyMessage(copied ? "Vault key copied. Reopening saved product link." : "Reopening saved product link.");
    window.open(pendingVaultProduct.productUrl, "_blank", "noopener,noreferrer");
  };

  const copyVaultKeyAndOpenProductLink = async (event, item) => {
    if (!item?.productUrl) {
      return;
    }

    event.preventDefault();
    rememberPendingVaultProduct(item);
    const productWindow = window.open("about:blank", "_blank");

    if (productWindow) {
      productWindow.opener = null;
    }

    const openProduct = () => {
      if (productWindow) {
        productWindow.location.href = item.productUrl;
        return;
      }

      window.open(item.productUrl, "_blank", "noopener,noreferrer");
    };

    const key = (appUser?.vaultKeyCode || "").trim();
    if (!key) {
      setVaultKeyCopyMessage("No Vault key is stored yet. Opening product page.");
      openProduct();
      return;
    }

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(key);
        setVaultKeyCopyMessage("Vault key copied. Opening product page.");
        openProduct();
        return;
      }

      const copied = fallbackCopyText(key);
      setVaultKeyCopyMessage(copied ? "Vault key copied. Opening product page." : "Unable to copy the Vault key on this device. Opening product page.");
      openProduct();
    } catch {
      const copied = fallbackCopyText(key);
      setVaultKeyCopyMessage(copied ? "Vault key copied. Opening product page." : "Unable to copy the Vault key on this device. Opening product page.");
      openProduct();
    }
  };

  const getRemoteOpenItemKey = (item) => item?.productId || item?.productName || item?.productUrl || "";

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
            "This email is approved, but first-time sign-in is taking the scenic route right now. Please try again in a moment or ask an admin to finish the sign-in setup.",
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
            <h1>Polishing the vault dashboard</h1>
            <p className="hero-copy">Checking your access pass and warming up the scanner for a smooth start.</p>
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
            <div className="eyebrow">Sign-In Setup Needed</div>
            <h1>The sign-in gate is still waking up</h1>
            <p className="hero-copy">
              A few invite-only sign-in settings still need to be connected before this dashboard can open.
              Once an admin finishes that setup, the vault doors will be ready.
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
            <h1 id="sign-in-title">Sign in to enter the vault tracker</h1>
            <p className="hero-copy">
              Use your approved email address and we will send a one-time passcode. Only invited guests can open the vault
              doors.
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
            <h1>Checking your invite list pass</h1>
            <p className="hero-copy">
              You are signed in. We are making sure your invite is ready before opening the live scanner.
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
        ${selectedProductImage
          ? html`
              <section className="image-lightbox" role="dialog" aria-modal="true" aria-label=${`Larger image for ${selectedProductImage.productName}`}>
                <button className="image-lightbox-backdrop" type="button" onClick=${() => setSelectedProductImage(null)} aria-label="Close image preview"></button>
                <div className="image-lightbox-panel">
                  <button className="change-toast-close image-lightbox-close" type="button" onClick=${() => setSelectedProductImage(null)}>
                    Close
                  </button>
                  <img
                    className="image-lightbox-img"
                    src=${selectedProductImage.imageUrl}
                    alt=${selectedProductImage.imageAlt || selectedProductImage.productName || ""}
                    referrerPolicy="no-referrer"
                  />
                  <div className="image-lightbox-title">${selectedProductImage.productName}</div>
                </div>
              </section>
            `
          : null}
        ${pendingVaultProduct
          ? html`
              <section className="vault-product-helper" role="dialog" aria-live="polite" aria-label="Saved Vault product link">
                <div className="vault-product-helper-panel">
                  <button className="change-toast-close vault-product-helper-close" type="button" onClick=${dismissPendingVaultProduct}>
                    Close
                  </button>
                  ${pendingVaultProduct.imageUrl
                    ? html`
                        <img
                          className="vault-product-helper-image"
                          src=${pendingVaultProduct.imageUrl}
                          alt=${pendingVaultProduct.imageAlt || pendingVaultProduct.productName || ""}
                          referrerPolicy="no-referrer"
                        />
                      `
                    : null}
                  <div>
                    <div className="manager-kicker">Saved product link</div>
                    <h2 className="vault-product-helper-title">${pendingVaultProduct.productName}</h2>
                    <p className="section-note">
                      If ABC sent you to login, finish login in the new tab, then use Reopen product to return to this exact bottle.
                    </p>
                    <div className="vault-product-helper-url">${pendingVaultProduct.productUrl}</div>
                  </div>
                  <div className="vault-product-helper-actions">
                    <button className="button button-primary vault-product-helper-primary" type="button" onClick=${reopenPendingVaultProduct}>
                      Reopen product
                    </button>
                  </div>
                </div>
              </section>
            `
          : null}
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
            <div className="hero-title-stack">
              <h1 id="dashboard-title">ABC Vault listing tracker</h1>
                    <button
                      className="button button-primary hero-scan-button"
                      type="button"
                      onClick=${runScan}
                      disabled=${manualRefreshButtonDisabled}
                    >
                      ${loading
                        ? "Scanning live HTML..."
                        : !refreshWindowStatus.allowed && manualBlockedRefreshCooldownSeconds > 0
                        ? `Run fresh scan (${manualBlockedRefreshCooldownSeconds}s)`
                        : "Run fresh scan"}
                    </button>
                    ${manualRefreshHelperMessage ? html`<p className="section-note section-note-nowrap">${manualRefreshHelperMessage}</p>` : null}
                  </div>
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
          <div className="hero-actions hero-nav-actions" aria-label="Primary navigation">
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
                    className=${`button button-secondary ${
                      activePage === "settings" ||
                      activePage === "server-refresh" ||
                      activePage === "billing-alerts" ||
                      activePage === "hot-manager" ||
                      activePage === "user-manager" ||
                      activePage === "vault-email-events"
                        ? "page-nav-active"
                        : ""
                    }`}
                    type="button"
                    onClick=${() => setActivePage("settings")}
                  >
                    Settings
                  </button>
                `
              : null}
            <a className="button button-secondary" href=${ABC_VAULT_SHOP_URL} target="_blank" rel="noopener noreferrer">
              Vault Link
            </a>
            ${appUser.role === "admin"
              ? html`
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick=${openVaultLinkOnRemoteBrowser}
                    disabled=${Boolean(remoteBrowserOpeningKey)}
                  >
                    ${remoteBrowserOpeningKey === "vault-link" ? "Opening VPS..." : "Open VPS"}
                  </button>
                `
              : null}
          </div>
          ${activePage === "listings"
            ? html`
                <div className="scan-meta">
                  <div className="countdown-row" aria-live="polite">
                    <strong>Next auto refresh:</strong>
                    <span className="countdown-status-text">${browserRefreshStatusLabel}</span>
                  </div>
                  <div className="refresh-controls-row">
                    <div className="refresh-rate-row">
                      <strong>Refresh rate:</strong>
                      <div className="refresh-rate-group" role="group" aria-label="Auto refresh rate">
                        ${browserRefreshRateOptions.map(
                          (seconds) => html`
                            <button
                              className=${`button button-secondary button-small ${refreshIntervalSeconds === seconds ? "refresh-rate-active" : ""}`}
                              type="button"
                              onClick=${() => setRefreshIntervalSeconds(seconds)}
                              aria-pressed=${refreshIntervalSeconds === seconds}
                              disabled=${browserRefreshBlocked}
                            >
                              ${seconds}s
                            </button>
                          `,
                        )}
                      </div>
                    </div>
                    <div className="refresh-rate-row">
                      <div className="inline-control-pair">
                        <div>
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
                              disabled=${browserRefreshBlocked}
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
                        <div>
                          <strong>In-app notifications:</strong>
                          <div className="refresh-rate-group" role="group" aria-label="In-app notification controls">
                            <button
                              className=${`button button-secondary button-small ${inAppNotificationsEnabled ? "refresh-rate-active" : ""}`}
                              type="button"
                              onClick=${() => setInAppNotificationsEnabled(true)}
                              aria-pressed=${inAppNotificationsEnabled}
                            >
                              On
                            </button>
                            <button
                              className=${`button button-secondary button-small ${!inAppNotificationsEnabled ? "refresh-rate-active" : ""}`}
                              type="button"
                              onClick=${() => {
                                setInAppNotificationsEnabled(false);
                                setChangeAlert(null);
                                setVaultKeyToast(null);
                                setCelebrationBurst(null);
                              }}
                              aria-pressed=${!inAppNotificationsEnabled}
                            >
                              Off
                            </button>
                          </div>
                        </div>
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
                                  effectiveServerRefreshEnabled,
                                  effectiveServerRefreshIntervalMinutes,
                                  {
                                    daytimeIntervalEnabled: effectiveServerRefreshDaytimeIntervalEnabled,
                                    overnightScheduleEnabled: effectiveServerRefreshOvernightEnabled,
                                  },
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
                  ${renderStatPreview(data?.products || [], "No products in the current snapshot.", {
                    limit: 2,
                    showFullListOnHover: true,
                  })}
                </div>
                <div className="stat-card" role="listitem">
                  <div className="stat-number">${hotItems.length}</div>
                  <div className="stat-label">Hot items</div>
                  ${renderStatPreview(hotProducts, "No hot items yet.", {
                    limit: 2,
                    showFullListOnHover: true,
                  })}
                </div>
                <div className="stat-card" role="listitem">
                  <div className="stat-number">${notPurchasableCount}</div>
                  <div className="stat-label">Not purchasable on listing page</div>
                  ${renderStatPreview(notPurchasableProducts, "Everything is purchasable right now.", {
                    limit: 2,
                    showFullListOnHover: true,
                  })}
                </div>
                <div className="stat-card" role="listitem">
                  <div className="stat-number">${changeCounts.added}</div>
                  <div className="stat-label">Unread added items</div>
                  ${renderStatPreview(changeFeed.added, "No unread added items.", {
                    limit: 2,
                    showFullListOnHover: true,
                  })}
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
                  <p className="section-note">Unread scan messages are saved like an inbox and stay here until you mark them read.</p>
                  ${changeInboxMessage ? html`<p className="section-note">${changeInboxMessage}</p>` : null}
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
                                          <strong>${renderLinkedProductName(item, copyVaultKeyAndOpenProductLink)}</strong>
                                          <div className="change-item-meta">${formatScanTime(item.detectedAt)}</div>
                                        </div>
                                        <button
                                          className="text-button"
                                          type="button"
                                          onClick=${() => dismissChangeItem("added", item)}
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
                                          <strong>${renderLinkedProductName(item, copyVaultKeyAndOpenProductLink)}</strong>
                                          <div className="change-item-meta">
                                            ${formatScanTime(item.detectedAt)}
                                          </div>
                                          <ul className="change-detail-list">
                                            ${buildChangeDescriptions(item).map(
                                              (description) => html`<li>${description}</li>`,
                                            )}
                                          </ul>
                                        </div>
                                        <button
                                          className="text-button"
                                          type="button"
                                          onClick=${() => dismissChangeItem("changed", item)}
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
                                          <strong>${renderLinkedProductName(item, copyVaultKeyAndOpenProductLink)}</strong>
                                          <div className="change-item-meta">${formatScanTime(item.detectedAt)}</div>
                                        </div>
                                        <button
                                          className="text-button"
                                          type="button"
                                          onClick=${() => dismissChangeItem("removed", item)}
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
                      <a className="product-link" href=${vaultEmailAppUrl} target="_blank" rel="noopener noreferrer">
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
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${profileNotifyAddedHotOnly ? "profile-critical-active" : ""}`}
                          onClick=${(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileNotifyAddedHotOnly((currentValue) => !currentValue);
                          }}
                        >
                          Hot only
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
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${profileNotifyPurchasableHotOnly ? "profile-critical-active" : ""}`}
                          onClick=${(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setProfileNotifyPurchasableHotOnly((currentValue) => !currentValue);
                          }}
                        >
                          Hot only
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
                        <h3 className="manager-title">User management</h3>
                        <p className="section-note">Add approved viewers and manage non-admin accounts.</p>
                        <div className="change-toast-actions">
                          <button className="button button-secondary" onClick=${() => setActivePage("user-manager")}>
                            Manage users
                          </button>
                        </div>
                      </article>
                      <article className="manager-card">
                        <div className="manager-kicker">Admin</div>
                        <h3 className="manager-title">Inbound email log</h3>
                        <p className="section-note">Review CloudMailin deliveries, Gmail forwarding codes, and Vault invite processing.</p>
                        <div className="change-toast-actions">
                          <button className="button button-secondary" onClick=${() => setActivePage("vault-email-events")}>
                            Open email log
                          </button>
                        </div>
                      </article>
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
                        <h3 className="manager-title">Billing Alerts</h3>
                        <p className="section-note">Manage the Vercel spend webhook and Pushover alerts for budget thresholds and billing cycle end.</p>
                        <div className="change-toast-actions">
                          <button className="button button-secondary" onClick=${() => setActivePage("billing-alerts")}>
                            Open Billing Alerts
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
        : activePage === "vault-email-events"
        ? html`
            <section className="surface manager-surface">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">Inbound Email Log</h2>
                  <p className="section-note">
                    Stored CloudMailin webhook deliveries, including Gmail forwarding confirmation codes and Vault invite processing.
                  </p>
                </div>
                <button className="button button-secondary" onClick=${() => setActivePage("settings")}>
                  Back to settings
                </button>
              </div>
              <div className="profile-grid">
                <article className="manager-card">
                  <div className="manager-kicker">CloudMailin</div>
                  <h3 className="manager-title">Latest inbound messages</h3>
                  <p className="section-note">
                    If CloudMailin hides a successful response, this log keeps the parsed confirmation code, links, and processing result.
                  </p>
                  <div className="change-toast-actions">
                    <button className="button button-primary" onClick=${loadVaultEmailEvents} disabled=${vaultEmailEventsLoading}>
                      ${vaultEmailEventsLoading ? "Refreshing email log..." : "Refresh email log"}
                    </button>
                    <button
                      className="button button-secondary"
                      onClick=${deleteAllVaultEmailEvents}
                      disabled=${vaultEmailEventsLoading || !vaultEmailEvents.length}
                    >
                      Clear all email logs
                    </button>
                  </div>
                  ${vaultEmailEventsMessage ? html`<div className="scan-status">${vaultEmailEventsMessage}</div>` : null}
                </article>
              </div>
              <div className="manager-list">
                ${vaultEmailEventsLoading && !vaultEmailEvents.length
                  ? html`<div className="empty-state">Loading inbound email events...</div>`
                  : vaultEmailEvents.length
                  ? vaultEmailEvents.map((event) => renderVaultEmailEvent(event, deleteVaultEmailEvent))
                  : html`<div className="empty-state">No inbound email events stored yet. Retry a CloudMailin message or wait for the next delivery.</div>`}
              </div>
            </section>
          `
        : activePage === "user-manager"
        ? html`
            <section className="surface manager-surface">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">User Management</h2>
                  <p className="section-note">Admins can add approved viewers and manage non-admin accounts.</p>
                </div>
                <button className="button button-secondary" onClick=${() => setActivePage("settings")}>
                  Back to settings
                </button>
              </div>
              <div className="profile-grid">
                <article className="manager-card">
                  <div className="manager-kicker">Add Viewer</div>
                  <h3 className="manager-title">Create approved viewer</h3>
                  <p className="section-note">Viewer users can sign in and view the listings, but they do not get admin settings.</p>
                  <form className="auth-form" onSubmit=${addViewerUser}>
                    <label className="auth-field">
                      <span className="filter-label">Viewer email</span>
                      <input
                        className="auth-input"
                        type="email"
                        value=${newViewerEmail}
                        onInput=${(event) => setNewViewerEmail(event.target.value)}
                        placeholder="viewer@example.com"
                        disabled=${adminUsersSaving}
                      />
                    </label>
                    <div className="change-toast-actions">
                      <button className="button button-primary" type="submit" disabled=${adminUsersSaving}>
                        ${adminUsersSaving ? "Adding viewer..." : "Add viewer"}
                      </button>
                      <button className="button button-secondary" type="button" onClick=${loadAdminUsers} disabled=${adminUsersLoading}>
                        ${adminUsersLoading ? "Refreshing..." : "Refresh users"}
                      </button>
                    </div>
                  </form>
                  ${adminUsersMessage ? html`<div className="scan-status">${adminUsersMessage}</div>` : null}
                </article>
              </div>
              <div className="manager-list">
                ${adminUsersLoading && !adminUsers.length
                  ? html`<div className="empty-state">Loading users...</div>`
                  : adminUsers.length
                  ? adminUsers.map(
                      (user) => html`
                        <article className="manager-card" key=${`user-${user.email}`}>
                          <div className="manager-card-head">
                            <div>
                              <div className="manager-kicker">${user.role === "admin" ? "Admin" : "Viewer"}</div>
                              <h3 className="manager-title">${user.email}</h3>
                            </div>
                            <span className=${`pill ${user.isActive ? "pill-yes" : "pill-no"}`}>
                              ${user.isActive ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <div className="manager-meta">
                            <span>Role: ${user.role}</span>
                            <span>Last login: ${user.lastLoginAt ? formatScanTime(user.lastLoginAt) : "Not recorded yet"}</span>
                            <span>Updated: ${formatScanTime(user.updatedAt)}</span>
                            <span>Created: ${formatScanTime(user.createdAt)}</span>
                          </div>
                          ${user.role === "admin"
                            ? html`<p className="section-note">Admin accounts are managed through the admin allowlist, not this viewer tool.</p>`
                            : html`
                                <div className="change-toast-actions">
                                  <button
                                    className="button button-secondary"
                                    type="button"
                                    onClick=${() => setViewerActive(user.email, !user.isActive)}
                                    disabled=${adminUsersSaving}
                                  >
                                    ${user.isActive ? "Deactivate" : "Reactivate"}
                                  </button>
                                  <button
                                    className="button button-secondary"
                                    type="button"
                                    onClick=${() => removeViewerUser(user.email)}
                                    disabled=${adminUsersSaving}
                                  >
                                    Remove viewer
                                  </button>
                                </div>
                              `}
                        </article>
                      `,
                    )
                  : html`<div className="empty-state">No users found yet.</div>`}
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
                  <div className="manager-meta manager-meta-stack">
                    <span>Hard-coded refresh window: ${serverRefreshSettings?.refreshWindow?.scheduleLabel || refreshWindowStatus.scheduleLabel}</span>
                    <span>
                      Current window status:
                      ${serverRefreshSettings?.refreshWindow?.allowed
                        ? "Refreshes are allowed right now."
                        : serverRefreshSettings?.refreshWindow?.blockedReason || refreshWindowStatus.blockedReason}
                    </span>
                    <span>
                      Next allowed window:
                      ${serverRefreshSettings?.refreshWindow?.allowed
                        ? "Right now"
                        : serverRefreshSettings?.refreshWindow?.nextAllowedLabel || refreshWindowStatus.nextAllowedLabel}
                    </span>
                  </div>
                  <label className="profile-toggle-row">
                    <span>
                      <strong>Enable browser refreshes</strong>
                      <small>Allow browser-triggered refreshes, including Run fresh scan and auto refresh, during the allowed weekday window.</small>
                    </span>
                    <button
                      type="button"
                      className=${`profile-toggle ${browserRefreshGloballyEnabled ? "profile-toggle-on" : ""}`}
                      aria-pressed=${browserRefreshGloballyEnabled}
                      onClick=${() => setBrowserRefreshGloballyEnabled((currentValue) => !currentValue)}
                    >
                      <span className="profile-toggle-knob"></span>
                    </button>
                  </label>
                  <div className="profile-alert-grid">
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Interval inside the daytime refresh window</strong>
                        <small>Runs inside the Monday-Friday, 8:00 AM-5:00 PM ET server refresh window using the interval you pick below.</small>
                      </span>
                      <button
                        type="button"
                        className=${`button button-secondary button-small ${
                          serverRefreshDaytimeIntervalEnabled ? "profile-critical-active" : ""
                        }`}
                        onClick=${() =>
                          setServerRefreshDaytimeIntervalEnabled((currentValue) => !currentValue)}
                      >
                        ${serverRefreshDaytimeIntervalEnabled ? "Selected" : "Enable"}
                      </button>
                    </div>
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Sunday-Friday at 12:30 AM and 1:00 AM ET</strong>
                        <small>Runs twice overnight on Sunday, Monday, Tuesday, Wednesday, Thursday, and Friday, even though browser refreshes stay blocked outside the daytime window.</small>
                      </span>
                      <button
                        type="button"
                        className=${`button button-secondary button-small ${
                          serverRefreshOvernightEnabled ? "profile-critical-active" : ""
                        }`}
                        onClick=${() => setServerRefreshOvernightEnabled((currentValue) => !currentValue)}
                      >
                        ${serverRefreshOvernightEnabled ? "Selected" : "Enable"}
                      </button>
                    </div>
                  </div>
                  ${serverRefreshDaytimeIntervalEnabled
                    ? html`
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
                            onClick=${() => {
                              if (serverRefreshIntervalMinutes === intervalMinutes) {
                                setServerRefreshDaytimeIntervalEnabled(false);
                                return;
                              }

                              setServerRefreshIntervalMinutes(intervalMinutes);
                              setServerRefreshDaytimeIntervalEnabled(true);
                            }}
                          >
                            ${serverRefreshIntervalMinutes === intervalMinutes ? "Unselect" : "Select"}
                          </button>
                        </div>
                      `,
                    )}
                        </div>
                      `
                    : null}
                  <div className="manager-meta manager-meta-stack">
                    <span>
                      Last server-side refresh:
                      ${serverRefreshSettings?.lastServerRefresh?.scannedAt
                        ? formatScanTime(serverRefreshSettings.lastServerRefresh.scannedAt)
                        : "Not run yet"}
                    </span>
                    <span>
                      Selected server rules:
                      ${formatSelectedServerRefreshRules({
                        daytimeIntervalEnabled: effectiveServerRefreshDaytimeIntervalEnabled,
                        overnightScheduleEnabled: effectiveServerRefreshOvernightEnabled,
                        intervalMinutes: effectiveServerRefreshIntervalMinutes,
                      })}
                    </span>
                    <span>
                      Next eligible refresh:
                      ${getNextServerRefreshLabel(serverRefreshSettings, effectiveServerRefreshEnabled, effectiveServerRefreshIntervalMinutes, {
                        daytimeIntervalEnabled: effectiveServerRefreshDaytimeIntervalEnabled,
                        overnightScheduleEnabled: effectiveServerRefreshOvernightEnabled,
                      })}
                    </span>
                    <span>
                      Platform limit:
                      ${serverRefreshSettings?.limitations?.schedulingExplanation ||
                      "Vercel cron jobs wake the server once per minute."}
                    </span>
                    <span>
                      Browser refreshes:
                      ${browserRefreshGloballyEnabled ? "Enabled on Server Page" : "Disabled on Server Page"}
                    </span>
                  </div>
                  ${serverRefreshMessage ? html`<div className="scan-status">${serverRefreshMessage}</div>` : null}
                  <div className="change-toast-actions">
                    <button className="button button-primary" onClick=${saveServerRefreshSettings} disabled=${serverRefreshSaving}>
                      ${serverRefreshSaving ? "Saving schedule..." : "Save server refresh settings"}
                    </button>
                  </div>
                </article>
                <article className="manager-card">
                  <div className="manager-kicker">Remote Browser</div>
                  <h3 className="manager-title">VPS opener status</h3>
                  <p className="section-note">Check the remote browser, open its dashboard, and confirm which page the VPS reached most recently.</p>
                  <div className="manager-meta manager-meta-stack">
                    <span>Status: ${remoteBrowserLoading ? "Checking..." : !remoteBrowserConfigured ? "Not configured" : remoteBrowserStatus?.busy ? "Busy" : "Ready"}</span>
                    <span>Flow mode: ${remoteBrowserStatus?.lastFlowMode || "Direct open"}</span>
                    <span>Vault link: ${remoteBrowserStatus?.lastVaultUrl || "Not used yet"}</span>
                    <span>Last requested URL: ${remoteBrowserStatus?.lastUrl || "Nothing opened yet"}</span>
                    <span>Product link: ${remoteBrowserStatus?.lastProductUrl || "Not used yet"}</span>
                    <span>Last Vault key: ${remoteBrowserStatus?.lastVaultKey || "Not sent yet"}</span>
                    <span>Current page: ${remoteBrowserStatus?.lastFinalUrl || "Unknown"}</span>
                    <span>Page title: ${remoteBrowserStatus?.lastTitle || "Unknown"}</span>
                    <span>Last opened: ${remoteBrowserStatus?.lastOpenedAt ? formatScanTime(remoteBrowserStatus.lastOpenedAt) : "Not opened yet"}</span>
                    <span>Error: ${remoteBrowserStatus?.lastError || "No recent error"}</span>
                  </div>
                  ${remoteBrowserMessage ? html`<div className="scan-status">${remoteBrowserMessage}</div>` : null}
                  <div className="change-toast-actions">
                    <button className="button button-secondary" onClick=${loadRemoteBrowserStatus} disabled=${remoteBrowserLoading}>
                      ${remoteBrowserLoading ? "Refreshing status..." : "Refresh remote browser"}
                    </button>
                    <a
                      className=${`button button-secondary ${!remoteBrowserDashboardUrl ? "button-disabled-link" : ""}`}
                      href=${remoteBrowserDashboardUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled=${!remoteBrowserDashboardUrl}
                      onClick=${(event) => {
                        if (!remoteBrowserDashboardUrl) {
                          event.preventDefault();
                        }
                      }}
                    >
                      Open VPS dashboard
                    </a>
                    <a
                      className=${`button button-secondary ${!remoteBrowserDesktopUrl ? "button-disabled-link" : ""}`}
                      href=${remoteBrowserDesktopUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled=${!remoteBrowserDesktopUrl}
                      onClick=${(event) => {
                        if (!remoteBrowserDesktopUrl) {
                          event.preventDefault();
                        }
                      }}
                    >
                      Open live Chrome
                    </a>
                  </div>
                </article>
              </div>
            </section>
          `
        : activePage === "billing-alerts"
        ? html`
            <section className="surface manager-surface">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">Billing Alerts</h2>
                  <p className="section-note">Admin controls for the Vercel spend webhook and Pushover alerts.</p>
                </div>
                <button className="button button-secondary" onClick=${() => setActivePage("settings")}>
                  Back to settings
                </button>
              </div>
              <div className="profile-grid">
                <article className="manager-card">
                  <div className="manager-kicker">Webhook</div>
                  <h3 className="manager-title">Vercel spend webhook</h3>
                  <p className="section-note">
                    Paste this webhook URL into Vercel Spend Management. Alerts go to admin accounts with Pushover enabled and a saved Pushover User Key.
                  </p>
                  <div className="manager-meta manager-meta-stack">
                    <span>Webhook URL: ${vercelSpendWebhookUrl || "Loading..."}</span>
                    <span>Webhook secret: ${vercelSpendWebhookSecretConfigured ? "Configured on server" : "Missing on server"}</span>
                    <span>Pushover app token: ${pushoverConfigured ? "Configured on server" : "Missing on server"}</span>
                  </div>
                  <div className="change-toast-actions">
                    <button className="button button-secondary" onClick=${copyVercelSpendWebhookUrl} disabled=${!vercelSpendWebhookUrl}>
                      Copy webhook URL
                    </button>
                    <button className="button button-secondary" onClick=${loadVercelSpendWebhookSettings}>
                      Refresh billing settings
                    </button>
                  </div>
                </article>
                <article className="manager-card">
                  <div className="manager-kicker">Alerts</div>
                  <h3 className="manager-title">Notification rules</h3>
                  <label className="profile-toggle-row">
                    <span>
                      <strong>Enable Billing Alerts</strong>
                      <small>Allow the webhook to send Pushover notifications to admin accounts.</small>
                    </span>
                    <button
                      type="button"
                      className=${`profile-toggle ${vercelSpendWebhookEnabled ? "profile-toggle-on" : ""}`}
                      aria-pressed=${vercelSpendWebhookEnabled}
                      onClick=${() => setVercelSpendWebhookEnabled((currentValue) => !currentValue)}
                    >
                      <span className="profile-toggle-knob"></span>
                    </button>
                  </label>
                  <div className="profile-alert-grid">
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Budget reached</strong>
                        <small>Send a push alert when Vercel reports a budget threshold was reached.</small>
                      </span>
                      <button
                        type="button"
                        className=${`button button-secondary button-small ${vercelSpendCriticalBudgetReached ? "profile-critical-active" : ""}`}
                        onClick=${() => setVercelSpendCriticalBudgetReached((currentValue) => !currentValue)}
                      >
                        ${vercelSpendCriticalBudgetReached ? "Critical" : "Normal"}
                      </button>
                    </div>
                    <div className="profile-toggle-row profile-toggle-card">
                      <span>
                        <strong>Billing cycle ended</strong>
                        <small>Send a push alert when Vercel posts the end-of-billing-cycle event.</small>
                      </span>
                      <div className="profile-toggle-pair">
                        <button
                          type="button"
                          className=${`profile-toggle ${vercelSpendNotifyBillingCycleEnd ? "profile-toggle-on" : ""}`}
                          aria-pressed=${vercelSpendNotifyBillingCycleEnd}
                          onClick=${() => setVercelSpendNotifyBillingCycleEnd((currentValue) => !currentValue)}
                        >
                          <span className="profile-toggle-knob"></span>
                        </button>
                        <button
                          type="button"
                          className=${`button button-secondary button-small ${vercelSpendCriticalBillingCycleEnd ? "profile-critical-active" : ""}`}
                          onClick=${() => setVercelSpendCriticalBillingCycleEnd((currentValue) => !currentValue)}
                        >
                          ${vercelSpendCriticalBillingCycleEnd ? "Critical" : "Normal"}
                        </button>
                      </div>
                    </div>
                  </div>
                  ${vercelSpendWebhookMessage ? html`<div className="scan-status">${vercelSpendWebhookMessage}</div>` : null}
                  <div className="change-toast-actions">
                    <button className="button button-primary" onClick=${saveVercelSpendWebhookSettings} disabled=${vercelSpendWebhookSaving}>
                      ${vercelSpendWebhookSaving ? "Saving Billing Alerts..." : "Save Billing Alerts"}
                    </button>
                  </div>
                </article>
                <article className="manager-card">
                  <div className="manager-kicker">Latest webhook</div>
                  <h3 className="manager-title">Last Vercel spend event</h3>
                  <div className="manager-meta manager-meta-stack">
                    <span>Event type: ${formatVercelSpendEventType(vercelSpendWebhookSettings?.lastEventType)}</span>
                    <span>Received: ${vercelSpendWebhookSettings?.lastEventReceivedAt ? formatScanTime(vercelSpendWebhookSettings.lastEventReceivedAt) : "Not received yet"}</span>
                    <span>Message: ${vercelSpendWebhookSettings?.lastEventMessage || "No Vercel spend webhook event has been recorded yet."}</span>
                  </div>
                  ${vercelSpendWebhookSettings?.lastEventPayload
                    ? html`
                        <details className="email-event-preview">
                          <summary>View last webhook payload</summary>
                          <div className="email-event-preview-body">
                            <div className="email-event-preview-label">Stored webhook payload</div>
                            <p>${JSON.stringify(vercelSpendWebhookSettings.lastEventPayload, null, 2)}</p>
                          </div>
                        </details>
                      `
                    : null}
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
                ${appUser?.role === "admin" ? html`<th>Remote</th>` : null}
              </tr>
            </thead>
            <tbody>
              ${filteredProducts.map(
                (item) => html`
                  <tr key=${item.productId || `${item.pageNumber}-${item.lineItemNumber}`}>
                    <td>${item.pageNumber}</td>
                    <td>${item.lineItemNumber}</td>
                    <td className="name-cell">
                      <div className="product-listing-cell">
                        ${renderProductThumbnail(item, "product-thumb", setSelectedProductImage)}
                        <div className="product-name-wrap">
                          ${item.productUrl
                            ? html`
                                <a
                                  className="product-link"
                                  href=${item.productUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick=${(event) => copyVaultKeyAndOpenProductLink(event, item)}
                                >
                                  ${item.productName}
                                </a>
                              `
                            : html`<span>${item.productName}</span>`}
                          ${isHotItem(hotItems, item.productId || item.productName) ? html`<span className="hot-badge" aria-label="Hot item">🔥</span>` : null}
                        </div>
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
                    ${appUser?.role === "admin"
                      ? html`
                          <td>
                            <button
                              className="button button-secondary button-small"
                              type="button"
                              onClick=${() => openOnRemoteBrowser(item)}
                              disabled=${!item.productUrl || Boolean(remoteBrowserOpeningKey)}
                            >
                              ${remoteBrowserOpeningKey === getRemoteOpenItemKey(item) ? "Opening..." : "Open on VPS"}
                            </button>
                          </td>
                        `
                      : null}
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
                  ${renderProductThumbnail(item, "mobile-product-thumb", setSelectedProductImage)}
                  <div>
                    <div className="mobile-card-kicker">Page ${item.pageNumber} | Item ${item.lineItemNumber}</div>
                    <h3 className="mobile-card-title">
                      ${item.productUrl
                        ? html`
                            <a
                              className="product-link"
                              href=${item.productUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick=${(event) => copyVaultKeyAndOpenProductLink(event, item)}
                            >
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
                ${appUser?.role === "admin"
                  ? html`
                      <div className="mobile-card-actions">
                        <button
                          className="button button-secondary button-small"
                          type="button"
                          onClick=${() => openOnRemoteBrowser(item)}
                          disabled=${!item.productUrl || Boolean(remoteBrowserOpeningKey)}
                        >
                          ${remoteBrowserOpeningKey === getRemoteOpenItemKey(item) ? "Opening..." : "Open on VPS"}
                        </button>
                      </div>
                    `
                  : null}
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




