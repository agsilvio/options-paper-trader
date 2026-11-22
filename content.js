(() => {
  if (window.top !== window) return;

  const OCC = /([A-Z][A-Z0-9.]{0,5})\s?(\d{6})([CP])(\d{1,8}(?:\.\d+)?)/;
  const MARK = "data-opt-paper";
  const INSTANCE = Math.random().toString(36).slice(2);

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  function parse(text) {
    const m = OCC.exec(text);
    if (!m) return null;
    const [, ticker, ymd, type, rawStrike] = m;
    const strike = rawStrike.includes(".") || rawStrike.length < 8 ? parseFloat(rawStrike) : parseInt(rawStrike, 10) / 1000;
    const expiry = `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;
    return { ticker, expiry, strike, type };
  }

  function chartOption() {
    const symbolParam = new URLSearchParams(location.search).get("symbol");
    return (symbolParam && parse(decodeURIComponent(symbolParam))) || parse(document.title);
  }

  const call = (msg) =>
    new Promise((resolve, reject) => {
      if (!alive()) {
        reject(new Error("The paper trading extension was reloaded. Refresh this page to reconnect."));
        return;
      }
      chrome.runtime.sendMessage(msg, (res) => {
        if (!res) reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "No response"));
        else if (!res.ok) reject(new Error(res.error));
        else resolve(res.data);
      });
    });

  const money = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "style") node.style.cssText = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) node[k] = v;
    }
    node.append(...children.flat().filter((c) => c != null && c !== false));
    return node;
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .overlay { position: fixed; inset: 0; z-index: 2147483600; background: rgba(8,10,16,.66); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; font: 15px/1.45 -apple-system, "Segoe UI", Roboto, system-ui, sans-serif; color: #e1e4ec; }
    .card { width: min(440px, calc(100vw - 32px)); background: #1b1f2b; border: 1px solid #343a4a; border-radius: 14px; padding: 24px; box-shadow: 0 18px 60px rgba(0,0,0,.65); border-top: 4px solid var(--accent, #2962ff); }
    .card.call { --accent: #089981; }
    .card.put { --accent: #f23645; }
    .head { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
    .badge { font-weight: 800; font-size: 13px; letter-spacing: .08em; padding: 4px 12px; border-radius: 999px; color: #fff; background: var(--accent); }
    .ticker { font-size: 26px; font-weight: 700; letter-spacing: .01em; }
    .sub { color: #a0a5b5; font-size: 15px; margin-bottom: 18px; }
    .sub b { color: #e1e4ec; font-weight: 600; }
    .quotes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
    .quote { background: #131722; border: 1px solid #2a2f3d; border-radius: 10px; padding: 10px 12px; text-align: center; }
    .quote span { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #8a90a2; }
    .quote strong { display: block; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
    .fill { color: #a0a5b5; font-size: 13.5px; margin-bottom: 18px; }
    .fill b { color: #e1e4ec; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #8a90a2; margin-bottom: 4px; }
    select, input { width: 100%; background: #131722; color: #e1e4ec; border: 1px solid #343a4a; border-radius: 8px; padding: 10px 12px; font: inherit; }
    select:focus, input:focus { outline: 2px solid #2962ff; outline-offset: -1px; }
    .seg { display: grid; grid-template-columns: 1fr 1fr; background: #131722; border: 1px solid #343a4a; border-radius: 8px; padding: 3px; gap: 3px; }
    .seg button { border: 0; border-radius: 6px; padding: 8px; font: 600 15px inherit; background: transparent; color: #a0a5b5; cursor: pointer; }
    .seg button.on.buy { background: #089981; color: #fff; }
    .seg button.on.sell { background: #f23645; color: #fff; }
    .total { display: flex; justify-content: space-between; align-items: baseline; margin: 18px 0 16px; padding-top: 14px; border-top: 1px solid #2a2f3d; color: #a0a5b5; }
    .total strong { font-size: 24px; color: #e1e4ec; font-variant-numeric: tabular-nums; }
    .actions { display: flex; gap: 10px; }
    .actions button, .msg button { flex: 1; border-radius: 8px; padding: 12px 16px; font: 600 15px inherit; cursor: pointer; border: 1px solid #343a4a; background: #2a2f3d; color: #e1e4ec; }
    .actions button.primary { background: var(--side, #2962ff); border-color: var(--side, #2962ff); color: #fff; flex: 2; }
    .actions button:disabled { opacity: .6; cursor: default; }
    .err { color: #ff6b78; margin-top: 12px; font-size: 14px; }
    .msg { font-size: 16px; margin-bottom: 18px; }
    .msg.error { color: #ff6b78; }
  `;

  let overlay = null;

  function closeModal() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  function showModal(kind, ...content) {
    closeModal();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const card = el("div", { className: `card ${kind || ""}` }, ...content);
    const layer = el("div", { className: "overlay", onclick: (e) => { if (e.target === layer) closeModal(); } }, card);
    root.append(el("style", {}, CSS), layer);
    overlay = host;
    document.body.appendChild(host);
  }

  function showMessage(text, isError) {
    showModal("", el("div", { className: `msg${isError ? " error" : ""}` }, text), el("div", { className: "actions" }, el("button", { onclick: closeModal }, "Close")));
  }

  const dollars = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ""));

  function showOrder(prep) {
    const c = prep.contract;
    const kind = c.type === "C" ? "call" : "put";
    const order = { account: prep.account, side: "long", qty: 1 };
    const quoteCells = ["Bid", "Mid", "Ask"].map((name) => el("strong", {}, ""));
    const fillLine = el("div", { className: "fill" });
    const total = el("strong", {}, "");
    const totalLabel = el("span", {}, "");
    const status = el("div", { className: "err" });
    const cashLine = el("div", { className: "fill" });
    const confirmBtn = el("button", { className: "primary" }, "Confirm");
    const buyBtn = el("button", { type: "button", className: "buy", onclick: () => { order.side = "long"; update(); } }, "Buy");
    const sellBtn = el("button", { type: "button", className: "sell", onclick: () => { order.side = "short"; update(); } }, "Sell");

    function update() {
      const q = prep.quotes[order.account];
      const fill = order.side === "long" ? q.buy : q.sell;
      quoteCells[0].textContent = q.bid.toFixed(2);
      quoteCells[1].textContent = fill.mid.toFixed(2);
      quoteCells[2].textContent = q.ask.toFixed(2);
      fillLine.replaceChildren(
        "Fill price ",
        el("b", {}, fill.price.toFixed(2)),
        fill.pct ? ` (mid with ${fill.pct}% slippage toward the ${order.side === "long" ? "ask" : "bid"})` : " (at mid)"
      );
      buyBtn.classList.toggle("on", order.side === "long");
      sellBtn.classList.toggle("on", order.side === "short");
      confirmBtn.style.setProperty("--side", order.side === "long" ? "#089981" : "#f23645");
      confirmBtn.textContent = order.side === "long" ? `Buy ${kind}` : `Sell ${kind}`;
      const qty = parseInt(order.qty, 10);
      totalLabel.textContent = order.side === "long" ? "Total cost" : "Total credit";
      total.textContent = qty > 0 ? `$${money(fill.price * qty * 100)}` : "—";
      const cash = prep.cash[order.account];
      const cost = order.side === "long" && qty > 0 ? fill.price * qty * 100 : 0;
      const short = cash != null && cost > cash;
      cashLine.textContent = cash == null ? "" : `Available cash: $${money(cash)}${short ? ` — short by $${money(cost - cash)}` : ""}`;
      cashLine.style.color = short ? "#ff6b78" : "";
      confirmBtn.disabled = !(qty > 0) || short;
    }

    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      status.textContent = "";
      try {
        const result = await call({ type: "placeOrder", account: order.account, contract: c, side: order.side, qty: parseInt(order.qty, 10) });
        const how = result.fill.pct ? `${result.fill.price.toFixed(2)} (mid ${result.fill.mid.toFixed(2)} with ${result.fill.pct}% slippage)` : `mid ${result.fill.price.toFixed(2)}`;
        showMessage(`${result.side === "long" ? "Bought" : "Sold"} ${result.qty} × ${result.label} at ${how} in "${result.account}"`, false);
      } catch (err) {
        status.textContent = err.message;
        confirmBtn.disabled = false;
      }
    });

    const accountSelect = el(
      "select",
      { onchange: (e) => { order.account = e.target.value; update(); } },
      prep.accounts.map((a) => el("option", { value: a, selected: a === order.account }, a))
    );

    showModal(
      kind,
      el("div", { className: "head" }, el("span", { className: "badge" }, kind.toUpperCase()), el("span", { className: "ticker" }, c.underlying)),
      el("div", { className: "sub" }, el("b", {}, `$${dollars(c.strike)} strike`), ` · expires ${c.expiry}`),
      el("div", { className: "quotes" }, ["Bid", "Mid", "Ask"].map((name, i) => el("div", { className: "quote" }, el("span", {}, name), quoteCells[i]))),
      fillLine,
      el("div", { className: "row" }, el("div", {}, el("label", {}, "Side"), el("div", { className: "seg" }, buyBtn, sellBtn)), el("div", {}, el("label", {}, "Contracts"), el("input", { type: "number", min: 1, step: 1, value: 1, oninput: (e) => { order.qty = e.target.value; update(); } }))),
      el("div", {}, el("label", {}, "Account"), accountSelect),
      el("div", { className: "total" }, totalLabel, total),
      cashLine,
      el("div", { className: "actions" }, el("button", { onclick: closeModal }, "Cancel"), confirmBtn),
      status
    );
    update();
  }

  async function send(option) {
    showMessage("Looking up contract…", false);
    try {
      showOrder(await call({ type: "prepareOrder", option }));
    } catch (err) {
      showMessage(err.message, true);
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  const TINT = { C: "#089981", P: "#f23645" };

  function makeButton(option, floating) {
    const btn = document.createElement("button");
    btn.setAttribute(MARK, "1");
    btn.textContent = floating ? labelFor(option) : "+";
    btn.title = `Paper trade ${option.ticker} ${option.expiry} ${option.strike} ${option.type}`;
    btn.style.cssText =
      `background:${TINT[option.type]};color:#fff;border:0;border-radius:999px;padding:4px 10px;cursor:pointer;font:700 13px system-ui;margin-left:6px;` +
      (floating ? "position:fixed;right:16px;bottom:84px;z-index:2147483000;padding:12px 20px;font-size:15px;box-shadow:0 6px 24px rgba(0,0,0,.45);" : "");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      send(option);
    });
    return btn;
  }

  let floating = null;
  let floatingKey = "";

  function syncFloating() {
    const option = chartOption();
    const key = option ? JSON.stringify(option) : "";
    if (key === floatingKey) return;
    floatingKey = key;
    if (floating) floating.remove();
    document.querySelectorAll(`[${MARK}][data-floating]`).forEach((b) => b.remove());
    floating = option ? makeButton(option, true) : null;
    if (floating) floating.dataset.floating = "1";
    if (floating) document.body.appendChild(floating);
  }

  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const DATE_RE = /^([A-Za-z]{3})\s*(\d{1,2}),?\s*(\d{4})$/;
  const SIDE_RE = /^(\d+(?:\.\d+)?)\s*(CALL|PUT)$/i;
  const TICKER_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
  const NOT_TICKERS = new Set(["CALL", "PUT", "DTE", "BE", "IV", "LTP", "BID", "ASK", "USD"]);
  const MAX_LEVELS = 10;

  function urlTicker() {
    const m = location.pathname.match(/\/symbols\/(?:[A-Z]+-)?([A-Z0-9.]+)\//i);
    return m ? m[1].toUpperCase() : null;
  }

  function scanPanel(node) {
    const found = { ticker: null, date: null, side: null };
    for (const el of node.querySelectorAll("*")) {
      if (el.closest(`[${MARK}]`)) continue;
      const t = el.textContent.replace(/\s+/g, " ").trim();
      if (!t || t.length > 20) continue;
      if (!found.date) {
        const m = DATE_RE.exec(t);
        if (m && MONTHS[m[1].toUpperCase()]) {
          found.date = m;
          continue;
        }
      }
      if (!found.side) {
        const m = SIDE_RE.exec(t);
        if (m) {
          found.side = m;
          continue;
        }
      }
      if (!found.ticker && TICKER_RE.test(t) && !NOT_TICKERS.has(t)) found.ticker = t;
    }
    return found;
  }

  function locate(from) {
    let node = from.parentElement;
    for (let level = 0; node && node !== document.body && level < MAX_LEVELS; level++, node = node.parentElement) {
      const found = scanPanel(node);
      if (!found.date || !found.side) continue;
      const ticker = found.ticker || urlTicker();
      if (!ticker) continue;
      const month = String(MONTHS[found.date[1].toUpperCase()]).padStart(2, "0");
      const day = found.date[2].padStart(2, "0");
      const option = { ticker, expiry: `${found.date[3]}-${month}-${day}`, strike: parseFloat(found.side[1]), type: found.side[2].toUpperCase() === "CALL" ? "C" : "P" };
      return { option, container: node };
    }
    return { option: null, container: from.parentElement };
  }

  const panelOption = (from) => locate(from).option;
  const labelFor = (option) => (!option ? "Paper trade option" : `Paper trade ${option.type === "C" ? "CALL" : "PUT"} · ${option.ticker} $${option.strike}`);
  const tint = (button, option) => {
    button.style.setProperty("background", option ? TINT[option.type] : "", "important");
    button.style.setProperty("color", option ? "#fff" : "", "important");
    button.style.setProperty("font-weight", "700", "important");
  };

  function debugPanel(from) {
    const levels = [];
    let node = from.parentElement;
    for (let level = 0; node && node !== document.body && level < MAX_LEVELS; level++, node = node.parentElement) {
      const f = scanPanel(node);
      levels.push({ level, tag: node.tagName, ticker: f.ticker, date: f.date && f.date[0], side: f.side && f.side[0] });
    }
    console.warn("[opt-paper] could not read contract", { urlTicker: urlTicker(), levels });
  }

  function anchorFor(textNode) {
    const clickable = textNode.parentElement.closest("button, a, [role=button]");
    return clickable || textNode.parentElement;
  }

  function setLabel(button, text) {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    let first = true;
    while (walker.nextNode()) {
      walker.currentNode.nodeValue = first ? text : "";
      first = false;
    }
    if (first) button.textContent = text;
  }

  const buttons = new Map();

  function addButton(anchor) {
    if (!anchor.parentElement) return;
    const existing = anchor.parentElement.querySelector(`[${MARK}]`);
    if (existing && existing.dataset.instance === INSTANCE) return;
    if (existing) existing.remove();
    const { option, container } = locate(anchor);
    const clone = anchor.cloneNode(true);
    clone.removeAttribute("href");
    clone.setAttribute(MARK, "1");
    clone.dataset.instance = INSTANCE;
    clone.dataset.label = labelFor(option);
    setLabel(clone, clone.dataset.label);
    tint(clone, option);
    clone.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const current = panelOption(clone);
      if (current) send(current);
      else {
        debugPanel(clone);
        showMessage("Could not read the contract from this panel. Details were written to the browser console.", true);
      }
    });
    anchor.after(clone);
    buttons.set(clone, container);
  }

  function annotate(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeValue.length > 30 || !/^\s*see overview\s*$/i.test(node.nodeValue)) continue;
      if (node.parentElement.closest(`[${MARK}]`)) continue;
      addButton(anchorFor(node));
    }
  }

  function relabel(targets) {
    for (const [button, container] of buttons) {
      if (!button.isConnected) {
        buttons.delete(button);
        continue;
      }
      if (!targets.some((t) => container.contains(t) && !button.contains(t))) continue;
      const { option, container: next } = locate(button);
      buttons.set(button, next);
      const label = labelFor(option);
      tint(button, option);
      if (button.dataset.label !== label) {
        button.dataset.label = label;
        setLabel(button, label);
      }
    }
  }

  let lastTitle = "";
  let lastHref = "";

  function onMutations(records) {
    if (!alive()) {
      observer.disconnect();
      return;
    }
    if (document.title !== lastTitle || location.href !== lastHref) {
      lastTitle = document.title;
      lastHref = location.href;
      syncFloating();
    }
    const roots = new Set();
    const targets = [];
    for (const r of records) {
      targets.push(r.target);
      for (const n of r.addedNodes) {
        const el = n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
        if (el && el.isConnected && !el.closest(`[${MARK}]`)) roots.add(el);
      }
    }
    for (const root of roots) annotate(root);
    if (buttons.size) relabel(targets);
  }

  console.log("[opt-paper] content script loaded");
  const observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  syncFloating();
  annotate(document.body);
})();
