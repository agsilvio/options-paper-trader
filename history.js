import * as store from "./portfolio.js";
import { h, icon, usd, signedUsd, px, pnlClass, fmtDate, computeTally, navbar, statCard, emptyState, toast, dialog } from "./ui.js";

const app = document.getElementById("app");

const state = {
  dir: null,
  needsReconnect: false,
  accounts: {},
  events: [],
  filter: "",
  busy: false,
};

const EVENT_STYLES = {
  create: ["Created", "bg-primary-subtle text-primary-emphasis"],
  set_starting_funds: ["Funds set", "bg-warning-subtle text-warning-emphasis"],
  open: ["Open", "bg-info-subtle text-info-emphasis"],
  close: ["Close", "bg-secondary-subtle text-secondary-emphasis"],
  expire: ["Expiry", "bg-warning-subtle text-warning-emphasis"],
  close_out: ["Close-out", "bg-success-subtle text-success-emphasis"],
  rename: ["Renamed", "bg-secondary-subtle text-secondary-emphasis"],
  delete_account: ["Deleted", "bg-danger-subtle text-danger-emphasis"],
  history_cleared: ["Cleared", "bg-dark-subtle text-body-secondary"],
};

function eventBadge(e) {
  let [label, cls] = EVENT_STYLES[e.type] || [e.type, "bg-secondary-subtle text-secondary-emphasis"];
  if (e.type === "close_out" && e.outcome !== "success") cls = "bg-danger-subtle text-danger-emphasis";
  return h("span", { class: `badge ${cls}` }, label);
}

const fillText = (e) => (e.slippage ? `${px(e.price)} (mid ${px(e.mid)}, ${e.slippage}% slippage)` : `mid ${px(e.price)}`);

function describe(e) {
  switch (e.type) {
    case "create":
      return `Account created with ${usd(e.startingFunds ?? e.cash)}`;
    case "set_starting_funds":
      return `Starting funds changed from ${usd(e.from)} to ${usd(e.to)}`;
    case "open":
      return `${e.qty > 0 ? "Bought" : "Sold"} ${Math.abs(e.qty)} × ${e.label} at ${fillText(e)} · cash ${usd(e.cash)}`;
    case "close":
      return h("span", {}, `Closed ${Math.abs(e.qty)} × ${e.label}: ${px(e.openPrice)} → ${fillText(e)} · `, h("span", { class: pnlClass(e.pnl) }, signedUsd(e.pnl)), ` · cash ${usd(e.cash)}`);
    case "expire":
      return h(
        "span",
        {},
        `${{ expired: "Expired worthless", exercised: "Exercised", assigned: "Assigned" }[e.settlement]}: ${Math.abs(e.qty)} × ${e.label} · stock closed at ${px(e.underlyingClose)} · settled at ${px(e.price)} · `,
        h("span", { class: pnlClass(e.pnl) }, signedUsd(e.pnl)),
        ` · cash ${usd(e.cash)}`
      );
    case "close_out":
      return h(
        "span",
        {},
        `${e.outcome === "success" ? "Successful" : "Failed"}: ${usd(e.startingFunds)} → ${usd(e.finalFunds)} (`,
        h("span", { class: pnlClass(e.pnl) }, signedUsd(e.pnl)),
        `) · ${e.trades} trades, ${e.winningTrades} won / ${e.losingTrades} lost`
      );
    case "rename":
      return `Renamed from ${e.from} to ${e.to}`;
    case "delete_account":
      return `Deleted (${e.status === "closed" ? (e.outcome === "success" ? "successful" : "failed") : "active"}) · starting ${usd(e.startingFunds)} · cash ${usd(e.cash)} · ${e.openPositions} open, ${e.trades} closed trades`;
    case "history_cleared":
      return `History cleared (${e.removedEvents} events removed)`;
    default:
      return JSON.stringify(e);
  }
}

async function load() {
  state.accounts = {};
  state.events = [];
  for (const name of await store.listAccounts(state.dir)) {
    try {
      state.accounts[name] = await store.loadAccount(state.dir, name);
    } catch {
      continue;
    }
    for (const e of await store.readHistory(state.dir, name)) state.events.push({ ...e, account: name });
  }
  for (const e of await store.readHistory(state.dir, store.GLOBAL)) state.events.push({ account: "(global)", ...e });
  state.events.sort((a, b) => b.time - a.time);
  if (state.filter && !state.accounts[state.filter]) state.filter = "";
}

async function connect(interactive) {
  const dir = await store.getDir();
  if (!dir) return;
  state.dir = dir;
  state.needsReconnect = (await store.permission(dir, interactive)) !== "granted";
  if (!state.needsReconnect) await load();
}

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

async function clearHistory() {
  const names = state.filter ? [state.filter] : [...Object.keys(state.accounts), store.GLOBAL];
  const ok = await dialog({
    title: "Clear history",
    message: h(
      "div",
      {},
      h("p", {}, "Permanently remove the event log of ", h("b", {}, state.filter ? `"${state.filter}"` : "all accounts"), "?"),
      h("p", { class: "text-body-secondary mb-0 small" }, "Accounts, positions and tallies are not affected. A single entry noting the clear will remain.")
    ),
    confirmText: "Clear history",
    variant: "danger",
  });
  if (!ok) return;
  const removedEvents = await store.clearHistory(state.dir, names);
  await store.appendHistory(state.dir, state.filter || store.GLOBAL, {
    time: Date.now(),
    type: "history_cleared",
    account: state.filter || "(all accounts)",
    removedEvents,
  });
  await load();
  toast(`Removed ${removedEvents} events`);
}

function renderStats() {
  const list = Object.values(state.accounts);
  const tally = computeTally(list);
  const decided = tally.success + tally.failed;
  const totalPnl = list.filter((a) => a.status === "closed").reduce((sum, a) => sum + (a.finalFunds - a.startingFunds), 0);
  return h(
    "div",
    { class: "row row-cols-2 row-cols-md-3 row-cols-xl-5 g-3 mb-4" },
    statCard("Successful", tally.success, { valueClass: "text-success", sub: "Closed out with a profit" }),
    statCard("Failed", tally.failed, { valueClass: "text-danger", sub: "Closed out flat or at a loss" }),
    statCard("Success rate", decided ? `${Math.round((tally.success / decided) * 100)}%` : "–", { sub: `${decided} closed-out account${decided === 1 ? "" : "s"}` }),
    statCard("Active", tally.active, { sub: "Still trading" }),
    statCard("Closed-out P&L", signedUsd(decided ? totalPnl : 0), { valueClass: pnlClass(totalPnl), sub: "Across closed-out accounts" })
  );
}

function renderAccounts() {
  const names = Object.keys(state.accounts);
  const header = h("div", { class: "card-header d-flex align-items-center gap-2" }, h("span", { class: "fw-semibold" }, "Accounts"), h("span", { class: "badge text-bg-secondary rounded-pill" }, names.length));
  if (!names.length) return h("div", { class: "card mb-4" }, header, emptyState("wallet2", "No accounts yet", null));
  return h(
    "div",
    { class: "card mb-4" },
    header,
    h(
      "div",
      { class: "table-responsive" },
      h(
        "table",
        { class: "table table-hover align-middle" },
        h("thead", {}, h("tr", {}, h("th", {}, "Account"), h("th", {}, "Status"), h("th", { class: "num" }, "Created"), h("th", { class: "num" }, "Closed"), h("th", { class: "num" }, "Starting"), h("th", { class: "num" }, "Final / current cash"), h("th", { class: "num" }, "P&L"))),
        h(
          "tbody",
          {},
          names.map((name) => {
            const a = state.accounts[name];
            const closed = a.status === "closed";
            const end = closed ? a.finalFunds : a.cash;
            const profit = typeof end === "number" && typeof a.startingFunds === "number" ? end - a.startingFunds : null;
            const status = !closed
              ? h("span", { class: "badge bg-primary-subtle text-primary-emphasis" }, "Active")
              : a.outcome === "success"
                ? h("span", { class: "badge bg-success-subtle text-success-emphasis" }, icon("check-circle", "me-1"), "Successful")
                : h("span", { class: "badge bg-danger-subtle text-danger-emphasis" }, icon("x-circle", "me-1"), "Failed");
            return h(
              "tr",
              {},
              h("td", { class: "fw-semibold" }, name),
              h("td", {}, status),
              h("td", { class: "num" }, fmtDate(a.created)),
              h("td", { class: "num" }, fmtDate(a.closedAt)),
              h("td", { class: "num" }, usd(a.startingFunds)),
              h("td", { class: "num" }, usd(end)),
              h("td", { class: `num fw-semibold ${pnlClass(profit)}` }, signedUsd(profit))
            );
          })
        )
      )
    )
  );
}

function renderEvents() {
  const events = state.filter ? state.events.filter((e) => e.account === state.filter) : state.events;
  const select = h(
    "select",
    { class: "form-select form-select-sm", id: "history-filter", style: "width:auto", onchange: (e) => { state.filter = e.target.value; render(); } },
    h("option", { value: "", selected: !state.filter }, "All accounts"),
    Object.keys(state.accounts).map((n) => h("option", { value: n, selected: n === state.filter }, n))
  );
  const header = h(
    "div",
    { class: "card-header d-flex flex-wrap align-items-center gap-2" },
    h("span", { class: "fw-semibold" }, "Event log"),
    h("span", { class: "badge text-bg-secondary rounded-pill" }, events.length),
    h("div", { class: "ms-auto d-flex align-items-center gap-2" },
      h("label", { class: "small text-body-secondary", htmlFor: "history-filter" }, "Account"),
      select,
      h("button", { class: "btn btn-sm btn-outline-danger", disabled: state.busy, onclick: () => run(clearHistory) }, icon("trash", "me-1"), state.filter ? "Clear this account" : "Clear all"))
  );
  if (!events.length) return h("div", { class: "card" }, header, emptyState("clock-history", "No history yet", null));
  return h(
    "div",
    { class: "card" },
    header,
    h(
      "div",
      { class: "table-responsive" },
      h(
        "table",
        { class: "table table-hover align-middle" },
        h("thead", {}, h("tr", {}, h("th", {}, "Time"), h("th", {}, "Account"), h("th", {}, "Event"), h("th", {}, "Details"))),
        h(
          "tbody",
          {},
          events.map((e) =>
            h(
              "tr",
              { title: JSON.stringify(e) },
              h("td", { class: "text-body-secondary text-nowrap" }, new Date(e.time).toLocaleString()),
              h("td", { class: "fw-semibold" }, e.account),
              h("td", {}, eventBadge(e)),
              h("td", {}, describe(e))
            )
          )
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
      h("h5", { class: "mt-3" }, first ? "No online store yet" : "Reconnect your online store"),
      h("p", { class: "text-body-secondary" }, first ? "Connect an online store on the Portfolio page first." : `Could not reach "${state.dir.name}".`),
      first
        ? h("a", { class: "btn btn-primary", href: "options.html#portfolio" }, "Go to Portfolio")
        : h("button", { class: "btn btn-primary", onclick: () => run(() => connect(true)) }, "Retry")
    )
  );
}

function render() {
  const ready = state.dir && !state.needsReconnect;
  const title = h(
    "div",
    { class: "d-flex align-items-center mb-4" },
    h("h4", { class: "mb-0" }, "History & tallies"),
    h("button", { class: "btn btn-outline-secondary ms-auto", disabled: state.busy, onclick: () => run(load) }, icon("arrow-clockwise", "me-1"), "Reload")
  );
  app.replaceChildren(
    navbar("history", ready ? computeTally(Object.values(state.accounts)) : null),
    h("main", { class: "container-xl pb-5" }, ready ? h("div", {}, title, renderStats(), renderAccounts(), renderEvents()) : renderGate())
  );
}

render();
run(() => connect(false));
