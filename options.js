import * as market from "./marketdata.js";
import * as store from "./portfolio.js";
import { getConfig, clearConfig, makeSyncCode, LocalDir } from "./mantle.js";
import { settleExpired, isExpired, SETTLEMENT_LABELS } from "./settlement.js";
import { quoteFills, accountSlippage, describeFill, fillPrice } from "./fills.js";
import { connectStore, h, icon, usd, signedUsd, px, pnlClass, fmtDate, computeTally, navbar, statCard, emptyState, toast, dialog, summaryList } from "./ui.js";

const MULT = 100;
const app = document.getElementById("app");

const viewFromHash = () => (location.hash === "#settings" ? "settings" : "portfolio");

const state = {
  view: viewFromHash(),
  dir: null,
  config: null,
  showKey: false,
  needsReconnect: false,
  accounts: [],
  current: localStorage.getItem("account"),
  data: null,
  all: {},
  busy: false,
};

const markOf = (p) => p.lastClose ?? p.lastMid ?? null;
const pnl = (pos, price) => (price == null ? null : (price - pos.openPrice) * pos.qty * MULT);
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

async function persist() {
  await store.saveAccount(state.dir, state.current, state.data);
}

async function record(entry) {
  await store.appendHistory(state.dir, state.current, { time: Date.now(), ...entry });
}

async function loadAccounts() {
  state.accounts = await store.listAccounts(state.dir);
  state.all = {};
  for (const name of state.accounts) {
    try {
      state.all[name] = await store.loadAccount(state.dir, name);
    } catch {
      state.all[name] = { status: "open", positions: [], closed: [] };
    }
  }
  if (!state.accounts.includes(state.current)) state.current = state.accounts[0] || null;
  state.data = state.current ? state.all[state.current] : null;
  if (state.current) {
    localStorage.setItem("account", state.current);
    await chrome.storage.local.set({ currentAccount: state.current });
  }
}

async function connect(interactive) {
  const dir = await store.getDir();
  if (!dir) return;
  state.dir = dir;
  state.config = await getConfig();
  state.needsReconnect = (await store.permission(dir, interactive)) !== "granted";
  if (!state.needsReconnect) await loadAccounts();
}

async function chooseStore() {
  const dir = await connectStore();
  if (!dir) return;
  state.dir = dir;
  state.config = await getConfig();
  state.needsReconnect = false;
  await loadAccounts();
  toast(`Connected to "${state.dir.name}"`);
}

async function disconnectStore() {
  const ok = await dialog({
    title: "Turn off online sync",
    message: "This forgets the sync code in this browser and switches back to the accounts saved on this device. Your data stays in the online store, but this device's copy may be out of date. Make sure you have saved the sync code.",
    confirmText: "Disconnect",
    variant: "danger",
  });
  if (!ok) return;
  await clearConfig();
  state.dir = new LocalDir();
  state.config = null;
  await loadAccounts();
}

async function downloadBackup() {
  const files = {};
  for (const name of await state.dir.list()) files[name] = await state.dir.read(name);
  const blob = new Blob([JSON.stringify({ optpaperBackup: 1, created: new Date().toISOString(), files }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `options-paper-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function restoreBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    run(async () => {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("That file is not a valid backup.");
      }
      if (!data || data.optpaperBackup !== 1 || typeof data.files !== "object") throw new Error("That file is not an Options Paper backup.");
      const ok = await dialog({ title: "Restore backup", message: "Files with the same name as the backup's files are replaced.", confirmText: "Restore", variant: "danger" });
      if (!ok) return;
      let count = 0;
      for (const [name, text] of Object.entries(data.files)) {
        if (typeof text !== "string" || !/^[^/\\]+\.(json|jsonl)$/.test(name)) continue;
        await state.dir.write(name, text);
        count++;
      }
      await loadAccounts();
      toast(`Restored ${count} file${count === 1 ? "" : "s"}`);
    });
  });
  input.click();
}

async function copySyncCode() {
  await navigator.clipboard.writeText(makeSyncCode(state.config.namespace, state.config.key));
  toast("Sync code copied");
}

function importFromFolder() {
  const input = document.createElement("input");
  input.type = "file";
  input.webkitdirectory = true;
  input.multiple = true;
  input.addEventListener("change", () => {
    const files = [...input.files];
    if (!files.length) return;
    run(async () => {
      const count = await store.importFiles(state.dir, files);
      await loadAccounts();
      toast(`Imported ${count} file${count === 1 ? "" : "s"}`);
    });
  });
  input.click();
}

async function refreshMarks() {
  const data = state.data;
  if (!data) return;
  const settled = await settleExpired(data);
  if (settled.length) {
    await persist();
    for (const e of settled) await record(e);
    toast(`Settled ${settled.length} expired position${settled.length === 1 ? "" : "s"}`);
  }
  const live = data.positions.filter((p) => !isExpired(p));
  if (!live.length) return;
  const [quotes, stocks, pct] = await Promise.all([
    market.optionQuotes(live.map((p) => p.symbolId)),
    market.stockPrices(live.map((p) => p.underlyingId)),
    accountSlippage(data),
  ]);
  const now = Date.now();
  for (const p of live) {
    const exit = fillPrice(quotes[p.symbolId], p.qty > 0 ? "sell" : "buy", pct);
    if (exit) {
      p.lastMid = exit.mid;
      p.lastClose = exit.price;
      p.lastSlippage = pct;
    }
    if (stocks[p.underlyingId] != null) p.lastUnderlying = stocks[p.underlyingId];
    p.lastFetched = now;
  }
  data.lastFetched = now;
  await persist();
}

async function switchAccount(name) {
  state.current = name;
  await loadAccounts();
  await refreshMarks();
}

async function closePosition(pos) {
  if (isExpired(pos)) throw new Error("This option has expired. It settles automatically at the stock's closing price on the expiry date.");
  const [quote, stocks] = await Promise.all([quoteFills(pos.symbolId, accountSlippage(state.data)), market.stockPrices([pos.underlyingId])]);
  const fill = pos.qty > 0 ? quote.sell : quote.buy;
  const price = fill.price;
  const closeUnderlying = stocks[pos.underlyingId] ?? null;
  const profit = pnl(pos, price);
  const cost = Math.abs(pos.openPrice * pos.qty * MULT);
  const returnPct = cost ? (profit / cost) * 100 : null;
  const ok = await dialog({
    title: "Close position",
    message: h(
      "div",
      {},
      h(
        "div",
        { class: "text-center p-3 mb-3 rounded bg-body-tertiary border" },
        h("div", { class: "stat-label" }, "Net profit / loss"),
        h("div", { class: `fs-2 fw-semibold ${pnlClass(profit)}` }, signedUsd(profit)),
        returnPct == null
          ? null
          : h("div", { class: "small text-body-secondary" }, `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}% on ${usd(cost)} ${pos.qty > 0 ? "paid" : "received"}`)
      ),
      summaryList([
        ["Contract", pos.label],
        ["Quantity", `${pos.qty > 0 ? "Long" : "Short"} ${Math.abs(pos.qty)}`],
        ["Bid / ask", `${px(quote.bid)} / ${px(quote.ask)}`],
        ["Opened at", `${px(pos.openPrice)}${pos.openSlippage ? ` (mid ${px(pos.openMid)}, ${pos.openSlippage}% slippage)` : " (mid)"}`],
        ["Closing at", `${px(price)} (${describeFill(fill)})`],
        [`${pos.underlying} at open`, px(pos.openUnderlying)],
        [`${pos.underlying} now`, px(closeUnderlying)],
      ])
    ),
    confirmText: fill.pct ? "Close" : "Close at mid",
  });
  if (!ok) return;
  state.data.positions = state.data.positions.filter((p) => p.id !== pos.id);
  state.data.closed.unshift({ ...pos, closePrice: price, closeMid: fill.mid, closeSlippage: fill.pct, closeUnderlying, closeTime: Date.now(), pnl: profit });
  if (typeof state.data.cash === "number") state.data.cash += pos.qty * price * MULT;
  await persist();
  await record({ type: "close", label: pos.label, symbolId: pos.symbolId, qty: pos.qty, openPrice: pos.openPrice, price, mid: fill.mid, slippage: fill.pct, pnl: profit, cash: state.data.cash ?? null });
  toast(`Closed ${pos.label} for ${signedUsd(profit)}`, profit >= 0 ? "success" : "secondary");
}

const midNote = (mid, pct) => (pct ? h("div", { class: "small text-body-secondary" }, `mid ${px(mid)} · ${pct}% slip`) : null);

const typeBadge = (type) =>
  h("span", { class: `badge ms-1 ${type === "C" ? "bg-success-subtle text-success-emphasis" : "bg-danger-subtle text-danger-emphasis"}` }, type === "C" ? "CALL" : "PUT");

const qtyCell = (qty) =>
  h("td", { class: "num" }, Math.abs(qty), qty < 0 ? h("span", { class: "badge rounded-pill bg-warning-subtle text-warning-emphasis ms-2" }, "Short") : null);

const changeLine = (from, to) =>
  from == null || to == null || !from ? null : h("div", { class: "small text-body-secondary" }, `${to >= from ? "+" : ""}${(((to - from) / from) * 100).toFixed(1)}%`);

const fmtDateTime = (t) => {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString() : d.toLocaleString();
};

function contractCell(p) {
  const dte = Math.ceil((new Date(`${p.expiry}T16:00:00`) - Date.now()) / 86400000);
  return h(
    "td",
    {},
    h(
      "div",
      { class: "fw-semibold" },
      h("a", { href: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(p.underlying)}&interval=30`, target: "_blank", rel: "noopener noreferrer", title: `Open the ${p.underlying} chart on TradingView`, class: "link-body-emphasis text-decoration-none" }, p.underlying),
      ` ${p.strike}`,
      typeBadge(p.type)
    ),
    h("div", { class: "small text-body-secondary" }, p.expiry, dte >= 0 ? ` · ${dte} DTE` : " · expired")
  );
}

function statusBadge(data) {
  if (data.status !== "closed") return h("span", { class: "badge bg-primary-subtle text-primary-emphasis" }, icon("circle-fill", "me-1 small"), "Active");
  return data.outcome === "success"
    ? h("span", { class: "badge bg-success-subtle text-success-emphasis" }, icon("check-circle", "me-1"), "Successful")
    : h("span", { class: "badge bg-danger-subtle text-danger-emphasis" }, icon("x-circle", "me-1"), "Failed");
}

function renderToolbar() {
  const data = state.data;
  const select = h(
    "select",
    { class: "form-select", id: "account-select", onchange: (e) => run(() => switchAccount(e.target.value)) },
    state.accounts.map((a) => {
      const d = state.all[a];
      const mark = d && d.status === "closed" ? (d.outcome === "success" ? "  ✓" : "  ✗") : "";
      return h("option", { value: a, selected: a === state.current }, a + mark);
    })
  );
  return h(
    "div",
    { class: "d-flex flex-wrap align-items-center gap-2 mb-4" },
    h("label", { class: "form-label mb-0 text-body-secondary small", htmlFor: "account-select" }, "Account"),
    h("div", { style: "min-width:220px" }, select),
    statusBadge(data),
    h(
      "div",
      { class: "ms-auto" },
      h("a", { class: "btn btn-outline-secondary", href: "accounts.html" }, icon("wallet2", "me-1"), "Manage accounts")
    )
  );
}

function renderStats() {
  const data = state.data;
  const closed = data.status === "closed";
  const positions = data.positions;
  const marksKnown = positions.every((p) => markOf(p) != null);
  const openPnl = marksKnown ? positions.reduce((sum, p) => sum + pnl(p, markOf(p)), 0) : null;
  const realized = data.closed.reduce((sum, c) => sum + c.pnl, 0);
  const equity = closed
    ? data.finalFunds
    : fundsSet(data) && marksKnown
      ? data.cash + positions.reduce((sum, p) => sum + markOf(p) * p.qty * MULT, 0)
      : null;
  const totalReturn = equity != null && typeof data.startingFunds === "number" && data.startingFunds > 0 ? (equity - data.startingFunds) / data.startingFunds : null;
  const unset = typeof data.startingFunds !== "number";
  return h(
    "div",
    { class: "row row-cols-2 row-cols-md-3 row-cols-xl-5 g-3 mb-4" },
    statCard("Starting funds", unset ? h("span", { class: "text-warning" }, "Not set") : usd(data.startingFunds), {
      sub: closed ? `Closed ${fmtDate(data.closedAt)}` : `Set ${fmtDate(data.created)}`,
    }),
    statCard(closed ? "Final funds" : "Cash", usd(closed ? data.finalFunds : data.cash)),
    statCard("Equity", usd(equity), {
      valueClass: equity != null && !unset ? pnlClass(equity - data.startingFunds) : "",
      sub: totalReturn == null ? (positions.length && !marksKnown ? "Refresh prices to calculate" : null) : `${totalReturn >= 0 ? "+" : ""}${(totalReturn * 100).toFixed(2)}% total return`,
    }),
    statCard("Open P&L", signedUsd(positions.length ? openPnl : 0), { valueClass: pnlClass(openPnl), sub: `${positions.length} open position${positions.length === 1 ? "" : "s"}` }),
    statCard("Realized P&L", signedUsd(realized), { valueClass: pnlClass(realized), sub: `${data.closed.length} closed trade${data.closed.length === 1 ? "" : "s"}` })
  );
}

function renderPositions() {
  const positions = state.data.positions;
  const header = h(
    "div",
    { class: "card-header d-flex align-items-center gap-2" },
    h("span", { class: "fw-semibold" }, "Open positions"),
    h("span", { class: "badge text-bg-secondary rounded-pill" }, positions.length),
    h("span", { class: "ms-auto small text-body-secondary" }, icon("clock", "me-1"), state.data.lastFetched ? `Last fetched ${fmtDateTime(state.data.lastFetched)}` : "Prices never fetched"),
    h(
      "button",
      { class: "btn btn-sm btn-primary", disabled: state.busy || !positions.length, onclick: () => run(refreshMarks) },
      state.busy ? h("span", { class: "spinner-border spinner-border-sm me-1" }) : icon("arrow-clockwise", "me-1"),
      "Refresh prices"
    )
  );
  if (!positions.length) {
    return h("div", { class: "card mb-4" }, header, emptyState("inbox", "No open positions", "Use the \"Open call (Paper)\" and \"Open put (Paper)\" buttons in TradingView's options chain."));
  }
  const rows = positions.map((p) => {
    const mark = markOf(p);
    const value = pnl(p, mark);
    return h(
      "tr",
      {},
      contractCell(p),
      qtyCell(p.qty),
      h("td", { class: "num" }, px(p.openPrice), h("div", { class: "fw-semibold" }, usd(p.openPrice * Math.abs(p.qty) * MULT)), midNote(p.openMid, p.openSlippage), h("div", { class: "small text-body-secondary" }, fmtDate(p.openTime))),
      h("td", { class: "num" }, px(mark), mark == null ? null : h("div", { class: "fw-semibold" }, usd(mark * Math.abs(p.qty) * MULT)), midNote(p.lastMid, p.lastSlippage), changeLine(p.openPrice, mark)),
      h("td", { class: "num" }, px(p.openUnderlying)),
      h("td", { class: "num" }, px(p.lastUnderlying), changeLine(p.openUnderlying, p.lastUnderlying)),
      h("td", { class: `num fw-semibold ${pnlClass(value)}` }, signedUsd(value)),
      h(
        "td",
        { class: "text-end" },
        isExpired(p)
          ? h("span", { class: "badge bg-warning-subtle text-warning-emphasis", title: "Settles automatically once the expiry-day closing price is available" }, "Awaiting settlement")
          : h("button", { class: "btn btn-sm btn-outline-secondary", disabled: state.busy, onclick: () => run(() => closePosition(p)) }, "Close")
      )
    );
  });
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
        h("thead", {}, h("tr", {}, h("th", {}, "Contract"), h("th", { class: "num" }, "Qty"), h("th", { class: "num" }, "Option open ($ value)"), h("th", { class: "num" }, "Option now ($ value)"), h("th", { class: "num" }, "Stock at open"), h("th", { class: "num" }, "Stock now"), h("th", { class: "num" }, "P&L"), h("th", {}))),
        h("tbody", {}, rows)
      )
    )
  );
}

function renderClosed() {
  const closed = state.data.closed;
  const header = h("div", { class: "card-header d-flex align-items-center gap-2" }, h("span", { class: "fw-semibold" }, "Closed trades"), h("span", { class: "badge text-bg-secondary rounded-pill" }, closed.length));
  if (!closed.length) return h("div", { class: "card" }, header, emptyState("journal", "No closed trades yet", null));
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
        h("thead", {}, h("tr", {}, h("th", {}, "Contract"), h("th", { class: "num" }, "Qty"), h("th", { class: "num" }, "Option open"), h("th", { class: "num" }, "Option close"), h("th", { class: "num" }, "Stock at open"), h("th", { class: "num" }, "Stock at close"), h("th", { class: "num" }, "P&L"), h("th", { class: "num" }, "Closed"))),
        h(
          "tbody",
          {},
          closed.map((c) =>
            h(
              "tr",
              {},
              contractCell(c),
              qtyCell(c.qty),
              h("td", { class: "num" }, px(c.openPrice), midNote(c.openMid, c.openSlippage)),
              h("td", { class: "num" }, px(c.closePrice), midNote(c.closeMid, c.closeSlippage), changeLine(c.openPrice, c.closePrice)),
              h("td", { class: "num" }, px(c.openUnderlying)),
              h("td", { class: "num" }, px(c.closeUnderlying), changeLine(c.openUnderlying, c.closeUnderlying)),
              h("td", { class: `num fw-semibold ${pnlClass(c.pnl)}` }, signedUsd(c.pnl)),
              h(
                "td",
                { class: "num text-body-secondary" },
                new Date(c.closeTime).toLocaleString(),
                c.settlement ? h("div", {}, h("span", { class: "badge bg-secondary-subtle text-secondary-emphasis" }, SETTLEMENT_LABELS[c.settlement])) : null
              )
            )
          )
        )
      )
    )
  );
}

function renderClosedBanner() {
  const data = state.data;
  const ok = data.outcome === "success";
  const profit = data.finalFunds - data.startingFunds;
  return h(
    "div",
    { class: `alert ${ok ? "alert-success" : "alert-danger"} d-flex align-items-center gap-3 mb-4` },
    icon(ok ? "trophy" : "x-octagon", "fs-4"),
    h(
      "div",
      {},
      h("div", { class: "fw-semibold" }, `Closed out as ${ok ? "successful" : "failed"} (${signedUsd(profit)})`),
      h("div", { class: "small" }, "This account is read-only. ", h("a", { href: "accounts.html", class: "alert-link" }, "Create a new account"), " to keep trading.")
    )
  );
}

function renderPortfolio() {
  if (!state.dir || state.needsReconnect) return renderGate();
  if (!state.data) {
    return h(
      "div",
      { class: "card gate" },
      h(
        "div",
        { class: "card-body text-center p-5" },
        icon("wallet2", "fs-1 text-primary"),
        h("h5", { class: "mt-3" }, "No accounts yet"),
        h("p", { class: "text-body-secondary" }, "Create a paper account, then open positions from TradingView's options chain."),
        h("a", { class: "btn btn-primary", href: "accounts.html" }, icon("plus-lg", "me-1"), "Create an account")
      )
    );
  }
  const closed = state.data.status === "closed";
  return h("div", {}, renderToolbar(), closed ? renderClosedBanner() : null, renderStats(), closed ? null : renderPositions(), renderClosed());
}

function settingsCard(iconName, title, ...body) {
  return h(
    "div",
    { class: "card mb-4" },
    h("div", { class: "card-header fw-semibold d-flex align-items-center gap-2" }, icon(iconName, "text-primary"), title),
    h("div", { class: "card-body" }, ...body)
  );
}

function renderSettings() {
  return h(
    "div",
    { class: "row justify-content-center" },
    h(
      "div",
      { class: "col-lg-8" },
      settingsCard(
        "hdd",
        "Your data",
        h("div", { class: "mb-3" }, state.config ? "Saved on this device and synced to the online store." : "Saved on this device only."),
        h(
          "div",
          { class: "d-flex flex-wrap gap-2" },
          h("button", { class: "btn btn-outline-secondary", disabled: state.busy, onclick: () => run(downloadBackup) }, icon("download", "me-1"), "Download backup"),
          h("button", { class: "btn btn-outline-secondary", disabled: state.busy, onclick: restoreBackup }, icon("upload", "me-1"), "Restore backup"),
          h("button", { class: "btn btn-outline-secondary", disabled: state.busy, onclick: importFromFolder }, icon("folder", "me-1"), "Import from folder")
        ),
        h("div", { class: "form-text mt-3" }, "Removing the extension or clearing its data deletes the accounts saved on this device. Download a backup now and then. Import from folder copies the .json and .jsonl files of an old data folder.")
      ),
      settingsCard(
        "cloud",
        "Online sync (optional)",
        state.config
          ? h(
              "div",
              {},
              summaryList([["Sync code", state.showKey ? makeSyncCode(state.config.namespace, state.config.key) : "\u2022".repeat(16)]]),
              h(
                "div",
                { class: "d-flex flex-wrap gap-2 mt-3" },
                h("button", { class: "btn btn-outline-secondary", onclick: () => { state.showKey = !state.showKey; render(); } }, icon(state.showKey ? "eye-slash" : "eye", "me-1"), state.showKey ? "Hide code" : "Show code"),
                h("button", { class: "btn btn-outline-secondary", onclick: () => run(copySyncCode) }, icon("clipboard", "me-1"), "Copy code"),
                h("button", { class: "btn btn-outline-secondary", disabled: state.busy, onclick: () => run(chooseStore) }, "Change store"),
                h("button", { class: "btn btn-outline-danger ms-auto", disabled: state.busy, onclick: () => run(disconnectStore) }, "Turn off sync")
              )
            )
          : h(
              "div",
              { class: "d-flex align-items-center gap-3" },
              h("div", { class: "text-body-secondary" }, "Off"),
              h("button", { class: "btn btn-primary ms-auto", onclick: () => run(chooseStore) }, "Turn on sync")
            ),
        h("div", { class: "form-text mt-3" }, "Sync keeps a copy in a free online store (MantleDB, beta) so you can use the same accounts on another browser. Anyone with the sync code can read and change the data, so keep it private. The store may be limited or cleared by its operator, so keep backups.")
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
      h("p", { class: "text-body-secondary" }, first ? "Your accounts and history are saved in a free online store. Create a new one or connect to one you already have." : `Could not reach "${state.dir.name}".`),
      h(
        "div",
        { class: "d-flex justify-content-center gap-2" },
        first
          ? h("button", { class: "btn btn-primary", onclick: () => run(chooseStore) }, "Connect")
          : h("button", { class: "btn btn-primary", onclick: () => run(() => connect(true)) }, "Retry"),
        first ? null : h("button", { class: "btn btn-outline-secondary", onclick: () => run(chooseStore) }, "Change store")
      )
    )
  );
}

function render() {
  const ready = state.dir && !state.needsReconnect;
  app.replaceChildren(
    navbar(state.view, ready ? computeTally(Object.values(state.all)) : null),
    h("main", { class: "container-xl pb-5" }, state.view === "settings" ? renderSettings() : renderPortfolio())
  );
}

window.addEventListener("hashchange", () => {
  state.view = viewFromHash();
  render();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || state.busy || !state.dir || state.needsReconnect) return;
  run(async () => {
    await loadAccounts();
    await refreshMarks();
  });
});

async function init() {
  render();
  try {
    await connect(false);
    if (state.data) await refreshMarks();
  } catch (err) {
    toast(err.message, "danger");
  }
  render();
}

init();
