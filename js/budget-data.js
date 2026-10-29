// =====================================================================
// budget-data.js - replaces the old desktop app's local server.
// The dashboard (dashboard.html) works on one STATE object exactly like
// the old Budget_Plan_Dashboard.html. This file:
//   * loads STATE from the budget_ tables in Supabase
//   * saves every change back (a second after you stop typing)
// Column names: database snake_case <-> dashboard camelCase.
// =====================================================================

const SETTING_KEYS = {          // STATE field -> budget_settings key
  baseFriday: "base_friday", grossWeekly: "gross_weekly", paycheckExtra: "paycheck_extra",
  debitCardBalance: "debit_card_balance", ccPlanYears: "cc_plan_years",
  teslaActualMiles: "tesla_actual_miles",
};
let LAST = { expenses: {}, cards: {}, deductions: {} };  // rows as last loaded/saved, by id
let SETTINGS = {};
let saveTimer = null, saving = false, saveAgain = false;

function emptyState() {
  return { baseFriday: thisFridayISO(), activeTab: localStorage.getItem("budget_tab") || "friday",
    expenseFilter: localStorage.getItem("budget_filter") || "all", grossWeekly: 0, paycheckExtra: 0,
    debitCardBalance: 0, ccPlanYears: 2, teslaActualMiles: 0, expenses: [], cards: [], deductions: [] };
}
function thisFridayISO(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() - 5 + 7) % 7));
  return x.toISOString().slice(0, 10);
}
const num = (v, d = 0) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));

// ---------- rows <-> STATE items ----------
const expFromRow = r => ({ id: r.id, name: r.name, inputMode: r.input_mode, inputAmount: num(r.input_amount),
  dueDay: r.due_day, manualAdd: num(r.manual_add), paymentFrom: r.payment_from || "M&T DC",
  payoffDate: r.payoff_date || "", url: r.url || "", notes: r.notes || "" });
const expToRow = (e, i) => ({ name: String(e.name || `Item ${i + 1}`), input_mode: e.inputMode || "Monthly",
  input_amount: num(e.inputAmount), due_day: Math.min(31, Math.max(0, parseInt(e.dueDay, 10) || 0)),
  manual_add: num(e.manualAdd), payment_from: e.paymentFrom || "M&T DC", payoff_date: e.payoffDate || null,
  url: e.url || "", notes: e.notes || "", active: true, sort_order: i + 1 });
const cardFromRow = r => ({ id: r.id, name: r.name, balance: num(r.balance),
  aprPct: Math.round(num(r.apr) * 100 * 10000) / 10000,
  otherWeekly: r.other_weekly === null ? null : num(r.other_weekly), dueDay: r.due_day, url: r.url || "", notes: r.notes || "" });
const cardToRow = (c, i) => ({ name: String(c.name || `Card ${i + 1}`), balance: num(c.balance),
  apr: num(c.aprPct) / 100, other_weekly: c.otherWeekly === null || c.otherWeekly === "" || num(c.otherWeekly) <= 0 ? null : num(c.otherWeekly),
  due_day: Math.min(31, Math.max(1, parseInt(c.dueDay, 10) || 1)), url: c.url || "", notes: c.notes || "", active: true, sort_order: i + 1 });
const dedFromRow = r => ({ id: r.id, category: r.category, name: r.name, weeklyDollar: num(r.weekly_amount), notes: r.notes || "" });
const dedToRow = (d, i) => {
  const wk = num(d.weeklyDollar), g = num(STATE.grossWeekly);
  return { category: d.category === "Tax" ? "Tax" : "Deduction", name: String(d.name || `Deduction ${i + 1}`),
    mode: "Dollar", weekly_amount: wk, pct_of_gross: g > 0 ? Math.round((wk / g) * 1e6) / 1e6 : 0, notes: d.notes || "", sort_order: i + 1 };
};
const TABLES = {
  expenses:   { table: "budget_expenses",        toRow: expToRow,  fromRow: expFromRow, activeOnly: true },
  cards:      { table: "budget_credit_cards",    toRow: cardToRow, fromRow: cardFromRow, activeOnly: true },
  deductions: { table: "budget_deduction_items", toRow: dedToRow,  fromRow: dedFromRow, activeOnly: false },
};

// ---------- the functions the dashboard calls ----------
function updateDbBadge(text, isOnline) {
  const b = document.getElementById("dbStatusBadge");
  if (b) { b.textContent = text; b.className = "status-pill " + (isOnline === true ? "status-success" : isOnline === false ? "status-danger" : "status-neutral"); }
}
function loadState() { return emptyState(); }

function saveState() {
  try { localStorage.setItem("budget_tab", STATE.activeTab); localStorage.setItem("budget_filter", STATE.expenseFilter); } catch (e) {}
  if (!sb || !DB_LOADED) return;
  updateDbBadge("🟡 Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(syncToDb, 800);
}

async function syncToDb() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  try {
    // 1. settings
    const deds = STATE.deductions || [];
    const tax = deds.filter(d => d.category === "Tax").reduce((a, d) => a + num(d.weeklyDollar), 0);
    const ded = deds.filter(d => d.category !== "Tax").reduce((a, d) => a + num(d.weeklyDollar), 0);
    const want = { taxes_weekly: tax.toFixed(2), deductions_weekly: ded.toFixed(2) };
    for (const [f, k] of Object.entries(SETTING_KEYS)) want[k] = String(STATE[f]);
    const changed = Object.entries(want).filter(([k, v]) => SETTINGS[k] !== v).map(([key, value]) => ({ key, value }));
    if (changed.length) {
      check(await sb.from("budget_settings").upsert(changed, { onConflict: "key" }), "Saving settings");
      changed.forEach(r => (SETTINGS[r.key] = r.value));
    }
    // 2. lists: delete removed, update changed, insert new
    for (const [field, t] of Object.entries(TABLES)) {
      const items = STATE[field] || [];
      const keep = new Set(items.map(x => x.id).filter(id => LAST[field][id]));
      const gone = Object.keys(LAST[field]).map(Number).filter(id => !keep.has(id));
      if (gone.length) { check(await sb.from(t.table).delete().in("id", gone), "Deleting from " + t.table); gone.forEach(id => delete LAST[field][id]); }
      for (let i = 0; i < items.length; i++) {
        const it = items[i], row = t.toRow(it, i);
        if (LAST[field][it.id]) {
          if (JSON.stringify(LAST[field][it.id]) === JSON.stringify(row)) continue;
          check(await sb.from(t.table).update(row).eq("id", it.id), "Saving " + it.name);
        } else {
          // new item: let the database pick the id, then use it in STATE
          const ins = check(await sb.from(t.table).insert(row).select("id").single(), "Adding " + it.name);
          it.id = ins.id;
        }
        LAST[field][it.id] = row;
      }
    }
    updateDbBadge("🟢 Saved to cloud " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), true);
  } catch (e) {
    updateDbBadge("🔴 Not saved: " + e.message, false);
    alert("Could not save to the cloud:\n" + e.message + "\n\nTip: press ↻ Reload to see what is saved.");
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; syncToDb(); }
  }
}

let DB_LOADED = false;
async function loadFromDb() {
  updateDbBadge("🟡 Loading…");
  const s = check(await sb.from("budget_settings").select("key,value"), "Loading settings");
  SETTINGS = Object.fromEntries(s.map(r => [r.key, r.value]));
  const st = emptyState();
  if (SETTINGS.base_friday) st.baseFriday = SETTINGS.base_friday;
  for (const [f, k] of Object.entries(SETTING_KEYS)) if (f !== "baseFriday" && k in SETTINGS) st[f] = num(SETTINGS[k], st[f]);
  for (const [field, t] of Object.entries(TABLES)) {
    let q = sb.from(t.table).select("*").order("sort_order").order("id");
    if (t.activeOnly) q = q.eq("active", true);
    const rows = check(await q, "Loading " + t.table);
    st[field] = rows.map(t.fromRow);
  }
  STATE = st;
  LAST = { expenses: {}, cards: {}, deductions: {} };
  for (const [field, t] of Object.entries(TABLES)) STATE[field].forEach((it, i) => (LAST[field][it.id] = t.toRow(it, i)));
  buildPortalLinks();
  buildQuickJump();
  DB_LOADED = true;
  renderAll();
  updateDbBadge("🟢 Cloud database connected", true);
}

// Payment-portal cards: made from the url of every bill and card (no amounts stored in the site code)
function buildPortalLinks() {
  const map = new Map();
  const add = (name, url, day) => {
    if (!url || url === "https://") return;
    let site = url; try { site = new URL(url).hostname.replace(/^www\./, ""); } catch (e) {}
    const e = map.get(url) || { names: [], site, href: url };
    e.names.push(day ? `${name} (Day ${day})` : name); map.set(url, e);
  };
  STATE.expenses.forEach(x => add(x.name, x.url, x.dueDay));
  STATE.cards.forEach(x => add(x.name + " card", x.url, x.dueDay));
  PORTAL_LINKS = [...map.values()].map(e => ({ title: e.names.join(", "), site: e.site, href: e.href }));
}
// Quick-jump list: 2 Fridays back to 8 ahead of today
function buildQuickJump() {
  const sel = document.getElementById("quickJumpSelect"); if (!sel) return;
  const cur = thisFridayISO(), base = new Date(cur + "T00:00:00Z"), opts = [];
  for (let w = -2; w <= 8; w++) {
    const d = new Date(base); d.setUTCDate(d.getUTCDate() + 7 * w);
    const iso = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });
    opts.push(`<option value="${iso}">${label}${w === 0 ? " (This Friday)" : w === 1 ? " (Next Friday)" : ""}</option>`);
  }
  if (!opts.some(o => o.includes(`"${STATE.baseFriday}"`))) opts.unshift(`<option value="${STATE.baseFriday}">${STATE.baseFriday} (saved)</option>`);
  sel.innerHTML = opts.join("");
}

// "Reset" button became "Reload from database"
async function resetDefaults() {
  try { await loadFromDb(); } catch (e) { updateDbBadge("🔴 " + e.message, false); }
}
function shutdownApp() { signOut(); }

async function budgetStart() {
  const session = await requireSession(); if (!session) return;
  const who = document.getElementById("whoAmI"); if (who) who.textContent = session.user.email;
  try { await loadFromDb(); }
  catch (e) { updateDbBadge("🔴 " + e.message, false); alert("Could not load your budget:\n" + e.message); }
}
