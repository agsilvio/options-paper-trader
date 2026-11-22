#!/usr/bin/env python3
import json
import re
import sys
import urllib.error
import urllib.request

TICKER = sys.argv[1] if len(sys.argv) > 1 else "AAPL"

SOURCES = {
    "cboe chain": f"https://cdn.cboe.com/api/global/delayed_quotes/options/{TICKER}.json",
    "cboe history": f"https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/{TICKER}.json",
    "yahoo chart": f"https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?range=5d&interval=1d",
}

OCC = re.compile(r"^([A-Z0-9.]+?)(\d{6})([CP])(\d{8})$")
failures = 0


def report(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}".rstrip())


def get(name, url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=30) as res:
            body = res.read().decode("utf-8", "replace")
            report(f"{name} http", True, f"status {res.status}, {len(body)} bytes, final url {res.geturl()}")
    except urllib.error.HTTPError as err:
        report(f"{name} http", False, f"status {err.code}")
        return None
    except Exception as err:
        report(f"{name} http", False, str(err))
        return None
    try:
        return json.loads(body)
    except ValueError:
        report(f"{name} json", False, "not JSON: " + re.sub(r"\s+", " ", body[:80]))
        return None


chain = get("cboe chain", SOURCES["cboe chain"])
if chain:
    data = chain.get("data") or {}
    options = data.get("options") or []
    report("cboe chain has options", len(options) > 0, f"{len(options)} contracts")
    price = data.get("current_price")
    report("cboe chain has underlying price", isinstance(price, (int, float)), f"price {price}")
    parsed = [o for o in options if OCC.match(o.get("option", ""))]
    report("cboe option ids parse as OCC", bool(options) and len(parsed) == len(options), f"{len(parsed)}/{len(options)}")
    quoted = [o for o in options if (o.get("bid") or 0) > 0 and (o.get("ask") or 0) > 0]
    report("cboe quotes have bid/ask", len(quoted) > 0, f"{len(quoted)} with both")
    if quoted:
        sample = quoted[len(quoted) // 2]
        missing = [f for f in ("bid", "ask", "iv", "delta", "theta", "volume", "open_interest") if f not in sample]
        report("cboe quote fields", not missing, ("missing " + ", ".join(missing)) if missing else json.dumps(sample))
    expiries = {OCC.match(o["option"]).group(2) for o in parsed}
    report("cboe multiple expiries", len(expiries) > 1, f"{len(expiries)} expiries")

history = get("cboe history", SOURCES["cboe history"])
if history:
    rows = history.get("data") or []
    last = rows[-1] if rows else None
    report("cboe history has daily closes", bool(last) and "close" in last, json.dumps(last) if last else "empty")

yahoo = get("yahoo chart", SOURCES["yahoo chart"])
if yahoo:
    try:
        closes = yahoo["chart"]["result"][0]["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError):
        closes = []
    report("yahoo chart has daily closes", len(closes) > 0, f"{len(closes)} closes, last {closes[-1] if closes else None}")

print(f"\n{failures} check(s) failed" if failures else "\nall checks passed")
sys.exit(1 if failures else 0)
