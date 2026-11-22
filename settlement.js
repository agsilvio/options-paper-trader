import * as market from "./marketdata.js";

const MULT = 100;
const MIN_ITM = 0.01;

export const isExpired = (p, now = Date.now()) => now >= Date.parse(`${p.expiry}T16:30:00-05:00`);

export const SETTLEMENT_LABELS = {
  expired: "Expired worthless",
  exercised: "Exercised",
  assigned: "Assigned",
};

export async function settleExpired(data) {
  if (data.status === "closed") return [];
  const expired = data.positions.filter((p) => isExpired(p));
  const events = [];
  const closes = {};
  for (const p of expired) {
    if (!p.underlyingId) {
      try {
        p.underlyingId = (await market.resolveSymbol(p.underlying)).symbolId;
      } catch {
        continue;
      }
    }
    const key = `${p.underlyingId}:${p.expiry}`;
    if (!(key in closes)) closes[key] = await market.dailyClose(p.underlyingId, p.expiry);
    const stockClose = closes[key];
    if (stockClose == null) continue;
    const raw = p.type === "C" ? stockClose - p.strike : p.strike - stockClose;
    const intrinsic = raw >= MIN_ITM ? Math.round(raw * 100) / 100 : 0;
    const settlement = intrinsic === 0 ? "expired" : p.qty > 0 ? "exercised" : "assigned";
    const pnl = (intrinsic - p.openPrice) * p.qty * MULT;
    data.positions = data.positions.filter((x) => x.id !== p.id);
    data.closed.unshift({
      ...p,
      closePrice: intrinsic,
      closeUnderlying: stockClose,
      closeTime: Date.parse(`${p.expiry}T16:00:00-05:00`),
      pnl,
      settlement,
    });
    if (typeof data.cash === "number") data.cash += p.qty * intrinsic * MULT;
    events.push({
      time: Date.now(),
      type: "expire",
      settlement,
      label: p.label,
      symbolId: p.symbolId,
      qty: p.qty,
      openPrice: p.openPrice,
      underlyingClose: stockClose,
      price: intrinsic,
      pnl,
      cash: data.cash ?? null,
    });
  }
  return events;
}
