// login.js - sign-in page. Same as Fleet: Supabase e-mails a one-click link
// (sign-ups are off, so only existing users get a link).
const msg = document.getElementById("loginMsg");
const say = (t, err) => { msg.textContent = t; msg.className = "login-msg" + (err ? " error" : ""); };
const DASHBOARD_URL = new URL("dashboard.html", location.href).href;

(async function start() {
  if (CONFIG_IS_PLACEHOLDER) { document.getElementById("configWarning").hidden = false; return; }
  const { data } = await sb.auth.getSession();
  if (data.session) location.href = DASHBOARD_URL;
  sb.auth.onAuthStateChange((_e, session) => { if (session) location.href = DASHBOARD_URL; });
})();

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!sb) return say("Not connected: fill in config.js first.", true);
  const email = document.getElementById("email").value.trim();
  say("Sending linkâ€¦");
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: DASHBOARD_URL } });
  if (error) say("Could not send link: " + error.message, true);
  else say("Check your inbox for the sign-in link (open it in this same browser).");
});
