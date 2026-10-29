// =====================================================================
// config.js - the ONLY file to edit after setup.
// Same Supabase project as the Fleet website ("fleet-website"), so the
// values are the same as Fleet's config.js:
//   Supabase -> Project Settings -> API -> "Project URL" and "anon/publishable" key.
// The anon key is meant to be public; login + Row Level Security protect the data.
// NEVER put the service_role / secret key here (that one is for bots only).
// =====================================================================
window.BUDGET_CONFIG = {
  SUPABASE_URL: "https://sfksshfqwmgrtelkztbc.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Pn7XWOEzSrXU6yYJ3k120Q_OmZpcORQ",
};
