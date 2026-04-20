const { listNotificationRecipients, recordAutoNotificationAttempt, recordNotificationSent } = require("./app-users-db");

const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";
const PUSHOVER_VALIDATE_URL = "https://api.pushover.net/1/users/validate.json";
const CRITICAL_RETRY_SECONDS = 60;
const CRITICAL_EXPIRE_SECONDS = 1800;
const APP_URL = "https://abc-vault-live-scanner.vercel.app/";

function getPushoverAppToken() {
  return (process.env.PUSHOVER_APP_TOKEN || "").trim();
}

function isPushoverConfigured() {
  return Boolean(getPushoverAppToken());
}

function buildFormBody(fields) {
  const body = new URLSearchParams();

  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    body.set(key, String(value));
  });

  return body;
}

function formatListingDetail(item) {
  return `- ${item?.productName || "Unnamed item"}`;
}

function formatChangedDetail(item) {
  const changedFields = (item?.fields || []).map((field) => {
    const labels = {
      productName: "name",
      category: "category",
      bottleSizeDisplay: "bottle size",
      price: "price",
      newBadge: "new badge",
      sourcedCertifiedBadge: "sourced badge",
      isPurchasableFromListingPage: "purchasable status",
      soldOutIndicatorPresent: "sold out status",
      buttonStatesShown: "buttons",
    };

    return labels[field] || field;
  });

  return `- ${item?.productName || "Unnamed item"} | ${changedFields.join(", ")}`;
}

function buildMessage(titleLine, items, formatter, trailingLine = "") {
  const maxCharacters = 1000;
  const baseLines = [titleLine].filter(Boolean);
  const detailLines = [];

  for (const item of items) {
    const nextLine = formatter(item);
    const candidateLines = [...baseLines, ...detailLines, nextLine, trailingLine].filter(Boolean);
    const candidateMessage = candidateLines.join("\n");

    if (candidateMessage.length > maxCharacters) {
      break;
    }

    detailLines.push(nextLine);
  }

  const remainingCount = Math.max(items.length - detailLines.length, 0);
  const moreLine = remainingCount > 0 ? `- Plus ${remainingCount} more item${remainingCount === 1 ? "" : "s"}` : "";

  const lines = [...baseLines, ...detailLines];

  if (moreLine) {
    const candidateLines = [...lines, moreLine, trailingLine].filter(Boolean);
    if (candidateLines.join("\n").length <= maxCharacters) {
      lines.push(moreLine);
    }
  }

  if (trailingLine) {
    const candidateLines = [...lines, trailingLine];
    if (candidateLines.join("\n").length <= maxCharacters) {
      lines.push(trailingLine);
    }
  }

  return lines.join("\n");
}

function buildNotificationEvents(changes, options = {}) {
  const isInitialLoad = Boolean(options.isInitialLoad);
  const vaultStatusTransition = options.vaultStatusTransition || null;
  const purchasableNow = (changes.changed || []).filter(
    (item) => item.fields?.includes("isPurchasableFromListingPage") && item.isPurchasableFromListingPage,
  );

  const events = [];

  if (isInitialLoad && changes.added?.length) {
    events.push({
      key: "initialLoad",
      title: "Initial Load Items",
      message: buildMessage(
        `${changes.added.length} item${changes.added.length === 1 ? "" : "s"} found on initial load:`,
        changes.added,
        formatListingDetail,
      ),
      critical: false,
    });
  }

  if (!isInitialLoad && changes.added?.length) {
    events.push({
      key: "added",
      title: "New Items Added",
      message: buildMessage(
        `${changes.added.length} new item${changes.added.length === 1 ? "" : "s"} added:`,
        changes.added,
        formatListingDetail,
      ),
      critical: false,
    });
  }

  if (changes.changed?.length) {
    events.push({
      key: "changed",
      title: "Items Changed",
      message: buildMessage(
        `${changes.changed.length} item${changes.changed.length === 1 ? "" : "s"} changed:`,
        changes.changed,
        formatChangedDetail,
      ),
      critical: false,
    });
  }

  if (changes.removed?.length) {
    events.push({
      key: "removed",
      title: "Items Removed",
      message: buildMessage(
        `${changes.removed.length} item${changes.removed.length === 1 ? "" : "s"} removed:`,
        changes.removed,
        formatListingDetail,
      ),
      critical: false,
    });
  }

  if (purchasableNow.length) {
    events.push({
      key: "purchasable",
      title: "Items Purchasable Now",
      message: buildMessage(
        `${purchasableNow.length} item${purchasableNow.length === 1 ? "" : "s"} became purchasable:`,
        purchasableNow,
        formatListingDetail,
      ),
      critical: false,
    });
  }

  if (vaultStatusTransition?.previousStatus === "closed" && vaultStatusTransition?.currentStatus === "open") {
    events.push(
      buildVaultClosedEvent({
        previousStatus: "Closed",
        currentStatus: "Open",
        vaultUrl: vaultStatusTransition.vaultUrl,
      }),
    );
  }

  return events;
}

function filterEventsForRecipient(events, recipient) {
  return events
    .filter((event) => {
    if (event.key === "initialLoad") {
      return recipient.notifyInitialLoad || recipient.notifyAdded;
    }

    if (event.key === "added") {
      return recipient.notifyAdded;
    }

    if (event.key === "changed") {
      return recipient.notifyChanged;
    }

    if (event.key === "removed") {
      return recipient.notifyRemoved;
    }

    if (event.key === "purchasable") {
      return recipient.notifyPurchasable;
    }

    if (event.key === "vaultOpen") {
      return recipient.notifyVaultOpen;
    }

    if (event.key === "vaultClosed") {
      return recipient.notifyVaultClosed;
    }

    return false;
  })
    .map((event) => ({
      ...event,
      critical:
        event.key === "initialLoad"
          ? Boolean(recipient.criticalInitialLoad || recipient.criticalAdded)
          : event.key === "added"
          ? Boolean(recipient.criticalAdded)
          : event.key === "changed"
          ? Boolean(recipient.criticalChanged)
          : event.key === "removed"
          ? Boolean(recipient.criticalRemoved)
          : event.key === "purchasable"
          ? Boolean(recipient.criticalPurchasable)
          : event.key === "vaultOpen"
          ? Boolean(recipient.criticalVaultOpen)
          : event.key === "vaultClosed"
          ? Boolean(recipient.criticalVaultClosed)
          : false,
    }));
}

function buildVaultOpenEvent({
  sourceFrom = "",
  sourceSubject = "",
  vaultKeyCode = "",
  vaultUrl = "https://theabcvault.com/",
} = {}) {
  const detailLines = [
    "CloudMailin received a Vault invite email.",
    vaultKeyCode ? `Vault Key: ${vaultKeyCode}` : "",
    sourceSubject ? `Subject: ${sourceSubject}` : "",
    sourceFrom ? `From: ${sourceFrom}` : "",
    "",
    "Tap below to open the ABC Vault site.",
  ].filter(Boolean);

  return {
    key: "vaultOpen",
    title: "Vault Invite",
    message: detailLines.join("\n"),
    url: vaultUrl,
    urlTitle: "Open The ABC Vault",
    critical: false,
  };
}

function buildVaultClosedEvent({
  previousStatus = "Closed",
  currentStatus = "Open",
  vaultUrl = "https://theabcvault.com/",
} = {}) {
  return {
    key: "vaultClosed",
    title: "Vault Opened",
    message: [
      `Vault status changed from ${previousStatus} to ${currentStatus}.`,
      "",
      "Tap below to open the ABC Vault site.",
    ].join("\n"),
    url: vaultUrl,
    urlTitle: "Open The ABC Vault",
    critical: false,
  };
}

async function sendPushoverMessage({ userKey, title, message, url, urlTitle, critical = false }) {
  if (!isPushoverConfigured()) {
    throw new Error("Pushover is not configured. Add PUSHOVER_APP_TOKEN before sending notifications.");
  }

  const response = await fetch(PUSHOVER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: buildFormBody({
      token: getPushoverAppToken(),
      user: userKey,
      title,
      message,
      url: url || "",
      url_title: urlTitle || "",
      sound: critical ? "persistent" : "cashregister",
      priority: critical ? 2 : undefined,
      retry: critical ? CRITICAL_RETRY_SECONDS : undefined,
      expire: critical ? CRITICAL_EXPIRE_SECONDS : undefined,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.status !== 1) {
    throw new Error(payload.errors?.join(" ") || "Pushover message send failed.");
  }

  return payload;
}

async function validatePushoverUserKey(userKey) {
  if (!isPushoverConfigured()) {
    return { status: 1, skipped: true };
  }

  const response = await fetch(PUSHOVER_VALIDATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: buildFormBody({
      token: getPushoverAppToken(),
      user: userKey,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.status !== 1) {
    throw new Error(payload.errors?.join(" ") || "That Pushover User Key could not be validated.");
  }

  return payload;
}

async function notifyUsersAboutChanges(changes, snapshot, options = {}) {
  const vaultStatusTransition = options.vaultStatusTransition || null;
  if (!isPushoverConfigured() || !changes) {
    return { sent: 0, skipped: true };
  }

  if (!changes.totalChanges && !vaultStatusTransition) {
    return { sent: 0, skipped: true };
  }

  const recipients = await listNotificationRecipients();
  if (!recipients.length) {
    return { sent: 0, skipped: true };
  }

  const events = buildNotificationEvents(changes, options);
  const attemptedAt = new Date().toISOString();
  let sent = 0;

  for (const recipient of recipients) {
    if (!recipient.notificationsEnabled) {
      await recordAutoNotificationAttempt(recipient.email, {
        attemptedAt,
        sent: false,
        reason: "Pushover notifications are disabled for this profile.",
        items: events.map((event) => `${event.title}\n${event.message}`).join("\n\n") || "No items",
      });
      continue;
    }

    const recipientEvents = filterEventsForRecipient(events, recipient);

    if (!recipientEvents.length) {
      await recordAutoNotificationAttempt(recipient.email, {
        attemptedAt,
        sent: false,
        reason: "No enabled notification type matched this scan. Check your Initial load / Added / Changed / Removed / Purchasable / Vault alerts settings.",
        items: events.map((event) => `${event.title}\n${event.message}`).join("\n\n") || "No items",
      });
      continue;
    }

    try {
      for (const event of recipientEvents) {
        await sendPushoverMessage({
          userKey: recipient.pushoverUserKey,
          title: event.title,
          message: event.message,
          url: APP_URL,
          urlTitle: "Open ABC Vault Live Scanner",
          critical: event.critical,
        });
      }

      const combinedMessage = recipientEvents.map((event) => `${event.title}\n${event.message}`).join("\n\n");
      await recordAutoNotificationAttempt(recipient.email, {
        attemptedAt,
        sent: true,
        reason: `Sent ${recipientEvents.length} notification${recipientEvents.length === 1 ? "" : "s"} successfully.`,
        items: combinedMessage,
      });
      await recordNotificationSent(recipient.email, combinedMessage, attemptedAt);
      sent += 1;
    } catch (error) {
      await recordAutoNotificationAttempt(recipient.email, {
        attemptedAt,
        sent: false,
        reason: error.message || "Notification send failed.",
        items: recipientEvents.map((event) => `${event.title}\n${event.message}`).join("\n\n"),
      });
      console.error(`Failed to notify ${recipient.email}: ${error.message}`);
    }
  }

  return { sent, skipped: false };
}

async function notifyUsersVaultOpened({
  sourceFrom = "",
  sourceSubject = "",
  vaultKeyCode = "",
  vaultUrl = "https://theabcvault.com/",
} = {}) {
  if (!isPushoverConfigured()) {
    return { sent: 0, skipped: true };
  }

  const recipients = await listNotificationRecipients();
  if (!recipients.length) {
    return { sent: 0, skipped: true };
  }

  const event = buildVaultOpenEvent({ sourceFrom, sourceSubject, vaultKeyCode, vaultUrl });
  const attemptedAt = new Date().toISOString();
  let sent = 0;

  for (const recipient of recipients) {
    if (!recipient.notificationsEnabled) {
      await recordAutoNotificationAttempt(recipient.email, {
        attemptedAt,
        sent: false,
        reason: "Pushover notifications are disabled for this profile.",
        items: `${event.title}\n${event.message}`,
      });
      continue;
    }

    if (!recipient.notifyVaultOpen) {
      await recordAutoNotificationAttempt(recipient.email, {
        attemptedAt,
        sent: false,
        reason: "Vault invite notifications are turned off for this profile.",
        items: `${event.title}\n${event.message}`,
      });
      continue;
    }

    try {
      await sendPushoverMessage({
        userKey: recipient.pushoverUserKey,
        title: event.title,
        message: event.message,
        url: event.url,
        urlTitle: event.urlTitle,
        critical: Boolean(recipient.criticalVaultOpen),
      });

      await recordAutoNotificationAttempt(recipient.email, {
        attemptedAt,
        sent: true,
        reason: "Sent Vault invite notification successfully.",
        items: `${event.title}\n${event.message}`,
      });
      await recordNotificationSent(recipient.email, `${event.title}\n${event.message}`, attemptedAt);
      sent += 1;
    } catch (error) {
      await recordAutoNotificationAttempt(recipient.email, {
        attemptedAt,
        sent: false,
        reason: error.message || "Vault invite notification send failed.",
        items: `${event.title}\n${event.message}`,
      });
      console.error(`Failed to notify ${recipient.email} about Vault invite: ${error.message}`);
    }
  }

  return { sent, skipped: false };
}

module.exports = {
  buildVaultOpenEvent,
  isPushoverConfigured,
  notifyUsersAboutChanges,
  notifyUsersVaultOpened,
  sendPushoverMessage,
  validatePushoverUserKey,
};
