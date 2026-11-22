import { parseOcc } from "./occ.js";
import { MarketDataProvider } from "./provider.js";

const BASES = ["https://cdn.cboe.com/api/global/delayed_quotes", "https://cdn-api.cboe.com/api/global/delayed_quotes"];
const CHAIN_TTL = 20 * 1000;
const HISTORY_TTL = 10 * 60 * 1000;
const MAX_CACHE = 12;

const cache = new Map();

function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = load();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return promise;
}

async function getJson(path) {
  let lastStatus = 0;
  for (const base of BASES) {
    try {
      const res = await fetch(`${base}/${path}`);
      if (res.ok) return await res.json();
      lastStatus = res.status;
      if (res.status !== 403 && res.status !== 404) break;
    } catch (err) {
      lastStatus = err.message;
    }
  }
  throw new Error(`Market data request failed (${lastStatus}) for ${path}`);
}

function loadChain(ticker) {
  return cached(`chain:${ticker}`, CHAIN_TTL, async () => {
    let data = null;
    for (const name of [ticker, `_${ticker}`]) {
      try {
        const body = await getJson(`options/${name}.json`);
        if (body.data && body.data.options && body.data.options.length) {
          data = body.data;
          break;
        }
      } catch {
        continue;
      }
    }
    if (!data) throw new Error(`No option data found for ${ticker}. Only US-listed options are supported.`);
    const quotes = new Map();
    const expiries = new Map();
    for (const o of data.options) {
      const parsed = parseOcc(o.option);
      if (!parsed) continue;
      quotes.set(o.option, {
        bid: o.bid,
        ask: o.ask,
        last: o.last_trade_price,
        volume: o.volume,
        openInterest: o.open_interest,
        iv: o.iv,
        delta: o.delta,
        theta: o.theta,
      });
      if (!expiries.has(parsed.expiry)) expiries.set(parsed.expiry, new Map());
      const strikes = expiries.get(parsed.expiry);
      if (!strikes.has(parsed.strike)) strikes.set(parsed.strike, {});
      strikes.get(parsed.strike)[parsed.type === "C" ? "callId" : "putId"] = o.option;
    }
    return { price: typeof data.current_price === "number" ? data.current_price : null, quotes, expiries };
  });
}

function loadHistory(ticker) {
  return cached(`history:${ticker}`, HISTORY_TTL, async () => {
    let lastError = null;
    for (const name of [ticker, `_${ticker}`]) {
      try {
        const body = await getJson(`charts/historical/${name}.json`);
        if (Array.isArray(body.data) && body.data.length) return body.data;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error(`No price history found for ${ticker}`);
  });
}

export class CboeProvider extends MarketDataProvider {
  get name() {
    return "cboe";
  }

  describe() {
    return {
      name: "CBOE delayed quotes",
      website: "https://www.cboe.com/delayed_quotes/",
      endpoints: BASES.map((base) => `${base}/options/<TICKER>.json`).concat(BASES.map((base) => `${base}/charts/historical/<TICKER>.json`)),
      provides: [
        "Option chains with bid, ask, last, volume, open interest, IV, delta and theta",
        "Underlying stock price (from the same chain)",
        "Daily closing prices, used to settle expired options",
      ],
      notes: [
        "Free, no account or API key",
        "Quotes are delayed about 15 minutes",
        "US-listed options and stocks only",
        `Chains are cached for ${CHAIN_TTL / 1000} seconds and daily history for ${HISTORY_TTL / 60000} minutes`,
      ],
    };
  }

  async resolveSymbol(ticker) {
    const symbol = ticker.trim().toUpperCase();
    await loadChain(symbol);
    return { symbolId: symbol, symbol, description: "" };
  }

  async optionChain(symbolId) {
    const chain = await loadChain(symbolId);
    return [...chain.expiries.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([expiry, strikes]) => ({
        expiry,
        strikes: [...strikes.entries()]
          .map(([strike, ids]) => ({ strike, callId: ids.callId ?? null, putId: ids.putId ?? null }))
          .sort((a, b) => a.strike - b.strike),
      }));
  }

  async dailyClose(symbolId, date) {
    const rows = await loadHistory(symbolId);
    const row = rows.find((r) => r.date === date);
    return row && typeof row.close === "number" ? row.close : null;
  }

  async stockPrices(symbolIds) {
    const out = {};
    for (const id of new Set(symbolIds.filter(Boolean))) {
      try {
        out[id] = (await loadChain(id)).price;
      } catch {
        out[id] = null;
      }
    }
    return out;
  }

  async optionQuotes(optionIds) {
    const out = {};
    const byRoot = new Map();
    for (const id of new Set(optionIds)) {
      const parsed = parseOcc(id);
      if (!parsed) continue;
      if (!byRoot.has(parsed.root)) byRoot.set(parsed.root, []);
      byRoot.get(parsed.root).push(id);
    }
    for (const [root, ids] of byRoot) {
      const chain = await loadChain(root);
      for (const id of ids) {
        const q = chain.quotes.get(id);
        if (q) out[id] = { ...q, underlyingPrice: chain.price };
      }
    }
    return out;
  }
}
