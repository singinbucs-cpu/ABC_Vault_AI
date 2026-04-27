const { findAppUserByVaultForwardingEmail, recordVaultKeyForAllActiveUsers } = require("./app-users-db");
const { notifyRecipientAboutTrackedInboundEmail, notifyUsersVaultOpened } = require("./pushover");
const { saveVaultEmailEvent } = require("./vault-email-events-db");

const DEFAULT_APP_URL = "https://abc-vault-live-scanner.vercel.app/";

function getVaultEmailConfig() {
  return {
    webhookSecret: (process.env.VAULT_EMAIL_WEBHOOK_SECRET || "").trim(),
    forwardingAddress: (process.env.VAULT_EMAIL_FORWARDING_ADDRESS || "").trim(),
    appUrl: (process.env.APP_BASE_URL || DEFAULT_APP_URL).trim() || DEFAULT_APP_URL,
  };
}

function isVaultEmailIngestConfigured() {
  return Boolean(getVaultEmailConfig().webhookSecret);
}

function getHeaderValue(headers, name) {
  if (!headers || typeof headers !== "object") {
    return "";
  }

  return headers[name] || headers[name.toLowerCase()] || "";
}

function getWebhookSecretFromRequest(req) {
  return (
    getHeaderValue(req?.headers, "x-vault-email-secret") ||
    getHeaderValue(req?.headers, "x-webhook-secret") ||
    req?.query?.secret ||
    ""
  )
    .toString()
    .trim();
}

function getBasicAuthPassword(req) {
  const authorization = getHeaderValue(req?.headers, "authorization");
  const match = authorization.match(/^Basic\s+(.+)$/i);
  if (!match?.[1]) {
    return "";
  }

  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) {
      return "";
    }

    return decoded.slice(separatorIndex + 1).trim();
  } catch {
    return "";
  }
}

function isVaultEmailRequestAuthorized(req) {
  const { webhookSecret } = getVaultEmailConfig();
  if (!webhookSecret) {
    return false;
  }

  const sharedSecret = getWebhookSecretFromRequest(req);
  if (sharedSecret === webhookSecret) {
    return true;
  }

  return getBasicAuthPassword(req) === webhookSecret;
}

function decodeHtmlEntities(value) {
  return (value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function stripHtml(value) {
  return decodeHtmlEntities((value || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " "))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeText(value) {
  return (value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

function extractEmailAddresses(value) {
  return Array.from(new Set((value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])).map((item) =>
    item.trim().toLowerCase(),
  );
}

function buildEmailPreview(value) {
  return normalizeText(value).replace(/\s+/g, " ").slice(0, 4000);
}

function isGmailForwardingConfirmation(parsed) {
  const subject = (parsed.subject || "").toLowerCase();
  const from = (parsed.from || "").toLowerCase();

  return from.includes("forwarding-noreply@google.com") || subject.includes("gmail forwarding confirmation");
}

function subjectContainsVaultKeyEnclosed(subject) {
  return (subject || "").toLowerCase().includes("vault key enclosed");
}

function getTrackedInboundEmailNotification(subject = "") {
  const normalizedSubject = String(subject || "").trim();
  const loweredSubject = normalizedSubject.toLowerCase();

  if (loweredSubject.startsWith("your abc fine wine & spirits | vault order confirmation")) {
    return {
      title: "ABC Vault Order Confirmation",
      eventType: "order_confirmation",
    };
  }

  if (loweredSubject.startsWith("cheers! order ") && loweredSubject.includes(" is ready for pickup")) {
    return {
      title: "ABC Vault Pickup Ready",
      eventType: "pickup_ready",
    };
  }

  return null;
}

function extractUrls(value) {
  const decodedValue = decodeHtmlEntities(value || "");
  const urls = decodedValue.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const hrefUrls = Array.from(decodedValue.matchAll(/href=["']([^"']+)["']/gi)).map((match) => match[1]);

  return Array.from(new Set([...urls, ...hrefUrls])).map((url) =>
    decodeHtmlEntities(url).replace(/[).,;]+$/g, ""),
  );
}

function extractGmailForwardingConfirmationCode(text) {
  const normalized = normalizeText(text);
  const labeledCodeMatch = normalized.match(/confirmation\s+code[^0-9]{0,30}([0-9]{6,12})/i);
  if (labeledCodeMatch?.[1]) {
    return labeledCodeMatch[1];
  }

  const codeMatch = normalized.match(/\b[0-9]{6,12}\b/);
  return codeMatch?.[0] || "";
}

function isLikelyVaultCode(value) {
  const candidate = (value || "").trim().toUpperCase();
  if (!candidate || candidate.length < 4 || candidate.length > 64) {
    return false;
  }

  if (!/[0-9]/.test(candidate)) {
    return false;
  }

  return !["VAULT", "CODE", "UNLOCK", "ACCESS"].includes(candidate);
}

function extractVaultKeyCode(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "";
  }

  const patterns = [
    /\bVAULT KEY(?:\s+CODE)?\b[^A-Z0-9]{0,40}([A-Z0-9-]{4,64})\b/i,
    /\bKEY CODE\b[^A-Z0-9]{0,40}([A-Z0-9-]{4,64})\b/i,
    /\bENTER YOUR CODE\b[^A-Z0-9]{0,40}([A-Z0-9-]{4,64})\b/i,
    /\bCODE SHOWN BELOW\b[^A-Z0-9]{0,80}([A-Z0-9-]{4,64})\b/i,
    /\bCODE\b[^A-Z0-9]{0,40}([A-Z0-9-]{4,64})\b/i,
    /\bUNLOCK ACCESS\b[^A-Z0-9]{0,40}([A-Z0-9-]{4,64})\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1] && isLikelyVaultCode(match[1])) {
      return match[1].trim();
    }
  }

  const fallbackMatches = normalized.match(/\b[A-Z0-9-]{6,64}\b/gi) || [];
  const fallbackCode = fallbackMatches.find((candidate) => isLikelyVaultCode(candidate));
  return fallbackCode || "";
}

async function storeVaultEmailEvent(event) {
  try {
    return await saveVaultEmailEvent(event);
  } catch {
    return null;
  }
}

function parseInboundEmailPayload(body = {}) {
  const payload = typeof body === "object" && body ? body : {};
  const headers = payload.headers && typeof payload.headers === "object" ? payload.headers : {};
  const subject = [payload.subject, payload.Subject, headers.subject, getHeaderValue(headers, "subject")].find(Boolean) || "";
  const from = [
    payload.from,
    payload.From,
    payload.sender,
    headers.from,
    payload.envelope?.from,
    getHeaderValue(headers, "from"),
  ].find(Boolean) || "";
  const toValues = [
    payload.to,
    payload.To,
    headers.to,
    headers.delivered_to,
    payload.recipient,
    payload.envelope?.to,
    payload.envelope?.recipients,
    getHeaderValue(headers, "to"),
    getHeaderValue(headers, "delivered-to"),
    getHeaderValue(headers, "x-forwarded-to"),
  ].flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
  const textContent = [
    payload.plain,
    payload.text,
    payload.textBody,
    payload["body-plain"],
    payload.body?.plain,
    payload.body?.text,
    payload.bodyPlain,
  ].find(Boolean) || "";
  const htmlContent = [
    payload.html,
    payload.htmlBody,
    payload["body-html"],
    payload.body?.html,
    payload.bodyHtml,
  ].find(Boolean) || "";
  const receivedAt =
    payload.receivedAt ||
    payload.received_at ||
    payload.timestamp ||
    payload.date ||
    new Date().toISOString();
  const combinedText = [normalizeText(textContent), stripHtml(htmlContent)].filter(Boolean).join("\n\n").trim();

  return {
    subject: normalizeText(subject),
    from: normalizeText(from),
    recipientEmails: Array.from(new Set(toValues.flatMap((value) => extractEmailAddresses(String(value || ""))))),
    senderEmails: extractEmailAddresses(from),
    combinedText,
    rawHtml: normalizeText(htmlContent),
    preview: buildEmailPreview(combinedText || `${subject}\n${from}`),
    receivedAt,
  };
}

async function ingestVaultKeyEmail(body = {}) {
  const parsed = parseInboundEmailPayload(body);
  const searchableText = [parsed.subject, parsed.combinedText, parsed.rawHtml].filter(Boolean).join("\n\n");

  if (isGmailForwardingConfirmation(parsed)) {
    const confirmationCode = extractGmailForwardingConfirmationCode(searchableText);
    const confirmationLinks = extractUrls(searchableText).filter((url) => /google|mail/i.test(url));
    const storedEvent = await storeVaultEmailEvent({
      eventType: "gmail_forwarding_confirmation",
      status: "ignored",
      message: "Gmail forwarding confirmation detected.",
      subject: parsed.subject,
      fromAddress: parsed.from,
      recipientEmails: parsed.recipientEmails,
      candidateEmails: [...parsed.senderEmails, ...parsed.recipientEmails],
      confirmationCode,
      confirmationLinks,
      preview: parsed.preview,
      receivedAt: parsed.receivedAt,
      rawPayload: body,
    });

    return {
      ok: true,
      statusCode: 200,
      payload: {
        ok: true,
        ignored: true,
        type: "gmail_forwarding_confirmation",
        message:
          "Gmail forwarding confirmation detected. This is not a Vault invite. Use the code or link below to verify Gmail forwarding.",
        confirmationCode: confirmationCode || "Not found in parsed email body.",
        confirmationLinks,
        eventId: storedEvent?.id || null,
        from: parsed.from,
        subject: parsed.subject,
        receivedAt: parsed.receivedAt,
        preview: parsed.preview,
      },
    };
  }

  const trackedNotification = getTrackedInboundEmailNotification(parsed.subject);

  if (trackedNotification) {
    const candidateEmails = [...parsed.senderEmails, ...parsed.recipientEmails];
    let matchedUser = null;

    for (const email of candidateEmails) {
      matchedUser = await findAppUserByVaultForwardingEmail(email);
      if (matchedUser) {
        break;
      }
    }

    const notificationResult = matchedUser
      ? await notifyRecipientAboutTrackedInboundEmail({
          recipientEmail: matchedUser.email,
          title: trackedNotification.title,
          subject: parsed.subject,
          sourceFrom: parsed.from,
          preview: parsed.preview,
        })
      : { sent: 0, skipped: true };

    const storedEvent = await storeVaultEmailEvent({
      eventType: trackedNotification.eventType,
      status: matchedUser
        ? notificationResult.sent > 0
          ? "notification_sent"
          : "notification_skipped"
        : "user_not_found",
      message: matchedUser
        ? `Tracked inbound email ${notificationResult.sent > 0 ? "notification sent" : "matched but no Pushover notification was sent"} for ${matchedUser.email}.`
        : "Tracked inbound email subject matched, but no approved app user matched the forwarded email address.",
      subject: parsed.subject,
      fromAddress: parsed.from,
      recipientEmails: parsed.recipientEmails,
      candidateEmails,
      matchedUserEmail: matchedUser?.email || null,
      preview: parsed.preview,
      receivedAt: parsed.receivedAt,
      rawPayload: body,
    });

    return {
      ok: true,
      statusCode: 200,
      payload: {
        ok: true,
        tracked: true,
        type: trackedNotification.eventType,
        message: matchedUser
          ? notificationResult.sent > 0
            ? `Tracked inbound email notification sent to ${matchedUser.email}.`
            : `Tracked inbound email matched ${matchedUser.email}, but no Pushover notification was sent.`
          : "Tracked inbound email was logged, but no approved app user matched the forwarded email address.",
        eventId: storedEvent?.id || null,
        subject: parsed.subject,
        matchedUserEmail: matchedUser?.email || null,
        receivedAt: parsed.receivedAt,
      },
    };
  }

  if (!subjectContainsVaultKeyEnclosed(parsed.subject)) {
    const storedEvent = await storeVaultEmailEvent({
      eventType: "vault_email",
      status: "ignored_subject",
      message: "Inbound email was logged, but Vault Key updates only run when the subject contains 'Vault Key Enclosed'.",
      subject: parsed.subject,
      fromAddress: parsed.from,
      recipientEmails: parsed.recipientEmails,
      candidateEmails: [...parsed.senderEmails, ...parsed.recipientEmails],
      preview: parsed.preview,
      receivedAt: parsed.receivedAt,
      rawPayload: body,
    });

    return {
      ok: true,
      statusCode: 200,
      payload: {
        ok: true,
        ignored: true,
        type: "ignored_subject",
        message: "Email logged. Shared Vault Key updates only run when the subject contains 'Vault Key Enclosed'.",
        eventId: storedEvent?.id || null,
        subject: parsed.subject,
        receivedAt: parsed.receivedAt,
      },
    };
  }

  const vaultKeyCode = extractVaultKeyCode([parsed.subject, parsed.combinedText].filter(Boolean).join("\n\n"));

  if (!vaultKeyCode) {
    const storedEvent = await storeVaultEmailEvent({
      eventType: "vault_email",
      status: "vault_key_not_found",
      message: "No Vault Key code could be found in the inbound email payload.",
      subject: parsed.subject,
      fromAddress: parsed.from,
      recipientEmails: parsed.recipientEmails,
      candidateEmails: [...parsed.senderEmails, ...parsed.recipientEmails],
      preview: parsed.preview,
      receivedAt: parsed.receivedAt,
      rawPayload: body,
    });

    return {
      ok: false,
      statusCode: 422,
      payload: {
        error: "vault_key_not_found",
        message: "No Vault Key code could be found in the inbound email payload.",
        eventId: storedEvent?.id || null,
      },
    };
  }

  const candidateEmails = [...parsed.senderEmails, ...parsed.recipientEmails];
  let matchedUser = null;

  for (const email of candidateEmails) {
    matchedUser = await findAppUserByVaultForwardingEmail(email);
    if (matchedUser) {
      break;
    }
  }

  if (!matchedUser) {
    const storedEvent = await storeVaultEmailEvent({
      eventType: "vault_email",
      status: "user_not_found",
      message: "No approved app user matched the forwarded email address.",
      subject: parsed.subject,
      fromAddress: parsed.from,
      recipientEmails: parsed.recipientEmails,
      candidateEmails,
      vaultKeyCode,
      preview: parsed.preview,
      receivedAt: parsed.receivedAt,
      rawPayload: body,
    });

    return {
      ok: false,
      statusCode: 404,
      payload: {
        error: "user_not_found",
        message: "No approved app user matched the forwarded email address.",
        candidateEmails,
        eventId: storedEvent?.id || null,
      },
    };
  }

  if (!matchedUser.vaultKeyAutoImportEnabled) {
    const storedEvent = await storeVaultEmailEvent({
      eventType: "vault_email",
      status: "auto_import_disabled",
      message: `Vault Key auto-import is disabled for ${matchedUser.email}.`,
      subject: parsed.subject,
      fromAddress: parsed.from,
      recipientEmails: parsed.recipientEmails,
      candidateEmails,
      matchedUserEmail: matchedUser.email,
      vaultKeyCode,
      preview: parsed.preview,
      receivedAt: parsed.receivedAt,
      rawPayload: body,
    });

    return {
      ok: false,
      statusCode: 409,
      payload: {
        error: "vault_auto_import_disabled",
        message: `Vault Key auto-import is disabled for ${matchedUser.email}.`,
        email: matchedUser.email,
        eventId: storedEvent?.id || null,
      },
    };
  }

  const updatedUsers = await recordVaultKeyForAllActiveUsers({
    vaultKeyCode,
    receivedAt: parsed.receivedAt,
    sourceFrom: parsed.from,
    sourceSubject: parsed.subject,
    sourcePreview: parsed.preview,
  });
  const updatedMatchedUser = updatedUsers.find((user) => user.email === matchedUser.email) || updatedUsers[0] || null;

  await notifyUsersVaultOpened({
    sourceFrom: parsed.from,
    sourceSubject: parsed.subject,
    vaultKeyCode,
    vaultUrl: "https://theabcvault.com/",
  });

  const storedEvent = await storeVaultEmailEvent({
    eventType: "vault_email",
    status: "saved_global",
    message: `Shared Vault Key saved for ${updatedUsers.length} active users from ${matchedUser.email}.`,
    subject: parsed.subject,
    fromAddress: parsed.from,
    recipientEmails: parsed.recipientEmails,
    candidateEmails,
    matchedUserEmail: matchedUser.email,
    vaultKeyCode,
    preview: parsed.preview,
    receivedAt: parsed.receivedAt,
    rawPayload: body,
  });

  return {
    ok: true,
    statusCode: 200,
    payload: {
      ok: true,
      message: `Shared Vault Key saved for ${updatedUsers.length} active users.`,
      appUrl: getVaultEmailConfig().appUrl,
      eventId: storedEvent?.id || null,
      updatedUserCount: updatedUsers.length,
      matchedUserEmail: matchedUser.email,
      user: {
        email: updatedMatchedUser?.email || matchedUser.email,
        vaultKeyCode: updatedMatchedUser?.vaultKeyCode || vaultKeyCode,
        vaultKeyLastReceivedAt: updatedMatchedUser?.vaultKeyLastReceivedAt || parsed.receivedAt,
        vaultKeySourceFrom: updatedMatchedUser?.vaultKeySourceFrom || parsed.from,
        vaultKeySourceSubject: updatedMatchedUser?.vaultKeySourceSubject || parsed.subject,
      },
    },
  };
}

module.exports = {
  extractVaultKeyCode,
  getVaultEmailConfig,
  ingestVaultKeyEmail,
  isVaultEmailIngestConfigured,
  isVaultEmailRequestAuthorized,
  parseInboundEmailPayload,
};
