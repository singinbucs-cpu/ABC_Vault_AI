const {
  createViewerUser,
  deleteManagedViewerUser,
  listAppUsers,
  normalizeEmail,
  updateManagedViewerUser,
} = require("../lib/app-users-db");
const { getSupabaseAdminClient, isSupabaseAdminConfigured, requireAppUser } = require("../lib/auth");

function sendJson(res, statusCode, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(statusCode).send(JSON.stringify(payload, null, 2));
}

function isExistingUserError(message) {
  const value = (message || "").toLowerCase();
  return value.includes("already registered") || value.includes("already exists") || value.includes("duplicate");
}

async function prepareSupabaseViewer(email) {
  if (!isSupabaseAdminConfigured()) {
    return {
      prepared: false,
      message: "Supabase admin access is not configured, so OTP setup was skipped.",
    };
  }

  const adminClient = getSupabaseAdminClient();
  const { error } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      appRole: "viewer",
    },
  });

  if (error && !isExistingUserError(error.message)) {
    throw error;
  }

  return {
    prepared: true,
    created: !error,
    message: error ? "Existing Supabase Auth user confirmed." : "Supabase Auth user created.",
  };
}

function parseBody(req) {
  return typeof req.body === "string"
    ? JSON.parse(req.body || "{}")
    : typeof req.body === "object" && req.body
    ? req.body
    : {};
}

module.exports = async (req, res) => {
  const auth = await requireAppUser(req, res, { requireRole: "admin" });
  if (!auth) {
    return;
  }

  try {
    if (req.method === "GET") {
      sendJson(res, 200, {
        users: await listAppUsers(),
      });
      return;
    }

    if (req.method === "POST") {
      const body = parseBody(req);
      const email = normalizeEmail(body.email || "");

      if (!email) {
        sendJson(res, 400, {
          error: "missing_email",
          message: "Enter an email address to add.",
        });
        return;
      }

      const user = await createViewerUser(email);
      const otp = await prepareSupabaseViewer(email);

      sendJson(res, 200, {
        success: true,
        message: `${email} was added as a viewer. ${otp.message}`,
        user,
        otp,
        users: await listAppUsers(),
      });
      return;
    }

    if (req.method === "PATCH") {
      const body = parseBody(req);
      const email = normalizeEmail(body.email || "");
      const user = await updateManagedViewerUser(email, {
        isActive: body.isActive,
      });

      sendJson(res, 200, {
        success: true,
        message: `${email} was ${user.isActive ? "reactivated" : "deactivated"}.`,
        user,
        users: await listAppUsers(),
      });
      return;
    }

    if (req.method === "DELETE") {
      const email = normalizeEmail(req.query?.email || parseBody(req).email || "");
      const user = await deleteManagedViewerUser(email);

      sendJson(res, 200, {
        success: true,
        message: `${email} was removed.`,
        user,
        users: await listAppUsers(),
      });
      return;
    }

    sendJson(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    sendJson(res, 400, {
      error: "admin_user_management_failed",
      message: error.message || "Unable to manage users.",
    });
  }
};
