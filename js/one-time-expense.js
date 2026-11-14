// =====================================================================
// one-time-expense.js
// A One_Time expense is a single payment. It is not a weekly or
// monthly bill, so it stays out of those averages and out of payoff math.
//
// Friday bucket: each Friday F owns the period [F, F+6] (that Friday
// through the next Thursday). This is the same window computeCycleMetrics
// uses for isDueThisWeek: a due date counts when
// baseFriday <= due date <= baseFriday + 6 days.
// The Friday for a calendar date is that date minus
// (weekday - Friday + 7) % 7 days, the same offset as thisFridayISO.
// The expense adds its full amount only when the selected Friday is
// that Friday. Every other Friday it adds $0.
// =====================================================================

function isoDate(value) {
  const s = String(value == null ? "" : value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const y = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const dt = new Date(Date.UTC(y, month - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return "";
  return s;
}

// Friday that starts the Fri–Thu period containing this calendar date.
function fridayBucket(iso) {
  const date = isoDate(iso);
  if (!date) return "";
  const [y, month, day] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() - 5 + 7) % 7));
  return dt.toISOString().slice(0, 10);
}

function moneyCents(value) {
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function formatMoney(value) {
  const n = moneyCents(value);
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Dollars this One_Time expense adds to the selected Friday. Other modes add 0 here.
function oneTimeShare(expense, baseFriday) {
  if (!expense || expense.inputMode !== "One_Time") return 0;
  const bucket = fridayBucket(expense.oneTimeDate);
  const friday = fridayBucket(baseFriday);
  if (!bucket || !friday || bucket !== friday) return 0;
  const n = moneyCents(expense.inputAmount);
  return n > 0 ? n : 0;
}

// "Paid" once the payment date is before the selected Friday, otherwise "Upcoming".
function oneTimeLabel(expense, baseFriday) {
  const date = isoDate(expense && expense.oneTimeDate);
  const friday = isoDate(baseFriday);
  if (!date || !friday) return "";
  return date < friday ? "Paid" : "Upcoming";
}

// Empty string when the draft can be saved. One_Time needs a date and an amount > 0.
function oneTimeError(input) {
  if (!input || input.mode !== "One_Time") return "";
  const date = isoDate(input.date);
  const raw = typeof input.amount === "string" ? input.amount.trim() : input.amount;
  const missingAmount = raw === "" || raw === null || raw === undefined;
  const n = missingAmount ? 0 : moneyCents(raw);
  const badAmount = missingAmount || !Number.isFinite(Number(raw)) || n <= 0;
  if (!date && badAmount) return "Enter an amount and a payment date for a one-time expense.";
  if (!date) return "Enter the payment date for a one-time expense.";
  if (badAmount) return "Enter an amount for a one-time expense.";
  return "";
}

// Recurring amount already due this Friday, plus one-time payments in this Friday's period.
function fridayTotalDue(recurringDue, expenses, baseFriday) {
  const extra = (Array.isArray(expenses) ? expenses : []).reduce((sum, e) => sum + oneTimeShare(e, baseFriday), 0);
  return moneyCents(moneyCents(recurringDue) + extra);
}

// total > available → transfer the gap from savings. Otherwise what is left over, including $0.00.
function compareFridayCash(totalDue, available) {
  const due = moneyCents(totalDue);
  const avail = moneyCents(available);
  if (due > avail) {
    const need = moneyCents(due - avail);
    return { totalDue: due, available: avail, kind: "shortfall", amount: need, text: "Transfer from savings: " + formatMoney(need) };
  }
  const left = moneyCents(avail - due);
  return { totalDue: due, available: avail, kind: "leftover", amount: left, text: "Left over: " + formatMoney(left) };
}
