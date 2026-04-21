const { getAppUserByEmail, normalizeEmail } = require("../lib/app-users-db");
const { getSupabaseAdminClient, isSupabaseAdminConfigured } = require("../lib/auth");

function sendJson(res, statusCode, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(statusCode).send(JSON.stringify(payload, null, 2));
}

function isExistingUserError(message) {
  const value = (message || "").toLowerCase();
  return (
    value.includes("already been registered") ||
    value.includes("already registered") ||
    value.includes("user already exists") ||
    value.includes("duplicate key")
  );
}

function isAuthUserMatch(user, email) {
  return normalizeEmail(user?.email || "") === email;
}

async function findSupabaseUserByEmail(adminClient, email) {
  const { data, error } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    throw error;
  }

  return (data?.users || []).find((user) => isAuthUserMatch(user, email)) || null;
}

async function ensureSupabaseAuthUser(adminClient, email, appUser) {
  const existingUser = await findSupabaseUserByEmail(adminClient, email);

  if (existingUser) {
    const { error: updateError } = await adminClient.auth.admin.updateUserById(existingUser.id, {
      email_confirm: true,
      user_metadata: {
        ...(existingUser.user_metadata || {}),
        appRole: appUser.role,
      },
    });

    if (updateError) {
      throw updateError;
    }

    return {
      created: false,
      userId: existingUser.id,
    };
  }

  const { data, error: createError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      appRole: appUser.role,
    },
  });

  if (createError && !isExistingUserError(createError.message)) {
    throw createError;
  }

  if (createError) {
    const retryExistingUser = await findSupabaseUserByEmail(adminClient, email);
    if (!retryExistingUser) {
      throw createError;
    }

    return {
      created: false,
      userId: retryExistingUser.id,
    };
  }

  return {
    created: true,
    userId: data?.user?.id || null,
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : typeof req.body === "object" && req.body
        ? req.body
        : {};

    const email = normalizeEmail(body.email || "");

    if (!email) {
      sendJson(res, 400, {
        error: "missing_email",
        message: "Enter an email address to continue.",
      });
      return;
    }

    const appUser = await getAppUserByEmail(email);
    if (!appUser || !appUser.isActive) {
      sendJson(res, 403, {
        error: "access_denied",
        message: "Your account is not approved for this app.",
      });
      return;
    }

    if (!isSupabaseAdminConfigured()) {
      sendJson(res, 503, {
        error: "supabase_admin_not_configured",
        message: "Supabase admin access is not configured yet. Add SUPABASE_SERVICE_ROLE_KEY in Vercel.",
      });
      return;
    }

    const provisionResult = await ensureSupabaseAuthUser(getSupabaseAdminClient(), email, appUser);

    sendJson(res, 200, {
      success: true,
      email,
      role: appUser.role,
      created: provisionResult.created,
      message: `OTP sign-in is ready for ${email}.`,
    });
  } catch (error) {
    console.error("OTP provision failed:", error);
    sendJson(res, 500, {
      error: "otp_provision_failed",
      message: error.message || "Unable to prepare your approved account for OTP sign-in.",
    });
  }
};
