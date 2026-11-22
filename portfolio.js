import { migratePosition } from "./occ.js";
import { getStoreDir } from "./mantle.js";

export const BACKEND = "mantle";

export const getDir = getStoreDir;

export const permission = async () => "granted";

export async function importFiles(dir, files) {
  let count = 0;
  for (const file of files) {
    if (!/\.(json|jsonl)$/.test(file.name) || /^_(settings|questrade)\.json$/.test(file.name)) continue;
    await dir.write(file.name, await file.text());
    count++;
  }
  return count;
}

export const GLOBAL = "_global";
export const ACCOUNT_DEFAULTS = { defaultFunds: 100000, slippage: 25 };

export const isReserved = (name) => name.startsWith("_");

export async function readJson(dir, filename) {
  const text = await dir.read(filename);
  return text == null ? null : JSON.parse(text);
}

export async function writeJson(dir, filename, data) {
  await dir.write(filename, JSON.stringify(data, null, 2));
}

export function cleanName(name) {
  return name.trim().replace(/[^\w\- ]/g, "").slice(0, 60);
}

export async function listAccounts(dir) {
  return (await dir.list())
    .filter((name) => name.endsWith(".json") && !isReserved(name))
    .map((name) => name.slice(0, -5))
    .sort();
}

export async function loadAccount(dir, name) {
  const text = await dir.read(`${name}.json`);
  if (text == null) throw new Error(`Account "${name}" not found`);
  const data = JSON.parse(text);
  (data.positions || []).forEach(migratePosition);
  (data.closed || []).forEach(migratePosition);
  if (data.status === "closed" && typeof data.finalFunds !== "number") {
    data.status = "open";
    delete data.outcome;
    delete data.closedAt;
    delete data.finalFunds;
  }
  return data;
}

export async function saveAccount(dir, name, data) {
  await writeJson(dir, `${name}.json`, data);
}

export async function appendHistory(dir, name, entry) {
  await dir.append(`${name}.history.jsonl`, `${JSON.stringify(entry)}\n`);
}

export async function createAccount(dir, name, cash, slippage) {
  const clean = cleanName(name);
  if (!clean || isReserved(clean)) throw new Error("Choose a different account name (names cannot start with an underscore)");
  if ((await listAccounts(dir)).includes(clean)) throw new Error("An account with that name already exists");
  const data = { name: clean, created: Date.now(), status: "open", startingFunds: cash, cash, slippage, positions: [], closed: [] };
  await saveAccount(dir, clean, data);
  return { name: clean, data };
}

export async function listOpenAccounts(dir) {
  const open = [];
  for (const name of await listAccounts(dir)) {
    try {
      if ((await loadAccount(dir, name)).status !== "closed") open.push(name);
    } catch {
      continue;
    }
  }
  return open;
}

export async function openPosition(dir, name, contract, side, qty, fill, underlyingPrice) {
  const price = fill.price;
  const data = await loadAccount(dir, name);
  if (data.status === "closed") throw new Error(`Account "${name}" is closed out`);
  const signed = side === "long" ? qty : -qty;
  if (typeof data.cash === "number" && data.cash - signed * price * 100 < 0) {
    throw new Error(`Not enough cash in "${name}": need ${(signed * price * 100).toFixed(2)}, have ${data.cash.toFixed(2)}`);
  }
  data.positions.push({
    id: crypto.randomUUID(),
    ...contract,
    qty: signed,
    openPrice: price,
    openMid: fill.mid,
    openSlippage: fill.pct,
    openTime: Date.now(),
    openUnderlying: underlyingPrice,
    lastMid: fill.mid,
    lastUnderlying: underlyingPrice,
    lastFetched: Date.now(),
  });
  if (typeof data.cash === "number") data.cash -= signed * price * 100;
  await saveAccount(dir, name, data);
  await appendHistory(dir, name, {
    time: Date.now(),
    type: "open",
    label: contract.label,
    symbolId: contract.symbolId,
    qty: signed,
    price,
    mid: fill.mid,
    slippage: fill.pct,
    underlyingPrice,
    cash: data.cash ?? null,
  });
  return data;
}

export async function readHistory(dir, name) {
  const text = await dir.read(`${name}.history.jsonl`);
  if (text == null) return [];
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const removeIfExists = (dir, filename) => dir.remove(filename);

export async function renameAccount(dir, oldName, newName) {
  const clean = cleanName(newName);
  if (!clean || isReserved(clean)) throw new Error("Choose a different account name (names cannot start with an underscore)");
  if (clean === oldName) return clean;
  if ((await listAccounts(dir)).includes(clean)) throw new Error("An account with that name already exists");
  const data = await loadAccount(dir, oldName);
  data.name = clean;
  await saveAccount(dir, clean, data);
  const history = await dir.read(`${oldName}.history.jsonl`);
  if (history) await dir.write(`${clean}.history.jsonl`, history);
  await appendHistory(dir, clean, { time: Date.now(), type: "rename", from: oldName, to: clean });
  await removeIfExists(dir, `${oldName}.json`);
  await removeIfExists(dir, `${oldName}.history.jsonl`);
  return clean;
}

export async function deleteAccount(dir, name) {
  await removeIfExists(dir, `${name}.json`);
  await removeIfExists(dir, `${name}.history.jsonl`);
}

export async function clearHistory(dir, names) {
  let removed = 0;
  for (const name of names) {
    removed += (await readHistory(dir, name)).length;
    await removeIfExists(dir, `${name}.history.jsonl`);
  }
  return removed;
}
