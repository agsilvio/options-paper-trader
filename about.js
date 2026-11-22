import { activeProvider } from "./providers.js";
import { STORE_INFO, LOCAL_INFO, getConfig } from "./mantle.js";
import { h, icon, navbar, summaryList } from "./ui.js";

const app = document.getElementById("app");

const list = (items) => h("ul", { class: "mb-0 ps-3" }, items.map((item) => h("li", {}, item)));

const link = (url) => h("a", { href: url, target: "_blank", rel: "noopener" }, url);

function section(iconName, title, ...body) {
  return h(
    "div",
    { class: "card mb-4" },
    h("div", { class: "card-header fw-semibold d-flex align-items-center gap-2" }, icon(iconName, "text-primary"), title),
    h("div", { class: "card-body" }, ...body)
  );
}

function subheading(text) {
  return h("div", { class: "stat-label mt-3 mb-1" }, text);
}

function renderMarketData() {
  const info = activeProvider().describe();
  return section(
    "graph-up",
    "Market data source",
    summaryList([
      ["Provider", info.name],
      ["Website", link(info.website)],
    ]),
    subheading("Provides"),
    list(info.provides),
    subheading("Endpoints"),
    h("ul", { class: "mb-0 ps-3 font-monospace small" }, info.endpoints.map((e) => h("li", {}, e))),
    subheading("Notes"),
    list(info.notes)
  );
}

function renderUserData(config, localKeys) {
  return section(
    "hdd",
    "User data source",
    summaryList([
      ["Stored in", config ? "This browser, synced to an online store" : LOCAL_INFO.name],
      ["Online sync", config ? "On" : "Off (optional, see Settings)"],
    ]),
    subheading("Holds"),
    list(LOCAL_INFO.holds),
    subheading("On this device"),
    list(LOCAL_INFO.notes),
    subheading("Optional online sync"),
    summaryList([
      ["Service", STORE_INFO.name],
      ["Website", link(STORE_INFO.website)],
      ["API", STORE_INFO.endpoint],
    ]),
    list(STORE_INFO.notes),
    subheading("Kept only in this browser"),
    list(localKeys)
  );
}

function renderDisclaimer() {
  return section(
    "info-circle",
    "Disclaimer",
    list([
      "Paper trading only. No real orders are placed and no real money is involved.",
      "Prices are delayed about 15 minutes and fills are simulated, so results do not predict real trading results.",
      "Nothing here is financial advice.",
      "Not affiliated with, endorsed by, or sponsored by TradingView or Cboe. Those names belong to their owners.",
    ])
  );
}

async function render() {
  const config = await getConfig();
  const localKeys = [
    "Your sync code, if you turned on online sync (extension storage, not encrypted)",
    "Which account you last selected",
  ];
  app.replaceChildren(
    navbar("about", null),
    h("main", { class: "container-xl pb-5" }, h("div", { class: "row justify-content-center" }, h("div", { class: "col-lg-8" }, renderMarketData(), renderUserData(config, localKeys), renderDisclaimer())))
  );
}

render();
