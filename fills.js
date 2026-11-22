import * as market from "./marketdata.js";
import * as store from "./portfolio.js";

export const SLIPPAGE_OPTIONS = [
  [0, "Mid (no slippage)"],
  [10, "Mid + 10% of the half-spread"],
  [25, "Mid + 25% of the half-spread (default)"],
  [50, "Mid + 50% of the half-spread"],
  [100, "Natural: buy at the ask, sell at the bid"],
];

export const DEFAULT_SLIPPAGE = store.ACCOUNT_DEFAULTS.slippage;

export const accountSlippage = (account) => (typeof account.slippage === "number" ? account.slippage : DEFAULT_SLIPPAGE);

export function fillPrice(quote, action, pct) {
  if (!quote || !(quote.bid > 0) || !(quote.ask > 0)) return null;
  const mid = (quote.bid + quote.ask) / 2;
  if (!pct) return { mid, price: mid, pct: 0 };
  const half = (quote.ask - quote.bid) / 2;
  const raw = action === "buy" ? mid + (half * pct) / 100 : mid - (half * pct) / 100;
  return { mid, price: Math.round(raw * 100) / 100, pct };
}

export async function fetchQuote(symbolId) {
  return (await market.optionQuotes([symbolId]))[symbolId];
}

export function buildFills(quote, pct) {
  const buy = fillPrice(quote, "buy", pct);
  const sell = fillPrice(quote, "sell", pct);
  if (!buy || !sell) throw new Error("No valid bid/ask for this contract right now");
  return { bid: quote.bid, ask: quote.ask, buy, sell, pct };
}

export async function quoteFills(symbolId, pct) {
  return buildFills(await fetchQuote(symbolId), pct);
}

export function describeFill(fill) {
  return fill.pct ? `mid ${fill.mid.toFixed(2)} with ${fill.pct}% slippage` : "mid";
}
