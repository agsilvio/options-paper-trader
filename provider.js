const notImplemented = (provider, method) => {
  throw new Error(`${provider.constructor.name} does not implement ${method}`);
};

export class MarketDataProvider {
  get name() {
    return notImplemented(this, "name");
  }

  describe() {
    return notImplemented(this, "describe");
  }

  async resolveSymbol(ticker) {
    return notImplemented(this, "resolveSymbol");
  }

  async optionChain(symbolId) {
    return notImplemented(this, "optionChain");
  }

  async optionQuotes(optionIds) {
    return notImplemented(this, "optionQuotes");
  }

  async stockPrices(symbolIds) {
    return notImplemented(this, "stockPrices");
  }

  async dailyClose(symbolId, date) {
    return notImplemented(this, "dailyClose");
  }

  async findContract(ticker, expiry, strike, type) {
    const sym = await this.resolveSymbol(ticker);
    const chain = await this.optionChain(sym.symbolId);
    const entry = chain.find((e) => e.expiry === expiry);
    if (!entry) {
      throw new Error(`No ${sym.symbol} expiry ${expiry}. Available: ${chain.slice(0, 8).map((e) => e.expiry).join(", ")}`);
    }
    const row = entry.strikes.find((s) => Math.abs(s.strike - strike) < 1e-6);
    if (!row) throw new Error(`No strike ${strike} for ${sym.symbol} ${expiry}`);
    const symbolId = type === "C" ? row.callId : row.putId;
    if (!symbolId) throw new Error(`No ${type === "C" ? "call" : "put"} at strike ${strike} for ${sym.symbol} ${expiry}`);
    return {
      symbolId,
      underlyingId: sym.symbolId,
      underlying: sym.symbol,
      expiry,
      strike,
      type,
      label: `${sym.symbol} ${expiry} ${strike} ${type}`,
    };
  }

  async midPrices(optionIds) {
    const quotes = await this.optionQuotes(optionIds);
    const out = {};
    for (const [id, q] of Object.entries(quotes)) {
      out[id] = q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : null;
    }
    return out;
  }
}

export const PROVIDER_METHODS = [
  "resolveSymbol",
  "findContract",
  "dailyClose",
  "stockPrices",
  "midPrices",
  "optionChain",
  "optionQuotes",
];
