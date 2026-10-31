// =====================================================================
// manage.js - Manage Data screen. One tab per budget table.
// Each column is described once below (label, type, help) and the
// list + add/edit form are built from that.
// =====================================================================
const T = {
  expenses: { table: "budget_expenses", title: "Bills & Expenses", order: ["sort_order", "id"],
    help: "Due Day 0 = set aside every Friday. Mode CC_Link = uses the credit-card total. Set Active = No to hide a bill without deleting it.",
    cols: [
      ["name", "Name", "text", { req: 1 }], ["input_mode", "Mode", "select", { opts: ["Weekly", "Monthly", "CC_Link"] }],
      ["input_amount", "Amount ($)", "money"], ["due_day", "Due day (0-31)", "int", { min: 0, max: 31 }],
      ["payment_from", "Paid from", "text", { def: "M&T DC" }], ["manual_add", "Manual add ($)", "money"],
      ["payoff_date", "Payoff date", "date"], ["payments_left_override", "Payments left (override)", "number", { list: 0 }],
      ["url", "Website", "url", { list: 0 }], ["notes", "Notes", "textarea", { list: 0 }],
      ["active", "Active", "bool", { def: true }], ["sort_order", "Order", "int"]] },
  cards: { table: "budget_credit_cards", title: "Credit Cards", order: ["sort_order", "id"],
    help: "APR is entered as a percent (27.24). Weekly override empty = use the calculated payoff amount.",
    cols: [
      ["name", "Name", "text", { req: 1 }], ["balance", "Balance ($)", "money"], ["apr", "APR %", "pct"],
      ["other_weekly", "Weekly override ($)", "money", { nullable: 1 }], ["due_day", "Due day (1-31)", "int", { min: 1, max: 31, def: 1 }],
      ["url", "Website", "url", { list: 0 }], ["notes", "Notes", "textarea", { list: 0 }],
      ["active", "Active", "bool", { def: true }], ["sort_order", "Order", "int"]] },
  deductions: { table: "budget_deduction_items", title: "Paycheck Taxes & Deductions", order: ["sort_order", "id"],
    help: "Weekly amounts taken from the gross paycheck.",
    cols: [
      ["category", "Category", "select", { opts: ["Tax", "Deduction"] }], ["name", "Name", "text", { req: 1 }],
      ["weekly_amount", "Weekly ($)", "money"], ["pct_of_gross", "% of gross", "pct", { list: 1 }],
      ["mode", "Mode", "select", { opts: ["Dollar", "Percent"], list: 0 }], ["notes", "Notes", "textarea", { list: 0 }],
      ["sort_order", "Order", "int"]] },
  loans: { table: "budget_loans_yearly", title: "Loans & Yearly Bills", order: ["item_type", "name"],
    help: "Reference list of loans and once-a-year bills.",
    cols: [
      ["item_type", "Type", "select", { opts: ["Loan", "Yearly"] }], ["name", "Name", "text", { req: 1 }],
      ["balance", "Balance ($)", "money", { nullable: 1 }], ["apr", "APR %", "pct", { nullable: 1 }],
      ["monthly_amount", "Monthly ($)", "money", { nullable: 1 }], ["yearly_amount", "Yearly ($)", "money", { nullable: 1 }],
      ["due_date", "Due date", "date"], ["payoff_date", "Payoff date", "date"], ["url", "Website", "url", { list: 0 }]] },
  settings: { table: "budget_settings", title: "Settings", key: "key", order: ["key"],
    help: "Numbers and dates the dashboard uses (paycheck, debit balance, Tesla lease…). Edit carefully.",
    cols: [["key", "Key", "text", { req: 1, keyCol: 1 }], ["value", "Value", "text", { req: 1 }], ["description", "Description", "text"]] },
};
let TAB = location.hash.slice(1) in T ? location.hash.slice(1) : "expenses";
let ROWS = [];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = v => v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" });

function show(c, v) {
  const [, , type] = c;
  if (v === null || v === undefined) return "";
  if (type === "money") return money(v);
  if (type === "pct") return (Number(v) * 100).toFixed(2) + "%";
  if (type === "bool") return v ? "✔" : "—";
  if (type === "url") return `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>`;
  return esc(v);
}
const keyOf = () => T[TAB].key || "id";

async function load() {
  const t = T[TAB];
  let q = sb.from(t.table).select("*");
  t.order.forEach(o => (q = q.order(o)));
  ROWS = check(await q, "Loading " + t.title);
  render();
}
function render() {
  const t = T[TAB];
  document.getElementById("mdTabs").innerHTML = Object.entries(T).map(([k, v]) =>
    `<button class="seg-btn ${k === TAB ? "active" : ""}" onclick="setTab('${k}')">${v.title}</button>`).join("");
  document.getElementById("mdHelp").textContent = t.help;
  const s = document.getElementById("mdSearch").value.toLowerCase();
  const rows = ROWS.filter(r => !s || JSON.stringify(r).toLowerCase().includes(s));
  document.getElementById("mdCount").textContent = `${rows.length} of ${ROWS.length} rows`;
  const cols = t.cols.filter(c => (c[3] || {}).list !== 0);
  document.getElementById("mdTable").innerHTML =
    `<thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join("")}<th></th></tr></thead><tbody>` +
    rows.map(r => `<tr class="${r.active === false ? "inactive" : ""}">${cols.map(c =>
      `<td data-label="${esc(c[1])}" class="${["money", "pct", "int", "number"].includes(c[2]) ? "num" : ""}">${show(c, r[c[0]])}</td>`).join("")}
      <td class="row-actions"><button class="btn btn-sm" onclick="edit('${esc(r[keyOf()])}')">✏️ Edit</button>
      <button class="btn btn-sm btn-danger" onclick="del('${esc(r[keyOf()])}')">🗑️</button></td></tr>`).join("") + "</tbody>";
}
function setTab(k) { TAB = k; location.hash = k; document.getElementById("mdSearch").value = ""; load().catch(fail); }
function fail(e) { alert(e.message); }

function field(c, v) {
  const [name, label, type, o = {}] = c;
  if (v === undefined) v = o.def ?? "";
  const id = "f_" + name, req = o.req ? "required" : "";
  let input;
  if (type === "select") input = `<select id="${id}">${o.opts.map(x => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("")}</select>`;
  else if (type === "bool") input = `<select id="${id}"><option value="true" ${v ? "selected" : ""}>Yes</option><option value="false" ${!v ? "selected" : ""}>No</option></select>`;
  else if (type === "textarea") input = `<textarea id="${id}" rows="2">${esc(v)}</textarea>`;
  else {
    const it = { money: "number", int: "number", number: "number", pct: "number", date: "date", url: "url" }[type] || "text";
    const step = type === "int" ? "1" : "any";
    const val = type === "pct" && v !== "" && v !== null ? +(Number(v) * 100).toFixed(4) : v ?? "";
    input = `<input id="${id}" type="${it}" step="${step}" ${o.min !== undefined ? `min="${o.min}"` : ""} ${o.max !== undefined ? `max="${o.max}"` : ""} value="${esc(val)}" ${req} ${o.keyCol && v ? "readonly" : ""} />`;
  }
  return `<div class="f ${type === "textarea" || type === "url" ? "wide" : ""}"><label for="${id}">${label}</label>${input}</div>`;
}
function readForm() {
  const out = {};
  for (const [name, , type, o = {}] of T[TAB].cols) {
    const raw = document.getElementById("f_" + name).value.trim();
    if (type === "bool") out[name] = raw === "true";
    else if (["money", "int", "number", "pct"].includes(type)) {
      if (raw === "") out[name] = o.nullable || type === "number" ? null : 0;
      else { const n = Number(raw); out[name] = type === "pct" ? n / 100 : type === "int" ? Math.round(n) : n; }
    } else if (type === "date") out[name] = raw || null;
    else out[name] = raw;
  }
  return out;
}
function openForm(row) {
  const t = T[TAB], f = document.getElementById("mdForm");
  f.innerHTML = `<h2>${row ? "Edit" : "Add"} — ${t.title}</h2>` + t.cols.map(c => field(c, row ? row[c[0]] : undefined)).join("") +
    `<div class="actions"><button type="button" class="btn" id="mdCancel">Cancel</button><button type="submit" class="btn btn-primary">💾 Save</button></div>`;
  const dlg = document.getElementById("mdDialog");
  document.getElementById("mdCancel").onclick = () => dlg.close();
  f.onsubmit = async ev => {
    ev.preventDefault();
    try {
      const data = readForm();
      if (row) check(await sb.from(t.table).update(data).eq(keyOf(), row[keyOf()]), "Saving");
      else check(await sb.from(t.table).insert(data), "Adding");
      dlg.close(); await load();
    } catch (e) { fail(e); }
  };
  dlg.showModal();
}
const find = k => ROWS.find(r => String(r[keyOf()]) === String(k));
function edit(k) { openForm(find(k)); }
async function del(k) {
  const r = find(k);
  if (!confirm(`Delete "${r.name || r.key}"? This cannot be undone.`)) return;
  try { check(await sb.from(T[TAB].table).delete().eq(keyOf(), k), "Deleting"); await load(); } catch (e) { fail(e); }
}
document.getElementById("mdAdd").onclick = () => openForm(null);
document.getElementById("mdSearch").oninput = render;
(async () => {
  const s = await requireSession(); if (!s) return;
  document.getElementById("whoAmI").textContent = s.user.email;
  load().catch(fail);
})();
