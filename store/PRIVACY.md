# Privacy Policy — Options Paper Trader for TradingView

Last updated: 2026-11-09

This extension lets you paper-trade options (simulated trades, no real money) from TradingView's options chain.

## What the extension stores
- Your paper accounts: cash, positions, closed trades and a history log. These are saved **on your computer** in the extension's local storage.
- Which account you last selected.
- If you turn on optional online sync: your sync code (a namespace and secret key).

## What leaves your computer
- **Market data requests.** To price options, the extension requests public delayed quotes from Cboe (`cdn.cboe.com`, `cdn-api.cboe.com`). These requests contain the ticker or option symbol you are looking at. Cboe can see your IP address as with any web request.
- **Optional online sync.** Only if you turn it on, your account files are sent to MantleDB (`mantledb.sh`), a third-party storage service, under a random namespace and secret key. The data is gzip-compressed JSON and is **not encrypted**. Anyone who has your sync code can read and change it.

The developer does not operate any server, receives no data from the extension, and has no analytics, advertising or tracking.

## What the extension reads on TradingView
On tradingview.com pages the extension reads the on-screen contract details (ticker, expiry, strike, call/put) to add a "Paper trade" button. This page content is used only in your browser and is not sent anywhere except as the option symbol in the Cboe request above.

## Sharing and sale
Your data is not sold, shared with third parties for advertising, or used for any purpose other than running the extension.

## Your control
- Delete accounts in the extension, or remove the extension, to delete the data stored on your computer.
- Turn off online sync in Settings. Data already in the online store stays there until MantleDB removes it; to remove it yourself, delete the accounts before turning sync off.
- Download a backup in Settings at any time.

## Disclaimer
Paper trading only; not financial advice. Not affiliated with TradingView or Cboe.

## Contact
Questions or issues: open an issue on the project repository.
