import * as store from "./portfolio.js";
import { SLIPPAGE_OPTIONS } from "./fills.js";
import { settleExpired } from "./settlement.js";
import { connectStore, h, icon, usd, signedUsd, pnlClass, fmtDate, computeTally, navbar, emptyState, toast, dialog, summaryList } from "./ui.js";

const app = document.getElementById("app");

const state = {
  dir: null,
  needsReconnect: false,
  names: [],
  all: {},
  current: localStorage.getItem("account"),
  defaultFunds: store.ACCOUNT_DEFAULTS.defaultFunds,
  busy: false,
};

const fundsSet = (data) => typeof data.startingFunds === "number" && typeof data.cash === "number";

async function run(fn) {
  state.busy = true;
  render();
  try {
    await fn();
  } catch (err) {
    toast(err.message, "danger");
  }
  state.busy = false;
  render();
}

async function load() {
  state.names = await store.listAccounts(state.dir);
  state.all = {};
  let settleError = null;
  for (const name of state.names) {
    try {
      state.all[name] = await store.loadAccount(state.dir, name);
    } catch {
      state.all[name] = null;
      continue;
    }
    try {
      const events = await settleExpired(state.all[name]);
      if (!events.length) continue;
      await store.saveAccount(state.dir, name, state.all[name]);
      for (const e of events) await store.appendHistory(state.dir, name, e);
    } catch (err) {
      settleError = err;
    }
  }
  if (settleError) toast(`Could not settle expired positions: ${settleError.message}`, "danger");
}

async function connect(interactive) {
  const dir = await store.getDir();
  if (!dir) return;
  state.dir = dir;
  state.needsReconnect = (await store.permission(dir, interactive)) !== "granted";
  if (!state.needsReconnect) await load();
}

const record = (name, entry) => store.appendHistory(state.dir, name, { time: Date.now(), ...entry });

async function setCurrent(name) {
  state.current = name;
  localStorage.setItem("account", name);
  await chrome.storage.local.set({ currentAccount: name });
}

function parseFunds(value) {
  const amount = Number(value);
  if (value === "" || !Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid amount");
  return amount;
}

async function createAccount() {
  const values = await dialog({
    title: "New account",
    fields: [
      { name: "name", label: "Account name" },
      { name: "funds", label: "Starting funds", type: "number", value: state.defaultFunds, prefix: "$", step: "1000", min: "0", help: "This can't be changed after the account is created." },
      { name: "slippage", label: "Fill price", type: "select", options: SLIPPAGE_OPTIONS, value: store.ACCOUNT_DEFAULTS.slippage, help: "Slippage moves each fill from the mid toward the worse side of the spread. It can't be changed after the account is created." },
    ],
    confirmText: "Create account",
  });
  if (!values) return;
  if (!values.name.trim()) throw new Error("Enter an account name");
  const funds = parseFunds(values.funds);
  const created = await store.createAccount(state.dir, values.name, funds, Number(values.slippage));
  await record(created.name, { type: "create", startingFunds: funds, slippage: Number(values.slippage) });
  if (!state.current || !state.all[state.current]) await setCurrent(created.name);
  await load();
  toast(`Created account "${created.name}"`);
}

async function renameAccount(oldName) {
  const values = await dialog({ title: "Rename account", fields: [{ name: "name", label: "Account name", value: oldName }], confirmText: "Rename" });
  if (!values) return;
  const name = await store.renameAccount(state.dir, oldName, values.name);
  if (state.current === oldName) await setCurrent(name);
  await load();
  toast(`Renamed to "${name}"`);
}

async function closeOut(name) {
  const data = state.all[name];
  if (data.status === "closed") throw new Error("This account is already closed out");
  if (data.positions.length) throw new Error("Close all open positions before closing out the account");
  if (!fundsSet(data)) throw new Error("This account has no starting funds recorded, so it can't be closed out. Delete it instead.");
  const finalFunds = data.cash;
  const profit = finalFunds - data.startingFunds;
  const outcome = profit > 0 ? "success" : "failed";
  const ok = await dialog({
    title: `Close out · ${name}`,
    message: h(
      "div",
      {},
      summaryList([
        ["Starting funds", usd(data.startingFunds)],
        ["Final funds", usd(finalFunds)],
        ["P&L", signedUsd(profit), pnlClass(profit)],
        ["Trades", String(data.closed.length)],
      ]),
      h(
        "div",
        { class: `alert ${outcome === "success" ? "alert-success" : "alert-danger"} mt-3 mb-0` },
        "This account will be recorded as ",
        h("b", {}, outcome === "success" ? "successful" : "failed"),
        " and can no longer be traded."
      )
    ),
    confirmText: "Close out",
    variant: outcome === "success" ? "success" : "danger",
  });
  if (!ok) return;
  const wins = data.closed.filter((c) => c.pnl > 0).length;
  data.status = "closed";
  data.closedAt = Date.now();
  data.finalFunds = finalFunds;
  data.outcome = outcome;
  await store.saveAccount(state.dir, name, data);
  await record(name, {
    type: "close_out",
    outcome,
    startingFunds: data.startingFunds,
    finalFunds,
    pnl: profit,
    createdAt: data.created,
    closedAt: data.closedAt,
    trades: data.closed.length,
    winningTrades: wins,
    losingTrades: data.closed.length - wins,
    tally: computeTally(Object.values(state.all).filter(Boolean)),
  });
  toast(`"${name}" closed out as ${outcome === "success" ? "successful" : "failed"}`, outcome === "success" ? "success" : "danger");
}

async function deleteAccount(name) {
  const data = state.all[name];
  const open = data ? data.positions.length : 0;
  const ok = await dialog({
    title: "Delete account",
    message: h(
      "div",
      {},
      h("p", {}, "This permanently removes ", h("b", {}, name), " and its history file. A record of the deletion is kept in the global history."),
      open ? h("div", { class: "alert alert-warning mb-0" }, icon("exclamation-triangle", "me-2"), `It still has ${open} open position${open === 1 ? "" : "s"}.`) : null
    ),
    confirmText: "Delete account",
    variant: "danger",
  });
  if (!ok) return;
  await store.deleteAccount(state.dir, name);
  await store.appendHistory(state.dir, store.GLOBAL, {
    time: Date.now(),
    type: "delete_account",
    account: name,
    status: data?.status || "open",
    outcome: data?.outcome ?? null,
    startingFunds: data?.startingFunds ?? null,
    cash: data?.cash ?? null,
    openPositions: open,
    trades: data ? data.closed.length : 0,
  });
  await load();
  if (state.current === name) {
    if (state.names.length) await setCurrent(state.names[0]);
    else {
      state.current = null;
      localStorage.removeItem("account");
      await chrome.storage.local.remove("currentAccount");
    }
  }
  toast(`Deleted account "${name}"`);
}

async function openInPortfolio(name) {
  await setCurrent(name);
  location.href = "options.html#portfolio";
}

function statusBadge(data) {
  if (data.status !== "closed") return h("span", { class: "badge bg-primary-subtle text-primary-emphasis" }, "Active");
  return data.outcome === "success"
    ? h("span", { class: "badge bg-success-subtle text-success-emphasis" }, icon("check-circle", "me-1"), "Successful")
    : h("span", { class: "badge bg-danger-subtle text-danger-emphasis" }, icon("x-circle", "me-1"), "Failed");
}

function actionButton(iconName, label, onclick, variant = "outline-secondary") {
  return h("button", { class: `btn btn-sm btn-${variant}`, title: label, disabled: state.busy, onclick: () => run(onclick) }, icon(iconName, "me-1"), label);
}

function renderRow(name) {
  const data = state.all[name];
  if (!data) {
    return h(
      "tr",
      {},
      h("td", { class: "fw-semibold" }, name),
      h("td", { colSpan: 6, class: "text-danger" }, "Unreadable account file"),
      h("td", { class: "text-end" }, actionButton("trash", "Delete", () => deleteAccount(name), "outline-danger"))
    );
  }
  const closed = data.status === "closed";
  const end = closed ? data.finalFunds : data.cash;
  const unset = typeof data.startingFunds !== "number";
  const profit = typeof end === "number" && !unset ? end - data.startingFunds : null;
  return h(
    "tr",
    {},
    h(
      "td",
      {},
      h("div", { class: "fw-semibold" }, name, name === state.current ? h("span", { class: "badge text-bg-primary ms-2" }, "Current") : null),
      h("div", { class: "small text-body-secondary" }, `Created ${fmtDate(data.created)}${closed ? ` · closed ${fmtDate(data.closedAt)}` : ""}`)
    ),
    h("td", {}, statusBadge(data)),
    h("td", { class: "num" }, unset ? h("span", { class: "text-warning" }, "Not set") : usd(data.startingFunds)),
    h("td", { class: "num" }, usd(end)),
    h("td", { class: `num fw-semibold ${pnlClass(profit)}` }, signedUsd(profit)),
    h("td", { class: "num" }, data.positions.length),
    h("td", { class: "num" }, data.closed.length),
    h(
      "td",
      { class: "text-end" },
      h(
        "div",
        { class: "d-inline-flex flex-wrap justify-content-end gap-1" },
        actionButton("box-arrow-up-right", "Open", () => openInPortfolio(name), "outline-primary"),
        actionButton("pencil", "Rename", () => renameAccount(name)),
        closed ? null : actionButton("flag", "Close out", () => closeOut(name)),
        actionButton("trash", "Delete", () => deleteAccount(name), "outline-danger")
      )
    )
  );
}

function renderAccounts() {
  const header = h(
    "div",
    { class: "d-flex align-items-center mb-4" },
    h("div", {}, h("h4", { class: "mb-1" }, "Accounts"), h("div", { class: "small text-body-secondary" }, "Create and manage paper accounts. Starting funds are set when an account is created.")),
    h("button", { class: "btn btn-primary ms-auto", disabled: state.busy, onclick: () => run(createAccount) }, icon("plus-lg", "me-1"), "New account")
  );
  if (!state.names.length) {
    return h(
      "div",
      {},
      header,
      h("div", { class: "card" }, emptyState("wallet2", "No accounts yet", "Create your first paper account to start trading from TradingView."))
    );
  }
  return h(
    "div",
    {},
    header,
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "table-responsive" },
        h(
          "table",
          { class: "table table-hover align-middle" },
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              h("th", {}, "Account"),
              h("th", {}, "Status"),
              h("th", { class: "num" }, "Starting funds"),
              h("th", { class: "num" }, "Cash / final"),
              h("th", { class: "num" }, "P&L"),
              h("th", { class: "num" }, "Open"),
              h("th", { class: "num" }, "Trades"),
              h("th", {})
            )
          ),
          h("tbody", {}, state.names.map(renderRow))
        )
      )
    )
  );
}

function renderGate() {
  const first = !state.dir;
  return h(
    "div",
    { class: "card gate" },
    h(
      "div",
      { class: "card-body text-center p-5" },
      icon(first ? "cloud-plus" : "cloud-slash", "fs-1 text-primary"),
      h("h5", { class: "mt-3" }, first ? "Connect an online store" : "Reconnect your online store"),
      h("p", { class: "text-body-secondary" }, first ? "Your accounts and history are saved in a free online store. Set it up on the Settings page." : `Could not reach "${state.dir.name}".`),
      first
        ? h("button", { class: "btn btn-primary", onclick: () => run(async () => { const dir = await connectStore(); if (!dir) return; state.dir = dir; state.needsReconnect = false; await load(); }) }, "Connect")
        : h("button", { class: "btn btn-primary", onclick: () => run(() => connect(true)) }, "Retry")
    )
  );
}

function render() {
  const ready = state.dir && !state.needsReconnect;
  app.replaceChildren(
    navbar("accounts", ready ? computeTally(Object.values(state.all).filter(Boolean)) : null),
    h("main", { class: "container-xl pb-5" }, ready ? renderAccounts() : renderGate())
  );
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !state.busy && state.dir && !state.needsReconnect) run(load);
});

render();
run(async () => {
  await connect(false);
});
