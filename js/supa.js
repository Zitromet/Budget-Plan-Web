// supa.js - connection to Supabase (shared by all pages)
const CFG = window.BUDGET_CONFIG || {};
const CONFIG_IS_PLACEHOLDER =
  !CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("YOUR-PROJECT-ID") ||
  !CFG.SUPABASE_ANON_KEY || CFG.SUPABASE_ANON_KEY.includes("YOUR-ANON");
const sb = CONFIG_IS_PLACEHOLDER ? null : supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const LOGIN_URL = new URL("index.html", location.href).href;

function check(result, what) {
  if (result.error) { console.error(what, result.error); throw new Error(what + ": " + result.error.message); }
  return result.data;
}
// Send to sign-in page unless signed in. Returns the session.
async function requireSession() {
  if (!sb) { location.href = LOGIN_URL; return null; }
  const { data } = await sb.auth.getSession();
  if (!data.session) { location.href = LOGIN_URL; return null; }
  return data.session;
}
async function signOut() {
  if (sb) await sb.auth.signOut();
  location.href = LOGIN_URL;
}
