const { json, options } = require("./_backend");

exports.handler = async (event) => {
  const cors = options(event);
  if (cors) return cors;

  return json(200, {
    backend: "netlify",
    cloudSync: "netlify_account_snapshot",
    supabaseFallback: true,
    mediaProxy: false,
    timestamp: new Date().toISOString()
  });
};
