// =====================================================================
// yearly-subscriptions.js
// Math for the Manage Data "Yearly Subscriptions" tab.
// This list is information only. Nothing here is added to Friday,
// weekly, monthly, or dashboard totals. yearly_amount is dollars
// per year before tax. Tax belongs in the note, not in the total.
// =====================================================================

// Calendar day where the browser is, as YYYY-MM-DD.
// A renewal date has no time, so compare it to this string.
function localTodayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// blank | past | today | upcoming
function renewalStatus(value, today) {
  const date = String(value == null ? "" : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "blank";
  if (date < today) return "past";
  if (date === today) return "today";
  return "upcoming";
}

// Whole cents so 99 + 129.99 stays 228.99.
function yearlyCents(value) {
  if (typeof value === "string") value = value.trim();
  if (value == null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function byDateThenName(a, b) {
  if (a.renewal_date !== b.renewal_date) return a.renewal_date < b.renewal_date ? -1 : 1;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function byDateDescThenName(a, b) {
  if (a.renewal_date !== b.renewal_date) return a.renewal_date > b.renewal_date ? -1 : 1;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

// rows from budget_yearly_subscriptions. today is YYYY-MM-DD.
// Returns { total, count, status, next, sameDay, detail }.
// status is "none" (no rows), "no-date", "past", or "upcoming".
// next is { name, amount, date } or null. amount is dollars per year.
function summarizeYearlySubscriptions(rows, today) {
  const list = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === "object");
  const total = list.reduce((sum, r) => sum + yearlyCents(r.yearly_amount), 0) / 100;
  const dated = [];
  for (const r of list) {
    const date = String(r.renewal_date == null ? "" : r.renewal_date).trim();
    if (renewalStatus(date, today) === "blank") continue;
    dated.push({ name: String(r.name || ""), yearly_amount: r.yearly_amount, renewal_date: date });
  }
  const upcoming = dated.filter(r => r.renewal_date >= today).sort(byDateThenName);
  const past = dated.filter(r => r.renewal_date < today).sort(byDateDescThenName);
  const count = list.length;

  if (!count) {
    return { total, count, status: "none", next: null, sameDay: 0, detail: "No subscriptions yet." };
  }
  if (upcoming.length) {
    const first = upcoming[0];
    const sameDay = upcoming.filter(r => r.renewal_date === first.renewal_date).length - 1;
    const when = first.renewal_date === today ? first.renewal_date + " (today)" : first.renewal_date;
    let detail = (first.name || "(no name)") + " on " + when + ".";
    if (sameDay === 1) detail += " 1 more subscription renews the same day.";
    else if (sameDay > 1) detail += " " + sameDay + " more subscriptions renew the same day.";
    return {
      total, count, status: "upcoming", sameDay, detail,
      next: { name: first.name, amount: yearlyCents(first.yearly_amount) / 100, date: first.renewal_date },
    };
  }
  if (!dated.length) {
    return { total, count, status: "no-date", next: null, sameDay: 0, detail: "No renewal date is set." };
  }
  const latest = past[0];
  const undated = count - dated.length;
  let detail = "No upcoming charge. Latest on file: " + (latest.name || "(no name)") + " on " + latest.renewal_date + " (past).";
  if (undated === 1) detail += " 1 subscription has no renewal date.";
  else if (undated > 1) detail += " " + undated + " subscriptions have no renewal date.";
  return { total, count, status: "past", next: null, sameDay: 0, detail };
}
