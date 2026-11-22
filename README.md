# Options Paper Trader for TradingView

A Chrome/Brave extension for paper-trading options from TradingView's options chain. No real money, no broker account, no API key.

- Adds a **Paper trade** button to TradingView's option panel (green for calls, red for puts)
- Multiple accounts, each with its own starting funds and slippage
- Fills at mid price plus a configurable share of the half-spread
- Portfolio with original and current dollar value and P&L per position; expired options settle automatically
- Free delayed (about 15 minutes) quotes from Cboe; US-listed options only
- Data is saved in the browser; optional online sync through [MantleDB](https://mantledb.sh/) with a sync code
- Backup download and restore

> Paper trading only. Not financial advice. Not affiliated with, endorsed by, or sponsored by TradingView or Cboe.

## Install (unpacked)
1. Clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the repository folder.
3. Open an options chain on TradingView and use the **Paper trade** button, or click the extension icon for the portfolio.

`./build.sh` makes `optpaper.zip` containing only the files the extension needs.

## How it is organised
| File | Role |
| --- | --- |
| `content.js` | TradingView page: finds the selected contract, order popup |
| `background.js` | Service worker: prices orders, places them |
| `provider.js`, `cboe.js`, `providers.js` | Market-data interface and the Cboe implementation; swap `ACTIVE` in `providers.js` to change provider |
| `fills.js`, `settlement.js`, `occ.js` | Slippage fills, expiry settlement, OCC option symbols |
| `portfolio.js`, `mantle.js` | Account logic; storage (local by default, MantleDB optional) |
| `options.js`, `accounts.js`, `history.js`, `about.js`, `ui.js` | Extension pages |

To add a data provider, extend `MarketDataProvider` in `provider.js`, register it in `providers.js`, and add its host to `host_permissions`.

## Known limits
- Cboe's delayed-quote endpoints are public but undocumented and could change or be blocked.
- The TradingView button is found by matching page text, so TradingView layout changes can break it.
- There is no margin model for short options.
- Sync codes and synced data are not encrypted.

`test_marketdata.py` is a quick check that the Cboe endpoints still respond: `python3 test_marketdata.py AAPL`.

## Privacy
See [store/PRIVACY.md](store/PRIVACY.md).

## License
GNU General Public License v3.0 or later, see [LICENSE](LICENSE). Copyright (c) 2026 agsilvio.

You may use, change and share this code, but if you distribute a modified version (including a modified extension published in a store) you must release its complete source under the same license. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to send changes back.
