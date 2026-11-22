const OCC = /^([A-Z0-9.]+?)(\d{6})([CP])(\d{8})$/;

export function occSymbol(underlying, expiry, strike, type) {
  const ymd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  return `${underlying.toUpperCase()}${ymd}${type}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

export function parseOcc(symbol) {
  const m = OCC.exec(symbol);
  if (!m) return null;
  const [, root, ymd, type, raw] = m;
  return {
    root,
    expiry: `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`,
    type,
    strike: parseInt(raw, 10) / 1000,
  };
}

export function migratePosition(p) {
  if (typeof p.symbolId === "number" && p.underlying && p.expiry && typeof p.strike === "number" && p.type) {
    p.symbolId = occSymbol(p.underlying, p.expiry, p.strike, p.type);
  }
  if (typeof p.underlyingId === "number" && p.underlying) p.underlyingId = p.underlying;
  return p;
}
