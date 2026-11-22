import { createStore, joinStore, makeSyncCode } from "./mantle.js";

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k.includes("-")) el.setAttribute(k, v);
    else el[k] = v;
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const icon = (name, extra = "") => h("i", { class: `bi bi-${name} ${extra}` });

const fmt = (n) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const usd = (n) => (n == null || Number.isNaN(n) ? "–" : `${n < 0 ? "-" : ""}$${fmt(n)}`);
export const signedUsd = (n) => (n == null || Number.isNaN(n) ? "–" : `${n > 0 ? "+" : n < 0 ? "-" : ""}$${fmt(n)}`);
export const px = (n) => (n == null || Number.isNaN(n) ? "–" : n.toFixed(2));
export const pnlClass = (n) => (n > 0 ? "text-success" : n < 0 ? "text-danger" : "");
export const fmtDate = (t) => (t ? new Date(t).toLocaleDateString() : "–");

export function computeTally(accounts) {
  const tally = { success: 0, failed: 0, active: 0 };
  for (const a of accounts) {
    if (a.status !== "closed") tally.active += 1;
    else if (a.outcome === "success") tally.success += 1;
    else tally.failed += 1;
  }
  return tally;
}

export function navbar(active, tally) {
  const link = (id, href, iconName, label) =>
    h("li", { class: "nav-item" }, h("a", { class: `nav-link d-flex align-items-center gap-2${active === id ? " active" : ""}`, href }, icon(iconName), label));
  return h(
    "nav",
    { class: "navbar navbar-expand border-bottom bg-body-tertiary mb-4" },
    h(
      "div",
      { class: "container-xl" },
      h("span", { class: "navbar-brand d-flex align-items-center gap-2 fw-semibold" }, icon("graph-up-arrow", "text-primary"), "Options Paper Trader"),
      h(
        "ul",
        { class: "navbar-nav nav-pills gap-1" },
        link("portfolio", "options.html#portfolio", "briefcase", "Portfolio"),
        link("accounts", "accounts.html", "wallet2", "Accounts"),
        link("history", "history.html", "clock-history", "History"),
        link("about", "about.html", "info-circle", "About"),
        link("settings", "options.html#settings", "gear", "Settings")
      ),
      tally
        ? h(
            "div",
            { class: "ms-auto d-flex gap-2", title: "Closed-out accounts" },
            h("span", { class: "badge bg-success-subtle text-success-emphasis" }, icon("check-circle", "me-1"), `${tally.success} successful`),
            h("span", { class: "badge bg-danger-subtle text-danger-emphasis" }, icon("x-circle", "me-1"), `${tally.failed} failed`)
          )
        : null
    )
  );
}

export function statCard(label, value, { valueClass = "", sub = null, action = null } = {}) {
  return h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card h-100" },
      h(
        "div",
        { class: "card-body" },
        h("div", { class: "d-flex align-items-center" }, h("div", { class: "stat-label" }, label), action ? h("div", { class: "ms-auto" }, action) : null),
        h("div", { class: `stat-value ${valueClass}` }, value),
        sub ? h("div", { class: "small text-body-secondary mt-1" }, sub) : null
      )
    )
  );
}

export function emptyState(iconName, title, text) {
  return h("div", { class: "empty" }, icon(iconName), h("div", { class: "fw-semibold text-body" }, title), text ? h("div", { class: "small" }, text) : null);
}

export function toast(message, variant = "success") {
  let container = document.getElementById("toasts");
  if (!container) {
    container = h("div", { id: "toasts", class: "toast-container position-fixed bottom-0 end-0 p-3" });
    document.body.append(container);
  }
  const t = h(
    "div",
    { class: `toast show align-items-center text-bg-${variant} border-0`, role: "alert" },
    h(
      "div",
      { class: "d-flex" },
      h("div", { class: "toast-body" }, message),
      h("button", { type: "button", class: "btn-close btn-close-white me-2 m-auto", onclick: () => t.remove() })
    )
  );
  container.append(t);
  setTimeout(() => t.remove(), variant === "danger" ? 8000 : 4000);
}

export function dialog({ title, message = null, fields = [], confirmText = "OK", cancelText = "Cancel", variant = "primary" }) {
  return new Promise((resolve) => {
    const inputs = {};
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
    };
    const close = (value) => {
      root.remove();
      backdrop.remove();
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const fieldNodes = fields.map((f) => {
      const id = `dlg-${f.name}`;
      const input =
        f.type === "select"
          ? h("select", { class: "form-select", id }, f.options.map(([v, label]) => h("option", { value: v, selected: String(v) === String(f.value) }, label)))
          : h("input", { class: "form-control", id, type: f.type || "text", value: f.value ?? "", step: f.step, min: f.min, autocomplete: "off" });
      inputs[f.name] = input;
      return h(
        "div",
        { class: "mb-3" },
        h("label", { class: "form-label", htmlFor: id }, f.label),
        f.prefix ? h("div", { class: "input-group" }, h("span", { class: "input-group-text" }, f.prefix), input) : input,
        f.help ? h("div", { class: "form-text" }, f.help) : null
      );
    });
    const confirmBtn = h("button", { type: "submit", class: `btn btn-${variant}` }, confirmText);
    const form = h(
      "form",
      {
        class: "modal-content",
        onsubmit: (e) => {
          e.preventDefault();
          const values = {};
          for (const [k, el] of Object.entries(inputs)) values[k] = el.value;
          close(values);
        },
      },
      h("div", { class: "modal-header" }, h("h5", { class: "modal-title" }, title), h("button", { type: "button", class: "btn-close", onclick: () => close(null) })),
      h("div", { class: "modal-body" }, message ? (typeof message === "string" ? h("p", {}, message) : message) : null, fieldNodes),
      h("div", { class: "modal-footer" }, h("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => close(null) }, cancelText), confirmBtn)
    );
    const root = h("div", { class: "modal d-block", tabIndex: -1, onmousedown: (e) => { if (e.target === root) close(null); } }, h("div", { class: "modal-dialog modal-dialog-centered" }, form));
    const backdrop = h("div", { class: "modal-backdrop show" });
    document.body.classList.add("modal-open");
    document.body.append(backdrop, root);
    document.addEventListener("keydown", onKey);
    const first = Object.values(inputs)[0];
    if (first) {
      first.focus();
      if (first.select) first.select();
    } else confirmBtn.focus();
  });
}

export function summaryList(rows) {
  return h("dl", { class: "row mb-0 summary" }, rows.flatMap(([k, v, cls]) => [h("dt", { class: "col-6 fw-normal text-body-secondary" }, k), h("dd", { class: `col-6 text-end mb-1 ${cls || ""}` }, v)]));
}

export async function connectStore() {
  const mode = await dialog({
    title: "Online sync",
    message: "Your accounts are saved on this device. Online sync also keeps a copy in a free online store (MantleDB) so you can open them on another browser. Existing accounts on this device are copied to a new store. Anyone with your sync code can read and change your data, so don't share it.",
    fields: [
      {
        name: "mode",
        label: "What do you want to do?",
        type: "select",
        value: "create",
        options: [
          ["create", "Create a new store from this device's accounts"],
          ["join", "Connect to an existing store"],
        ],
      },
    ],
    confirmText: "Continue",
  });
  if (!mode) return null;
  if (mode.mode === "create") {
    const created = await createStore();
    const code = makeSyncCode(created.namespace, created.key);
    await dialog({
      title: "Store created",
      message: h(
        "div",
        {},
        h("p", {}, "Save this sync code. You need it to open your data on another computer or browser. It is also shown on the Settings page."),
        h(
          "div",
          { class: "input-group" },
          h("input", { class: "form-control font-monospace", readOnly: true, value: code, onfocus: (e) => e.target.select() }),
          h(
            "button",
            {
              type: "button",
              class: "btn btn-outline-secondary",
              onclick: async (e) => {
                await navigator.clipboard.writeText(code);
                e.currentTarget.replaceChildren(icon("check2", "me-1"), "Copied");
              },
            },
            icon("clipboard", "me-1"),
            "Copy"
          )
        )
      ),
      confirmText: "I saved them",
      cancelText: "Close",
    });
    return created.dir;
  }
  const values = await dialog({
    title: "Connect to an existing store",
    fields: [{ name: "code", label: "Sync code", help: "The code you saved when the store was created, or copy it from Settings on another device." }],
    confirmText: "Connect",
  });
  if (!values) return null;
  return joinStore(values.code);
}
