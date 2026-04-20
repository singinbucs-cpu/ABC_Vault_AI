const { createClient } = require("@supabase/supabase-js");
const { getAppUserByEmail } = require("./app-users-db");

let supabaseClient;

function getHeader(req, name) {
  if (!req?.headers) {
    return "";
  }

  return req.headers[name] || req.headers[name.toLowerCase()] || "";
}

function getSupabaseConfig() {
  return {
    url: (process.env.SUPABASE_URL || "").trim(),
    anonKey: (process.env.SUPABASE_ANON_KEY || "").trim(),
  };
}

function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

function getSupabaseServerClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase Auth is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY first.");
  }

  if (!supabaseClient) {
    const { url, anonKey } = getSupabaseConfig();
    supabaseClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  return supabaseClient;
}

function getBearerToken(req) {
  const authorization = getHeader(req, "authorization");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function authenticateRequest(req, options = {}) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      ok: false,
      statusCode: 401,
      payload: {
        error: "missing_auth",
        message: "Sign in is required.",
      },
    };
  }

  const { data, error } = await getSupabaseServerClient().auth.getUser(token);

  if (error || !data?.user?.email) {
    return {
      ok: false,
      statusCode: 401,
      payload: {
        error: "invalid_auth",
        message: "Your session is invalid or has expired.",
      },
    };
  }

  const appUser = await getAppUserByEmail(data.user.email);

  if (!appUser || !appUser.isActive) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        error: "access_denied",
        message: "Your account is not approved for this app.",
      },
    };
  }

  if (options.requireRole && appUser.role !== options.requireRole) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        error: "insufficient_role",
        message: `${options.requireRole} access is required for this action.`,
      },
    };
  }

  return {
    ok: true,
    user: data.user,
    appUser,
  };
}

async function requireAppUser(req, res, options = {}) {
  const auth = await authenticateRequest(req, options);

  if (!auth.ok) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(auth.statusCode).send(JSON.stringify(auth.payload, null, 2));
    return null;
  }

  return auth;
}

module.exports = {
  authenticateRequest,
  getSupabaseConfig,
  isSupabaseConfigured,
  requireAppUser,
};
