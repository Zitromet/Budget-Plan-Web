// One-time expenses: one payment, counted on a single Friday.
// The dates below are examples of the Friday rule. They are not seed data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const FRIDAY = "2026-11-13"; // Friday. Period is Fri Nov 13 through Thu Nov 19.

function loadMath() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(read("js/one-time-expense.js"), context);
  return context;
}

function one(amount, date, extra) {
  return { inputMode: "One_Time", inputAmount: amount, oneTimeDate: date, name: "Vet", ...extra };
}

test("a normal mid-week payment counts its full amount only on that Friday", () => {
  const { oneTimeShare, oneTimeLabel, fridayBucket, fridayTotalDue } = loadMath();
  const vet = one(42.5, "2026-11-18");
  assert.equal(fridayBucket("2026-11-18"), FRIDAY);
  assert.equal(oneTimeShare(vet, FRIDAY), 42.5);
  assert.equal(oneTimeLabel(vet, FRIDAY), "Upcoming");
  assert.equal(oneTimeShare(vet, "2026-11-06"), 0);
  assert.equal(oneTimeShare(vet, "2026-11-20"), 0);
  assert.equal(fridayTotalDue(80, [vet, { inputMode: "Monthly", inputAmount: 500, oneTimeDate: "2026-11-18" }], FRIDAY), 122.5);
  assert.equal(fridayTotalDue(80, [vet], "2026-11-20"), 80);
});

test("a payment date that is exactly a Friday counts on that Friday", () => {
  const { oneTimeShare, fridayBucket, oneTimeLabel } = loadMath();
  const bill = one(19.99, FRIDAY);
  assert.equal(fridayBucket(FRIDAY), FRIDAY);
  assert.equal(oneTimeShare(bill, FRIDAY), 19.99);
  assert.equal(oneTimeShare(bill, "2026-11-06"), 0);
  assert.equal(oneTimeShare(bill, "2026-11-20"), 0);
  assert.equal(oneTimeLabel(bill, FRIDAY), "Upcoming");
});

test("the first and last day of a Friday period count, and the days outside it do not", () => {
  const { oneTimeShare, fridayBucket } = loadMath();
  assert.equal(fridayBucket(FRIDAY), FRIDAY);
  assert.equal(fridayBucket("2026-11-19"), FRIDAY);
  assert.equal(fridayBucket("2026-11-12"), "2026-11-06");
  assert.equal(fridayBucket("2026-11-20"), "2026-11-20");
  assert.equal(oneTimeShare(one(10, FRIDAY), FRIDAY), 10);
  assert.equal(oneTimeShare(one(10, "2026-11-19"), FRIDAY), 10);
  assert.equal(oneTimeShare(one(10, "2026-11-12"), FRIDAY), 0);
  assert.equal(oneTimeShare(one(10, "2026-11-20"), FRIDAY), 0);
  assert.equal(oneTimeShare(one(10, "2026-11-12"), "2026-11-06"), 10);
  assert.equal(oneTimeShare(one(10, "2026-11-20"), "2026-11-20"), 10);
});

test("past and future dates contribute $0 on the selected Friday", () => {
  const { oneTimeShare, oneTimeLabel } = loadMath();
  const past = one(75, "2026-10-30");
  const future = one(75, "2026-12-25");
  assert.equal(oneTimeShare(past, FRIDAY), 0);
  assert.equal(oneTimeShare(future, FRIDAY), 0);
  assert.equal(oneTimeLabel(past, FRIDAY), "Paid");
  assert.equal(oneTimeLabel(future, FRIDAY), "Upcoming");
  assert.equal(oneTimeShare(past, "2026-10-30"), 75);
  assert.equal(oneTimeShare(future, "2026-12-25"), 75);
});

test("a missing date or amount is rejected", () => {
  const { oneTimeError } = loadMath();
  assert.equal(oneTimeError({ mode: "One_Time", amount: "", date: "" }), "Enter an amount and a payment date for a one-time expense.");
  assert.equal(oneTimeError({ mode: "One_Time", amount: "40", date: "" }), "Enter the payment date for a one-time expense.");
  assert.equal(oneTimeError({ mode: "One_Time", amount: "40", date: "   " }), "Enter the payment date for a one-time expense.");
  assert.equal(oneTimeError({ mode: "One_Time", amount: "40", date: "2026-02-31" }), "Enter the payment date for a one-time expense.");
  assert.equal(oneTimeError({ mode: "One_Time", amount: "", date: "2026-11-18" }), "Enter an amount for a one-time expense.");
  assert.equal(oneTimeError({ mode: "One_Time", amount: "0", date: "2026-11-18" }), "Enter an amount for a one-time expense.");
  assert.equal(oneTimeError({ mode: "One_Time", amount: "-5", date: "2026-11-18" }), "Enter an amount for a one-time expense.");
  assert.equal(oneTimeError({ mode: "Monthly", amount: "", date: "" }), "");
  assert.equal(oneTimeError({ mode: "One_Time", amount: "12.50", date: "2026-11-18" }), "");
});

test("available equal to the total due leaves $0.00", () => {
  const { compareFridayCash, fridayTotalDue } = loadMath();
  const total = fridayTotalDue(80, [one(20, "2026-11-18")], FRIDAY);
  assert.equal(total, 100);
  const even = compareFridayCash(total, 100);
  assert.equal(even.kind, "leftover");
  assert.equal(even.amount, 0);
  assert.equal(even.text, "Left over: $0.00");
  const recurringOnly = compareFridayCash(50, 50);
  assert.equal(recurringOnly.text, "Left over: $0.00");
});

test("a shortfall asks to transfer from savings and a surplus shows what is left over", () => {
  const { compareFridayCash, formatMoney } = loadMath();
  const short = compareFridayCash(100, 39.5);
  assert.equal(short.kind, "shortfall");
  assert.equal(short.amount, 60.5);
  assert.equal(short.text, "Transfer from savings: $60.50");
  const left = compareFridayCash(40, 100);
  assert.equal(left.kind, "leftover");
  assert.equal(left.amount, 60);
  assert.equal(left.text, "Left over: $60.00");
  assert.equal(formatMoney(6288.56), "$6,288.56");
  assert.equal(compareFridayCash(10, 6288.56).text, "Left over: $6,278.56");
});

function dashboardScript() {
  const html = read("dashboard.html");
  const parts = html.split("<script>");
  return parts[parts.length - 1].split("</script>")[0];
}

function loadDashboard() {
  const alerts = [];
  const elements = {};
  function make(id) {
    return {
      id, innerHTML: "", textContent: "", value: "", hidden: false, className: "",
      options: [], style: {},
    };
  }
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = make(id);
      return elements[id];
    },
    createElement() { return { href: "", download: "", style: {}, click() {} }; },
  };
  const context = {
    document, alerts,
    localStorage: { getItem() { return null; }, setItem() {} },
    Date, Math, Number, String, parseInt, parseFloat, isNaN, JSON, Object, Array, Promise, Set, Map,
    console, URL, Blob: function Blob() {},
    alert(message) { alerts.push(String(message)); },
    confirm: () => false,
    clearTimeout() {}, setTimeout() { return 0; },
    sb: null,
    requireSession: async () => null,
    signOut() {},
    location: { href: "http://localhost/dashboard.html" },
  };
  vm.createContext(context);
  vm.runInContext(read("js/one-time-expense.js"), context);
  vm.runInContext(read("js/budget-data.js"), context);
  vm.runInContext(dashboardScript() + "\nfunction __state() { return STATE; }\n", context);
  return { context, elements, alerts };
}

function bill(partial) {
  return {
    id: partial.id, name: partial.name, inputMode: partial.inputMode || "Monthly",
    inputAmount: partial.inputAmount, dueDay: partial.dueDay == null ? 1 : partial.dueDay,
    manualAdd: partial.manualAdd || 0, paymentFrom: "M&T DC", payoffDate: "", url: "",
    notes: "", oneTimeDate: partial.oneTimeDate || "",
  };
}

test("one-time amounts stay out of weekly, monthly, yearly, and payoff totals", () => {
  const { context } = loadDashboard();
  const state = context.__state();
  state.baseFriday = FRIDAY;
  state.debitCardBalance = 0;
  state.ccPlanYears = 2;
  state.grossWeekly = 1000;
  state.paycheckExtra = 0;
  state.deductions = [];
  state.cards = [{ id: 1, name: "Visa", balance: 1000, aprPct: 20, otherWeekly: null, dueDay: 15, url: "" }];
  state.expenses = [
    bill({ id: 1, name: "Rent", inputMode: "Monthly", inputAmount: 120, dueDay: 15 }),
    bill({ id: 2, name: "Food", inputMode: "Weekly", inputAmount: 10, dueDay: 0 }),
  ];
  const before = context.computeAll();
  state.expenses = state.expenses.concat([
    bill({ id: 3, name: "Vet", inputMode: "One_Time", inputAmount: 40, dueDay: 0, oneTimeDate: "2026-11-18" }),
    bill({ id: 4, name: "Old", inputMode: "One_Time", inputAmount: 15, dueDay: 0, oneTimeDate: "2026-11-06" }),
    bill({ id: 5, name: "Later", inputMode: "One_Time", inputAmount: 15, dueDay: 0, oneTimeDate: "2026-11-20" }),
  ]);
  const after = context.computeAll();
  assert.equal(after.expenses.budgetMonthlyTotal, before.expenses.budgetMonthlyTotal);
  assert.equal(after.expenses.budgetWeeklyTotal, before.expenses.budgetWeeklyTotal);
  assert.equal(after.expenses.budgetYearlyTotal, before.expenses.budgetYearlyTotal);
  assert.equal(after.expenses.fridayWeeklyE32, before.expenses.fridayWeeklyE32);
  assert.equal(after.expenses.fridaySavedI32, before.expenses.fridaySavedI32);
  assert.equal(after.cards.totalMonthly, before.cards.totalMonthly);
  assert.equal(after.cards.totalDueWk, before.cards.totalDueWk);
  assert.equal(after.cards.totalEffectiveWk, before.cards.totalEffectiveWk);
  assert.equal(after.cards.totalBal, before.cards.totalBal);
  assert.equal(after.expenses.totalDue, before.expenses.totalDue + 40);
  const vet = after.expenses.rows.find(r => r.name === "Vet");
  assert.equal(vet.budgetMonthly, 0);
  assert.equal(vet.budgetWeekly, 0);
  assert.equal(vet.budgetYearly, 0);
  assert.equal(vet.cycleWeekly, 0);
  assert.equal(vet.savedTotal, 0);
  assert.equal(vet.fridayAmount, 40);
  assert.equal(vet.isDueThisWeek, true);
  assert.equal(after.expenses.rows.find(r => r.name === "Old").fridayAmount, 0);
  assert.equal(after.expenses.rows.find(r => r.name === "Later").fridayAmount, 0);
});

test("the Friday bar shows total due, transfer, leftover, and an even $0.00", () => {
  const { context, elements } = loadDashboard();
  const state = context.__state();
  state.baseFriday = FRIDAY;
  state.cards = [];
  state.deductions = [];
  state.expenses = [
    bill({ id: 1, name: "Rent", inputMode: "Monthly", inputAmount: 120, dueDay: 15 }),
    bill({ id: 2, name: "Vet", inputMode: "One_Time", inputAmount: 25.5, dueDay: 0, oneTimeDate: "2026-11-13" }),
  ];
  const saved = context.computeAll().expenses.fridaySavedI32;
  const total = saved + 25.5;

  state.debitCardBalance = total;
  context.renderAll();
  assert.equal(elements.fridayCashTotal.textContent, context.formatMoney(total));
  assert.equal(elements.fridayCashNote.textContent, "Left over: $0.00");
  assert.match(elements.fridayCashNote.className, /status-success/);
  assert.match(elements.metricsContainer.innerHTML, /Total due/);
  assert.match(elements.metricsContainer.innerHTML, /Left over: \$0\.00/);
  assert.match(elements.workspaceBody.innerHTML, /Left over: \$0\.00/);

  state.debitCardBalance = total - 10;
  context.renderAll();
  assert.equal(elements.fridayCashNote.textContent, "Transfer from savings: $10.00");
  assert.match(elements.fridayCashNote.className, /status-danger/);
  assert.match(elements.metricsContainer.innerHTML, /Transfer from savings: \$10\.00/);

  state.debitCardBalance = total + 7.25;
  context.renderAll();
  assert.equal(elements.fridayCashNote.textContent, "Left over: $7.25");
  assert.equal(elements.fridayCashTotal.textContent, context.formatMoney(total));
});

test("adding a one-time expense swaps in the date and blocks a missing date or amount", () => {
  const { context, elements, alerts } = loadDashboard();
  assert.match(elements.workspaceBody.innerHTML, /One-time \(\$\)/);
  assert.match(elements.workspaceBody.innerHTML, /id="newExpDayWrap"/);
  assert.match(elements.workspaceBody.innerHTML, /id="newExpDateWrap" style="display:none"/);
  assert.match(elements.workspaceBody.innerHTML, /toggleNewExpMode\(this\.value\)/);
  context.toggleNewExpMode("One_Time");
  assert.equal(elements.newExpDayWrap.style.display, "none");
  assert.equal(elements.newExpDateWrap.style.display, "");
  context.toggleNewExpMode("Monthly");
  assert.equal(elements.newExpDayWrap.style.display, "");
  assert.equal(elements.newExpDateWrap.style.display, "none");

  const set = (id, value) => { context.document.getElementById(id).value = value; };
  set("newExpName", "Vet");
  set("newExpMode", "One_Time");
  set("newExpAmt", "");
  set("newExpDate", "");
  set("newExpFrom", "M&T DC");
  set("newExpUrl", "https://");
  set("newExpDay", "15");
  const state = context.__state();
  context.addExpense();
  assert.equal(state.expenses.length, 0);
  assert.equal(alerts.at(-1), "Enter an amount and a payment date for a one-time expense.");

  set("newExpAmt", "40");
  context.addExpense();
  assert.equal(state.expenses.length, 0);
  assert.equal(alerts.at(-1), "Enter the payment date for a one-time expense.");

  set("newExpAmt", "");
  set("newExpDate", "2026-11-18");
  context.addExpense();
  assert.equal(state.expenses.length, 0);
  assert.equal(alerts.at(-1), "Enter an amount for a one-time expense.");

  set("newExpAmt", "40");
  set("newExpDate", "2026-11-18");
  context.addExpense();
  assert.equal(state.expenses.length, 1);
  assert.equal(state.expenses[0].inputMode, "One_Time");
  assert.equal(state.expenses[0].inputAmount, 40);
  assert.equal(state.expenses[0].oneTimeDate, "2026-11-18");
  assert.equal(state.expenses[0].dueDay, 0);
});

test("editing and deleting a one-time expense works like other expenses", () => {
  const { context, elements, alerts } = loadDashboard();
  const state = context.__state();
  state.baseFriday = FRIDAY;
  state.cards = [];
  state.deductions = [];
  state.expenses = [
    bill({ id: 7, name: "Vet", inputMode: "One_Time", inputAmount: 40, dueDay: 0, oneTimeDate: "2026-11-18" }),
    bill({ id: 8, name: "Rent", inputMode: "Monthly", inputAmount: 100, dueDay: 3 }),
  ];
  context.renderAll();
  const html = elements.workspaceBody.innerHTML;
  assert.match(html, /value="2026-11-18"/);
  assert.match(html, /Upcoming/);
  assert.match(html, /\$40\.00 this Friday/);
  assert.match(html, /onclick="removeExpense\(7\)"/);
  assert.match(html, /One-time/);
  assert.doesNotMatch(html, /Weekly \(Day 0\)[\s\S]*seg-count">2/);

  context.updateExpenseField(7, "inputAmount", "18.75");
  assert.equal(state.expenses.find(e => e.id === 7).inputAmount, 18.75);
  context.updateExpenseField(7, "oneTimeDate", "2026-11-19");
  assert.equal(state.expenses.find(e => e.id === 7).oneTimeDate, "2026-11-19");
  context.updateExpenseField(7, "oneTimeDate", "");
  assert.equal(alerts.at(-1), "Enter the payment date for a one-time expense.");
  assert.equal(state.expenses.find(e => e.id === 7).oneTimeDate, "2026-11-19");
  context.updateExpenseField(7, "inputAmount", "0");
  assert.equal(alerts.at(-1), "Enter an amount for a one-time expense.");
  assert.equal(state.expenses.find(e => e.id === 7).inputAmount, 18.75);

  context.updateExpenseField(8, "inputMode", "One_Time");
  assert.match(alerts.at(-1), /payment date/);
  assert.equal(state.expenses.find(e => e.id === 8).inputMode, "Monthly");

  state.baseFriday = "2026-11-20";
  context.renderAll();
  assert.match(elements.workspaceBody.innerHTML, /Paid/);
  assert.match(elements.workspaceBody.innerHTML, /\$0\.00 this Friday/);

  context.removeExpense(7);
  assert.equal(state.expenses.some(e => e.id === 7), false);
  assert.equal(state.expenses.length, 1);
});

test("stored rows keep one_time_date on one-time expenses only", () => {
  const context = { document: { getElementById() { return {}; } }, localStorage: { getItem() { return null; }, setItem() {} } };
  vm.createContext(context);
  vm.runInContext(read("js/budget-data.js") + "\nthis.__to = expToRow;\nthis.__from = expFromRow;\n", context);
  const monthly = plain(context.__to({ name: "Rent", inputMode: "Monthly", inputAmount: 10, dueDay: 1, manualAdd: 0, paymentFrom: "M&T DC", payoffDate: "", url: "", notes: "" }, 0));
  assert.equal("one_time_date" in monthly, false);
  assert.equal(monthly.input_mode, "Monthly");
  const once = plain(context.__to({ name: "Vet", inputMode: "One_Time", inputAmount: 40, dueDay: 0, manualAdd: 0, paymentFrom: "M&T DC", payoffDate: "", url: "", notes: "", oneTimeDate: "2026-11-18" }, 1));
  assert.equal(once.input_mode, "One_Time");
  assert.equal(once.one_time_date, "2026-11-18");
  assert.equal(once.due_day, 0);
  const loaded = context.__from({ id: 3, name: "Vet", input_mode: "One_Time", input_amount: "40.00", due_day: 0, manual_add: 0, payment_from: "M&T DC", payoff_date: null, url: "", notes: "", one_time_date: "2026-11-18" });
  assert.equal(loaded.oneTimeDate, "2026-11-18");
  assert.equal(loaded.inputMode, "One_Time");
  assert.equal(context.__from({ id: 4, name: "Rent", input_mode: "Monthly", input_amount: 1, due_day: 1, manual_add: 0 }).oneTimeDate, "");
});

function loadManage() {
  const alerts = [];
  const elements = {};
  function make(id) {
    return {
      id, innerHTML: "", textContent: "", value: "", hidden: true, open: false,
      onclick: null, onsubmit: null,
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
    document, alerts,
    location: { hash: "" },
    console,
    requireSession: async () => null,
    alert(message) { alerts.push(String(message)); },
    confirm: () => false,
  };
  vm.createContext(context);
  vm.runInContext(read("js/one-time-expense.js"), context);
  vm.runInContext(read("js/yearly-subscriptions.js"), context);
  vm.runInContext(read("js/manage.js") + "\nfunction __set(tab, rows) { TAB = tab; ROWS = rows; render(); }\n", context);
  return { context, elements, alerts };
}

test("manage data can add, edit, and delete a one-time expense and rejects a missing date", async () => {
  const { context, elements, alerts } = loadManage();
  const calls = [];
  function query() {
    const q = {
      select() { return q; },
      order() { return q; },
      insert(data) { calls.push(["insert", data]); return q; },
      update(data) { calls.push(["update", data]); return q; },
      delete() { calls.push("delete"); return q; },
      eq(col, key) { calls.push(["eq", col, key]); return q; },
      then(resolve) { return Promise.resolve(resolve({ data: [], error: null })); },
    };
    return q;
  }
  context.sb = { from(table) { calls.push(["from", table]); return query(); } };
  context.check = result => result.data;
  context.__set("expenses", []);
  context.openForm(null);
  assert.match(elements.mdForm.innerHTML, /One_Time/);
  assert.match(elements.mdForm.innerHTML, /id="f_one_time_date"/);
  const set = (id, value) => { context.document.getElementById(id).value = value; };
  set("f_name", "Vet");
  set("f_input_mode", "One_Time");
  set("f_input_amount", "40");
  set("f_due_day", "0");
  set("f_one_time_date", "");
  set("f_payment_from", "M&T DC");
  set("f_manual_add", "0");
  set("f_payoff_date", "");
  set("f_payments_left_override", "");
  set("f_url", "");
  set("f_notes", "");
  set("f_active", "true");
  set("f_sort_order", "1");
  await elements.mdForm.onsubmit({ preventDefault() {} });
  assert.equal(alerts.at(-1), "Enter the payment date for a one-time expense.");
  assert.equal(calls.some(c => Array.isArray(c) && c[0] === "insert"), false);
  assert.equal(elements.mdDialog.open, true);

  set("f_one_time_date", "2026-11-18");
  await elements.mdForm.onsubmit({ preventDefault() {} });
  const inserted = calls.find(c => Array.isArray(c) && c[0] === "insert")[1];
  assert.equal(inserted.input_mode, "One_Time");
  assert.equal(inserted.one_time_date, "2026-11-18");
  assert.equal(inserted.input_amount, 40);

  calls.length = 0;
  const row = { id: 9, name: "Vet", input_mode: "One_Time", input_amount: 40, due_day: 0, one_time_date: "2026-11-18", payment_from: "M&T DC", manual_add: 0, payoff_date: null, payments_left_override: null, url: "", notes: "", active: true, sort_order: 1 };
  context.__set("expenses", [row]);
  context.edit("9");
  set("f_name", "Vet");
  set("f_input_mode", "One_Time");
  set("f_input_amount", "40");
  set("f_due_day", "0");
  set("f_one_time_date", "2026-11-19");
  set("f_payment_from", "M&T DC");
  set("f_manual_add", "0");
  set("f_payoff_date", "");
  set("f_payments_left_override", "");
  set("f_url", "");
  set("f_notes", "");
  set("f_active", "true");
  set("f_sort_order", "1");
  await elements.mdForm.onsubmit({ preventDefault() {} });
  assert.equal(plain(calls.find(c => Array.isArray(c) && c[0] === "update")[1]).one_time_date, "2026-11-19");

  calls.length = 0;
  context.__set("expenses", [row]);
  context.confirm = () => false;
  await context.del("9");
  assert.equal(calls.includes("delete"), false);
  context.confirm = () => true;
  await context.del("9");
  assert.equal(calls.includes("delete"), true);
  assert.equal(calls.find(c => Array.isArray(c) && c[0] === "from")[1], "budget_expenses");

  calls.length = 0;
  context.__set("expenses", []);
  context.openForm(null);
  set("f_name", "Rent");
  set("f_input_mode", "Monthly");
  set("f_input_amount", "10");
  set("f_due_day", "1");
  set("f_one_time_date", "");
  set("f_payment_from", "M&T DC");
  set("f_manual_add", "0");
  set("f_payoff_date", "");
  set("f_payments_left_override", "");
  set("f_url", "");
  set("f_notes", "");
  set("f_active", "true");
  set("f_sort_order", "1");
  await elements.mdForm.onsubmit({ preventDefault() {} });
  const monthly = calls.find(c => Array.isArray(c) && c[0] === "insert")[1];
  assert.equal(monthly.input_mode, "Monthly");
  assert.equal("one_time_date" in monthly, false);
});

test("the migration only adds one_time_date and allows the One_Time mode", () => {
  const sql = read("supabase/migrations/20261114150000_budget_expenses_one_time_date.sql");
  assert.match(sql, /ALTER TABLE public\.budget_expenses\s+ADD COLUMN one_time_date date\s*;/);
  assert.match(sql, /'Weekly'::text, 'Monthly'::text, 'CC_Link'::text, 'One_Time'::text/);
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|INSERT|DROP TABLE|TRUNCATE)\b/i);
  const data = read("js/budget-data.js");
  const dash = read("dashboard.html");
  const subs = read("js/yearly-subscriptions.js");
  assert.match(dash, /Yearly subscriptions are not part of STATE/);
  assert.doesNotMatch(subs, /One_Time|one_time_date/);
  assert.match(data, /budget_yearly_subscriptions is intentionally not in TABLES/);
  new vm.Script(dashboardScript());
});

test("syntax check", () => {
  for (const file of ["js/one-time-expense.js", "js/manage.js", "js/budget-data.js", "tests/one-time-expense.test.js"]) {
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
  }
});
