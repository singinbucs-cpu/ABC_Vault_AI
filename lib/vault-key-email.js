const { findAppUserByVaultForwardingEmail, recordVaultKeyForUser } = require("./app-users-db");

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
  return normalizeText(value).replace(/\s+/g, " ").slice(0, 280);
}

function isLikelyVaultCode(value) {
  const candidate = (value || "").trim().toUpperCase();
  if (!candidate || candidate.length < 4 || candidate.length > 32) {
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

  const upperText = normalized.toUpperCase();
  const patterns = [
    /\bVAULT KEY(?:\s+CODE)?\b[^A-Z0-9]{0,20}([A-Z0-9-]{4,32})\b/,
    /\bKEY CODE\b[^A-Z0-9]{0,20}([A-Z0-9-]{4,32})\b/,
    /\bENTER YOUR CODE\b[^A-Z0-9]{0,12}([A-Z0-9-]{4,32})\b/,
    /\bCODE\b[^A-Z0-9]{0,12}([A-Z0-9-]{4,32})\b/,
    /\bUNLOCK ACCESS\b[^A-Z0-9]{0,20}([A-Z0-9-]{4,32})\b/,
  ];

  for (const pattern of patterns) {
    const match = upperText.match(pattern);
    if (match?.[1] && isLikelyVaultCode(match[1])) {
      return match[1].trim();
    }
  }

  const fallbackMatches = upperText.match(/\b[A-Z0-9-]{6,16}\b/g) || [];
  const fallbackCode = fallbackMatches.find((candidate) => isLikelyVaultCode(candidate));
  return fallbackCode || "";
}

function parseInboundEmailPayload(body = {}) {
  const payload = typeof body === "object" && body ? body : {};
  const headers = payload.headers && typeof payload.headers === "object" ? payload.headers : {};
  const subject = [payload.subject, payload.Subject, getHeaderValue(headers, "subject")].find(Boolean) || "";
  const from = [
    payload.from,
    payload.From,
    payload.sender,
    payload.envelope?.from,
    getHeaderValue(headers, "from"),
  ].find(Boolean) || "";
  const toValues = [
    payload.to,
    payload.To,
    payload.recipient,
    payload.envelope?.to,
    payload.envelope?.recipients,
    getHeaderValue(headers, "to"),
    getHeaderValue(headers, "delivered-to"),
    getHeaderValue(headers, "x-forwarded-to"),
  ].flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
  const textContent = [
    payload.text,
    payload.textBody,
    payload["body-plain"],
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
    preview: buildEmailPreview(combinedText || `${subject}\n${from}`),
    receivedAt,
  };
}

async function ingestVaultKeyEmail(body = {}) {
  const parsed = parseInboundEmailPayload(body);
  const vaultKeyCode = extractVaultKeyCode([parsed.subject, parsed.combinedText].filter(Boolean).join("\n\n"));

  if (!vaultKeyCode) {
    return {
      ok: false,
      statusCode: 422,
      payload: {
        error: "vault_key_not_found",
        message: "No Vault Key code could be found in the inbound email payload.",
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
    return {
      ok: false,
      statusCode: 404,
      payload: {
        error: "user_not_found",
        message: "No approved app user matched the forwarded email address.",
        candidateEmails,
      },
    };
  }

  if (!matchedUser.vaultKeyAutoImportEnabled) {
    return {
      ok: false,
      statusCode: 409,
      payload: {
        error: "vault_auto_import_disabled",
        message: `Vault Key auto-import is disabled for ${matchedUser.email}.`,
        email: matchedUser.email,
      },
    };
  }

  const updatedUser = await recordVaultKeyForUser(matchedUser.email, {
    vaultKeyCode,
    receivedAt: parsed.receivedAt,
    sourceFrom: parsed.from,
    sourceSubject: parsed.subject,
    sourcePreview: parsed.preview,
  });

  return {
    ok: true,
    statusCode: 200,
    payload: {
      ok: true,
      message: `Vault Key saved for ${matchedUser.email}.`,
      appUrl: getVaultEmailConfig().appUrl,
      user: {
        email: updatedUser.email,
        vaultKeyCode: updatedUser.vaultKeyCode,
        vaultKeyLastReceivedAt: updatedUser.vaultKeyLastReceivedAt,
        vaultKeySourceFrom: updatedUser.vaultKeySourceFrom,
        vaultKeySourceSubject: updatedUser.vaultKeySourceSubject,
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
