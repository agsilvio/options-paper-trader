import { activeProvider } from "./providers.js";
import { MARKET_FUNCTIONS } from "./marketdata.js";
import * as store from "./portfolio.js";
import { fetchQuote, buildFills, quoteFills, accountSlippage } from "./fills.js";

const market = activeProvider();
async function openApp() {
  await chrome.runtime.openOptionsPage();
}

async function storeDir() {
  const dir = await store.getDir();
  if ((await store.permission(dir, false)) !== "granted") {
    throw new Error("The online store is not reachable.");
  }
  return dir;
}

const handlers = {
  async market({ fn, args }) {
    if (!MARKET_FUNCTIONS.includes(fn)) throw new Error(`Unknown market data call: ${fn}`);
    return market[fn](...args);
  },
  async prepareOrder({ option }) {
    const dir = await storeDir();
    const accounts = await store.listOpenAccounts(dir);
    if (!accounts.length) throw new Error("No open account. Create one on the plugin's Accounts page.");
    const contract = await market.findContract(option.ticker, option.expiry, option.strike, option.type);
    const quote = await fetchQuote(contract.symbolId);
    const quotes = {};
    const cash = {};
    for (const name of accounts) {
      const data = await store.loadAccount(dir, name);
      quotes[name] = buildFills(quote, accountSlippage(data));
      cash[name] = typeof data.cash === "number" ? data.cash : null;
    }
    const { currentAccount } = await chrome.storage.local.get("currentAccount");
    return { contract, quotes, cash, accounts, account: accounts.includes(currentAccount) ? currentAccount : accounts[0] };
  },
  async placeOrder({ account, contract, side, qty }) {
    if (!Number.isInteger(qty) || qty <= 0) throw new Error("Contracts must be a positive whole number");
    const dir = await storeDir();
    if (!account) throw new Error("No account selected");
    if (!(await store.listOpenAccounts(dir)).includes(account)) {
      throw new Error(`Account "${account}" does not exist or is closed out`);
    }
    const quote = await quoteFills(contract.symbolId, accountSlippage(await store.loadAccount(dir, account)));
    const fill = side === "long" ? quote.buy : quote.sell;
    const underlyingPrice = (await market.stockPrices([contract.underlyingId]))[contract.underlyingId] ?? null;
    await store.openPosition(dir, account, contract, side, qty, fill, underlyingPrice);
    return { account, label: contract.label, fill, side, qty };
  },
};

chrome.action.onClicked.addListener(openApp);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg.type];
  if (!handler) return false;
  handler(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
