# Chrome Web Store listing

**Name:** Options Paper Trader for TradingView
**Category:** Productivity (or Finance if offered)
**Summary (132 chars max):** Paper-trade options from TradingView's options chain with free delayed prices. No account, no real money.

## Description
Practice options trading without risking money.

Open any options chain on TradingView and click the "Paper trade" button in the contract panel. Choose an account, buy or sell, and the extension fills the order at the mid price plus a slippage you set per account.

- Call and put orders with clear colour coding
- Multiple paper accounts with starting funds and slippage per account
- Cash check: you cannot buy more than the account holds
- Portfolio with original and current dollar value and profit/loss for every position
- Expired options settle automatically from the closing price
- Free delayed (about 15 minutes) quotes from Cboe, no API key or account
- Data stays on your computer; optional online sync to use accounts on another browser
- Download and restore backups

Limits: US-listed options only. Prices are delayed. Fills are simulated. Short positions have no margin model.

Paper trading only; not financial advice. Not affiliated with TradingView or Cboe.

## Permission justifications (privacy practices tab)
- **storage:** saves paper accounts and settings locally.
- **Host cdn.cboe.com, cdn-api.cboe.com:** fetch free delayed option and stock quotes.
- **Host mantledb.sh:** optional user-enabled online sync.
- **Content script on tradingview.com:** adds the "Paper trade" button and reads the selected contract.
- **Remote code:** none. All code ships in the package.
- **Single purpose:** paper-trade options from TradingView.

## Data usage form
- Collects: none sent to the developer. Website content is read locally to identify the option contract.
- Certify: no sale of data, no unrelated use, no creditworthiness use.

## Assets still needed
- At least one screenshot, 1280x800 (take it from the Portfolio page and the order popup on TradingView).
- Privacy policy URL: host store/PRIVACY.md (for example on GitHub Pages) and paste the link.
