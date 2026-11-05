// Focused tests for the Manage Data "Yearly Subscriptions" tab.
// The amounts below are examples of the math. They are not seed data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
// Values built inside the page sandbox do not share this file's Object prototype.
const plain = value => JSON.parse(JSON.stringify(value));

function loadSummary() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(read("js/yearly-subscriptions.js"), context);
  return context;
}

const LIVE_ROWS = [
  { name: "Microsoft 365 Family", yearly_amount: "129.99", renewal_date: "2027-10-11", note: "applicable taxes only" },
  { name: "Tesla Model Y Premium Connectivity", yearly_amount: "99.00", renewal_date: "2026-12-05", note: "" },
];
const TODAY = "2026-11-05";

test("pre-tax annual total and next charge match the stored yearly subscriptions", () => {
  const { summarizeYearlySubscriptions } = loadSummary();
  const s = summarizeYearlySubscriptions(LIVE_ROWS, TODAY);
  assert.equal(s.total, 228.99);
  assert.equal(s.count, 2);
  assert.equal(s.status, "upcoming");
  assert.equal(s.sameDay, 0);
  assert.deepEqual(plain(s.next), {
    name: "Tesla Model Y Premium Connectivity",
    amount: 99,
    date: "2026-12-05",
  });
  assert.equal(s.detail, "Tesla Model Y Premium Connectivity on 2026-12-05.");
  assert.doesNotMatch(s.detail, /tax/i);
  assert.doesNotMatch(JSON.stringify(s.next), /129\.99/);
});

test("a tax note does not change the yearly amount", () => {
  const { summarizeYearlySubscriptions } = loadSummary();
  const s = summarizeYearlySubscriptions([
    { name: "Microsoft 365 Family", yearly_amount: 129.99, renewal_date: "2027-10-11", note: "plus applicable taxes $20" },
  ], TODAY);
  assert.equal(s.total, 129.99);
  assert.equal(s.next.amount, 129.99);
});

test("no rows, no dates, and past dates each get a clear next-charge state", () => {
  const { summarizeYearlySubscriptions } = loadSummary();
  const none = summarizeYearlySubscriptions([], TODAY);
  assert.equal(none.total, 0);
  assert.equal(none.status, "none");
  assert.equal(none.next, null);
  assert.equal(none.detail, "No subscriptions yet.");

  const undated = summarizeYearlySubscriptions([
    { name: "Mystery", yearly_amount: 10, renewal_date: null },
    { name: "Blank", yearly_amount: "2.50", renewal_date: "  " },
  ], TODAY);
  assert.equal(undated.total, 12.5);
  assert.equal(undated.status, "no-date");
  assert.equal(undated.next, null);
  assert.equal(undated.detail, "No renewal date is set.");

  const past = summarizeYearlySubscriptions([
    { name: "Zed", yearly_amount: 1, renewal_date: "2024-05-01" },
    { name: "Amy", yearly_amount: 1, renewal_date: "2024-05-01" },
    { name: "Old", yearly_amount: 1, renewal_date: "2023-01-01" },
    { name: "No Date", yearly_amount: 4, renewal_date: "" },
  ], TODAY);
  assert.equal(past.total, 7);
  assert.equal(past.status, "past");
  assert.equal(past.next, null);
  assert.equal(past.detail, "No upcoming charge. Latest on file: Amy on 2024-05-01 (past). 1 subscription has no renewal date.");
});

test("today counts as upcoming, and the earliest date wins over a larger later amount", () => {
  const { summarizeYearlySubscriptions, renewalStatus, localTodayISO } = loadSummary();
  assert.equal(renewalStatus("2026-11-05", TODAY), "today");
  assert.equal(renewalStatus("2026-11-04", TODAY), "past");
  assert.equal(renewalStatus("2026-12-05", TODAY), "upcoming");
  assert.equal(renewalStatus(null, TODAY), "blank");
  assert.equal(localTodayISO(new Date(2026, 0, 7)), "2026-01-07");

  const due = summarizeYearlySubscriptions([
    { name: "Due today", yearly_amount: 3, renewal_date: TODAY },
  ], TODAY);
  assert.equal(due.status, "upcoming");
  assert.equal(due.next.date, TODAY);
  assert.equal(due.detail, "Due today on 2026-11-05 (today).");

  const sooner = summarizeYearlySubscriptions([
    { name: "Big later", yearly_amount: 500, renewal_date: "2027-01-01" },
    { name: "Small sooner", yearly_amount: 1, renewal_date: "2026-12-01" },
    { name: "Already past", yearly_amount: 40, renewal_date: "2020-01-01" },
  ], TODAY);
  assert.equal(sooner.total, 541);
  assert.equal(sooner.next.name, "Small sooner");
  assert.equal(sooner.next.amount, 1);
  assert.equal(sooner.next.date, "2026-12-01");
});

test("two renewals on the next date name the first and count the rest", () => {
  const { summarizeYearlySubscriptions } = loadSummary();
  const s = summarizeYearlySubscriptions([
    { name: "Bravo", yearly_amount: 2, renewal_date: "2026-12-01" },
    { name: "Alpha", yearly_amount: 4, renewal_date: "2026-12-01" },
    { name: "Later", yearly_amount: 9, renewal_date: "2026-12-02" },
  ], TODAY);
  assert.equal(s.next.name, "Alpha");
  assert.equal(s.sameDay, 1);
  assert.equal(s.detail, "Alpha on 2026-12-01. 1 more subscription renews the same day.");
});

test("bad input does not throw and does not invent a charge", () => {
  const { summarizeYearlySubscriptions } = loadSummary();
  const s = summarizeYearlySubscriptions(null, TODAY);
  assert.equal(s.status, "none");
  assert.equal(s.total, 0);
  const mixed = summarizeYearlySubscriptions([
    null,
    { name: "Ok", yearly_amount: "nope", renewal_date: "not-a-date" },
    { name: "Real", yearly_amount: "", renewal_date: "2026-12-20" },
  ], TODAY);
  assert.equal(mixed.count, 2);
  assert.equal(mixed.total, 0);
  assert.equal(mixed.next.name, "Real");
  assert.equal(mixed.next.amount, 0);
});

function loadManage(todayISO) {
  const elements = {};
  function make(id) {
    return {
      id, innerHTML: "", textContent: "", value: "", hidden: true, open: false,
      onclick: null, oninput: null, onsubmit: null,
      close() { this.open = false; },
      showModal() { this.open = true; },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = make(id);
      return elements[id];
    },
  };
  const context = {
    document,
    location: { hash: "" },
    console,
    requireSession: async () => null,
    alert() {},
    confirm: () => false,
  };
  vm.createContext(context);
  vm.runInContext(read("js/yearly-subscriptions.js"), context);
  vm.runInContext(read("js/manage.js") + "\nfunction __set(tab, rows) { TAB = tab; ROWS = rows; render(); }\n", context);
  context.localTodayISO = () => todayISO;
  return { context, elements };
}

test("the subscriptions tab shows the section total and next charge, and other tabs do not", () => {
  const { context, elements } = loadManage(TODAY);
  context.__set("subscriptions", LIVE_ROWS.map((r, i) => ({ ...r, id: i + 1 })));
  const summary = elements.mdSummary.innerHTML;
  assert.equal(elements.mdSummary.hidden, false);
  assert.match(summary, /Annual total/);
  assert.match(summary, /\$228\.99/);
  assert.match(summary, /2 subscriptions, per year before tax/);
  assert.match(summary, /Next charge/);
  assert.match(summary, /\$99\.00/);
  assert.match(summary, /Tesla Model Y Premium Connectivity on 2026-12-05/);
  assert.match(summary, /before tax/);
  assert.doesNotMatch(summary, /applicable taxes/);
  assert.match(elements.mdTable.innerHTML, /Tesla Model Y Premium Connectivity/);
  assert.match(elements.mdTable.innerHTML, /Microsoft 365 Family/);
  assert.match(elements.mdTable.innerHTML, /applicable taxes only/);
  assert.match(elements.mdTable.innerHTML, /\$129\.99/);
  assert.match(elements.mdTabs.innerHTML, /Yearly Subscriptions/);
  assert.match(elements.mdTabs.innerHTML, /Loans & Yearly Bills/);
  assert.match(elements.mdHelp.textContent, /Not included in Friday, weekly, monthly, or dashboard totals/);

  elements.mdSearch.value = "microsoft";
  context.render();
  assert.match(elements.mdSummary.innerHTML, /\$228\.99/);
  assert.match(elements.mdCount.textContent, /1 of 2 rows/);
  assert.match(elements.mdTable.innerHTML, /Microsoft 365 Family/);
  assert.doesNotMatch(elements.mdTable.innerHTML, /Tesla Model Y Premium Connectivity/);

  elements.mdSearch.value = "";
  context.__set("loans", [{ id: 1, item_type: "Loan", name: "Car", balance: 10, yearly_amount: 1 }]);
  assert.equal(elements.mdSummary.hidden, true);
  assert.equal(elements.mdSummary.innerHTML, "");
  assert.match(elements.mdTable.innerHTML, /<th>Type<\/th>/);
  assert.match(elements.mdTable.innerHTML, /Car/);
  assert.match(elements.mdHelp.textContent, /Reference list of loans and once-a-year bills/);

  context.__set("expenses", [{ id: 4, name: "Rent", input_mode: "Monthly", input_amount: 100, due_day: 1, manual_add: 0, payment_from: "M&T DC", active: false, sort_order: 1 }]);
  assert.equal(elements.mdSummary.hidden, true);
  assert.match(elements.mdTable.innerHTML, /class="inactive"/);
  assert.match(elements.mdTable.innerHTML, /Rent/);
  assert.match(elements.mdTable.innerHTML, /\$100\.00/);
  assert.match(elements.mdTable.innerHTML, /onclick="edit\('4'\)"/);
  assert.match(elements.mdTable.innerHTML, /onclick="del\('4'\)"/);
});

test("past and blank renewal dates are labeled, and names are escaped", () => {
  const { context, elements } = loadManage(TODAY);
  context.__set("subscriptions", [
    { id: 1, name: "A & B <note>", yearly_amount: 5, renewal_date: "2020-02-02", note: "" },
    { id: 2, name: "No date", yearly_amount: 1, renewal_date: null, note: "" },
  ]);
  assert.match(elements.mdTable.innerHTML, /2020-02-02 \(past\)/);
  assert.match(elements.mdTable.innerHTML, /past-renewal/);
  assert.match(elements.mdTable.innerHTML, /A &amp; B &lt;note&gt;/);
  assert.doesNotMatch(elements.mdTable.innerHTML, /<note>/);
  assert.match(elements.mdSummary.innerHTML, /No upcoming charge/);
  assert.match(elements.mdSummary.innerHTML, /A &amp; B &lt;note&gt;/);
  assert.match(elements.mdSummary.innerHTML, />None</);
  const noDateRow = elements.mdTable.innerHTML.split("<tr").find(part => part.includes("No date"));
  assert.match(noDateRow, /Renewal date[\s\S]*—/);
});

test("add, edit, and delete use the same form and confirmation as the other tabs", async () => {
  const { context, elements } = loadManage(TODAY);
  const calls = [];
  function query() {
    const q = {
      select() { calls.push("select"); return q; },
      order(col, opts) { calls.push(["order", col, opts || null]); return q; },
      insert(data) { calls.push(["insert", data]); return q; },
      update(data) { calls.push(["update", data]); return q; },
      delete() { calls.push("delete"); return q; },
      eq(col, key) { calls.push(["eq", col, key]); return q; },
      then(resolve) { return Promise.resolve(resolve({ data: [], error: null })); },
    };
    return q;
  }
  let tableName = "";
  context.sb = { from(table) { tableName = table; calls.push(["from", table]); return query(); } };
  context.check = result => result.data;

  context.__set("subscriptions", []);
  context.openForm(null);
  assert.equal(elements.mdDialog.open, true);
  assert.match(elements.mdForm.innerHTML, /Add — Yearly Subscriptions/);
  assert.match(elements.mdForm.innerHTML, /id="f_name"[^>]*required/);
  assert.match(elements.mdForm.innerHTML, /id="f_yearly_amount"[^>]*required/);
  assert.match(elements.mdForm.innerHTML, /id="f_renewal_date"/);
  assert.match(elements.mdForm.innerHTML, /id="f_note"/);
  assert.doesNotMatch(elements.mdForm.innerHTML, /created_at|updated_at/);
  const setField = (id, value) => { context.document.getElementById(id).value = value; };
  setField("f_name", "  Garage camera  ");
  setField("f_yearly_amount", "48.50");
  setField("f_renewal_date", "");
  setField("f_note", "  ");
  await elements.mdForm.onsubmit({ preventDefault() {} });
  const inserted = calls.find(c => Array.isArray(c) && c[0] === "insert")[1];
  assert.equal(tableName, "budget_yearly_subscriptions");
  assert.deepEqual(plain(inserted), { name: "Garage camera", yearly_amount: 48.5, renewal_date: null, note: "" });
  assert.equal("id" in inserted, false);

  calls.length = 0;
  context.__set("subscriptions", [{ id: 9, name: "Garage camera", yearly_amount: 48.5, renewal_date: null, note: "" }]);
  context.edit("9");
  assert.match(elements.mdForm.innerHTML, /Edit — Yearly Subscriptions/);
  setField("f_name", "Garage camera");
  setField("f_yearly_amount", "48.50");
  setField("f_renewal_date", "2027-01-15");
  setField("f_note", "no tax");
  await elements.mdForm.onsubmit({ preventDefault() {} });
  assert.deepEqual(plain(calls.find(c => Array.isArray(c) && c[0] === "update")[1]), {
    name: "Garage camera", yearly_amount: 48.5, renewal_date: "2027-01-15", note: "no tax",
  });
  assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === "eq").slice(1), ["id", 9]);

  calls.length = 0;
  context.__set("subscriptions", [{ id: 9, name: "Garage camera", yearly_amount: 48.5, renewal_date: null, note: "" }]);
  let asked = "";
  context.confirm = message => { asked = message; return false; };
  await context.del("9");
  assert.equal(asked, 'Delete "Garage camera"? This cannot be undone.');
  assert.equal(calls.some(c => c === "delete"), false);

  context.confirm = () => true;
  await context.del("9");
  assert.equal(calls.includes("delete"), true);
  assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === "eq"), ["eq", "id", "9"]);
  assert.equal(calls.find(c => Array.isArray(c) && c[0] === "from")[1], "budget_yearly_subscriptions");
});

test("subscriptions load with renewal date first and null dates last; loans keep their old order", async () => {
  const { context } = loadManage(TODAY);
  const orders = [];
  let fromTable = "";
  function query() {
    const q = {
      select() { return q; },
      order(col, opts) { orders.push([col, opts || null]); return q; },
      then(resolve) { return Promise.resolve(resolve({ data: [], error: null })); },
    };
    return q;
  }
  context.sb = { from(table) { fromTable = table; return query(); } };
  context.check = result => result.data;
  context.__set("subscriptions", []);
  await context.load();
  assert.equal(fromTable, "budget_yearly_subscriptions");
  assert.deepEqual(plain(orders), [
    ["renewal_date", { ascending: true, nullsFirst: false }],
    ["name", null],
  ]);
  orders.length = 0;
  context.__set("loans", []);
  await context.load();
  assert.equal(fromTable, "budget_loans_yearly");
  assert.deepEqual(orders, [["item_type", null], ["name", null]]);
});

test("Friday, weekly, monthly, and dashboard code do not query yearly subscriptions", () => {
  const data = read("js/budget-data.js");
  const dash = read("dashboard.html");
  const manage = read("js/manage.js");
  const page = read("manage.html");
  const css = read("css/website.css");
  const tables = data.match(/const TABLES = \{[\s\S]*?\n\};/)[0];
  assert.match(data, /budget_yearly_subscriptions is intentionally not in TABLES/);
  assert.doesNotMatch(tables, /subscription/i);
  assert.doesNotMatch(data, /from\("budget_yearly_subscriptions"\)/);
  assert.match(dash, /Yearly subscriptions are not part of STATE/);
  assert.doesNotMatch(dash, /budget_yearly_subscriptions/);
  assert.match(manage, /table: "budget_loans_yearly"/);
  assert.match(manage, /title: "Loans & Yearly Bills"/);
  assert.match(manage, /table: "budget_yearly_subscriptions"/);
  assert.match(manage, /Delete "\$\{r\.name \|\| r\.key\}"/);
  assert.match(page, /id="mdSummary"/);
  assert.match(page, /js\/yearly-subscriptions\.js"><\/script>\s*<script src="js\/manage\.js"/);
  assert.match(css, /\.md-summary:not\(\[hidden\]\)/);
  assert.match(css, /max-width: 700px[\s\S]*\.md-summary:not\(\[hidden\]\) \{ grid-template-columns: 1fr; \}/);
});

test("syntax check", () => {
  for (const file of [
    "js/yearly-subscriptions.js",
    "js/manage.js",
    "js/budget-data.js",
    "js/supa.js",
    "js/login.js",
    "config.js",
    "tests/yearly-subscriptions.test.js",
  ]) {
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
  }
});
