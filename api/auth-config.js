const { isSupabaseConfigured, getSupabaseConfig } = require("../lib/auth");

module.exports = async (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const { url, anonKey } = getSupabaseConfig();

  res.status(200).send(
    JSON.stringify(
      {
        configured: isSupabaseConfigured(),
        supabaseUrl: url || null,
        supabaseAnonKey: anonKey || null,
      },
      null,
      2,
    ),
  );
};
