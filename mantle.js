const BASE = "https://mantledb.sh/v2";
const CONFIG_KEY = "mantle";
const CHUNK_CHARS = 40000;
const FILE_PREFIX = "f";

const HEX = "0123456789abcdef";

function encodeName(name) {
  let out = "";
  for (const ch of name) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else out += `-${ch.charCodeAt(0).toString(16).padStart(2, "0")}`;
  }
  return out;
}

function decodeName(encoded) {
  let out = "";
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "-") {
      out += String.fromCharCode(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else out += encoded[i];
  }
  return out;
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pack(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function unpack(data) {
  const stream = new Blob([fromBase64(data)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

const randomId = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => HEX[b >> 4] + HEX[b & 15]).join("");

async function request(method, path, { key, body } = {}) {
  const headers = {};
  if (key) headers["X-Mantle-Key"] = key;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(`${BASE}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    throw new Error(`Cannot reach the online store (${err.message}). Check your connection.`);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (res.status === 401) throw new Error("The online store rejected the key. Reconnect with the correct namespace and key.");
  if (res.status === 429) throw new Error("The online store's daily request limit was reached. Try again later.");
  if (res.status === 413) throw new Error("The online store rejected a value for being too large.");
  return { status: res.status, json, text };
}

function checked(res, what) {
  if (res.status < 200 || res.status >= 300) throw new Error(`Online store ${what} failed (${res.status}): ${res.text.slice(0, 120)}`);
  return res;
}

export const STORE_INFO = {
  name: "MantleDB",
  website: "https://mantledb.sh/",
  endpoint: BASE,
  holds: [
    "Account files (<account>.json): cash, open positions, closed trades",
    "Per-account history logs (<account>.history.jsonl)",
    "A global history log (_global.history.jsonl)",
  ],
  notes: [
    "Optional. Free, no account; protected by a secret sync code",
    "Files are gzip-compressed and split into pieces of up to 40,000 characters, stored as plain JSON entries (not encrypted)",
    "Limits: 100 entries per namespace, 64 KB per entry, 10,000 requests per day",
    "A namespace is deleted after 90 days without writes",
    "Anyone with the namespace and key can read and change the data",
  ],
};

export const LOCAL_INFO = {
  name: "This browser",
  holds: [
    "Account files (<account>.json): cash, open positions, closed trades",
    "Per-account history logs (<account>.history.jsonl)",
    "A global history log (_global.history.jsonl)",
  ],
  notes: [
    "Saved in the extension's local storage on this computer; nothing is sent to any server",
    "Removing the extension or clearing its data deletes your accounts, so use Settings > Download backup",
    "Turn on online sync in Settings to open the same accounts on another browser",
  ],
};

const LOCAL_PREFIX = "file:";

export class LocalDir {
  constructor() {
    this.name = "this browser";
  }

  async list() {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all).filter((k) => k.startsWith(LOCAL_PREFIX)).map((k) => k.slice(LOCAL_PREFIX.length));
  }

  async read(name) {
    const got = await chrome.storage.local.get(LOCAL_PREFIX + name);
    const value = got[LOCAL_PREFIX + name];
    return typeof value === "string" ? value : null;
  }

  async write(name, text) {
    await chrome.storage.local.set({ [LOCAL_PREFIX + name]: text });
  }

  async append(name, text) {
    await this.write(name, ((await this.read(name)) || "") + text);
  }

  async remove(name) {
    await chrome.storage.local.remove(LOCAL_PREFIX + name);
  }
}

export class MantleDir {
  constructor(namespace, key) {
    this.namespace = namespace;
    this.key = key;
    this.name = namespace;
    this.counts = new Map();
  }

  path(name, index) {
    return `${this.namespace}/${FILE_PREFIX}/${encodeName(name)}/${index}`;
  }

  async list() {
    const res = checked(await request("GET", `list/${this.namespace}`, { key: this.key }), "list");
    const names = new Set();
    for (const entry of (res.json && res.json.entries) || []) {
      const parts = entry.path.split("/");
      if (parts[0] === FILE_PREFIX && parts.length === 3) names.add(decodeName(parts[1]));
    }
    return [...names];
  }

  async read(name) {
    const first = await request("GET", this.path(name, 0), { key: this.key });
    if (first.status === 404) {
      this.counts.set(name, 0);
      return null;
    }
    checked(first, "read");
    const head = first.json;
    const rest = await Promise.all(
      Array.from({ length: head.n - 1 }, (_, i) => request("GET", this.path(name, i + 1), { key: this.key }).then((r) => checked(r, "read").json))
    );
    for (const part of rest) {
      if (part.v !== head.v) throw new Error(`"${name}" was being written while it was read. Try again.`);
    }
    this.counts.set(name, head.n);
    return unpack([head, ...rest].map((p) => p.d).join(""));
  }

  async write(name, text) {
    const data = await pack(text);
    const pieces = [];
    for (let i = 0; i < data.length || i === 0; i += CHUNK_CHARS) pieces.push(data.slice(i, i + CHUNK_CHARS));
    const v = randomId(8);
    const previous = this.counts.has(name) ? this.counts.get(name) : await this.probeCount(name);
    await Promise.all(
      pieces.slice(1).map((d, i) => request("POST", this.path(name, i + 1), { key: this.key, body: { v, n: pieces.length, d } }).then((r) => checked(r, "write")))
    );
    checked(await request("POST", this.path(name, 0), { key: this.key, body: { v, n: pieces.length, d: pieces[0] } }), "write");
    for (let i = pieces.length; i < previous; i++) await request("DELETE", this.path(name, i), { key: this.key });
    this.counts.set(name, pieces.length);
  }

  async append(name, text) {
    const existing = await this.read(name);
    await this.write(name, (existing || "") + text);
  }

  async remove(name) {
    const count = this.counts.has(name) ? this.counts.get(name) : await this.probeCount(name);
    for (let i = 0; i < count; i++) await request("DELETE", this.path(name, i), { key: this.key });
    this.counts.set(name, 0);
  }

  async probeCount(name) {
    const first = await request("GET", this.path(name, 0), { key: this.key });
    if (first.status === 404) return 0;
    checked(first, "read");
    return first.json.n;
  }
}

export async function getConfig() {
  return (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY] || null;
}

export async function clearConfig() {
  await chrome.storage.local.remove(CONFIG_KEY);
  active = null;
}

let active = null;

export async function getStoreDir() {
  const config = await getConfig();
  if (!config) return new LocalDir();
  const signature = `${config.namespace}:${config.key}`;
  if (!active || active.signature !== signature) active = { signature, dir: new MantleDir(config.namespace, config.key) };
  return active.dir;
}

async function useStore(namespace, key) {
  const dir = new MantleDir(namespace, key);
  await dir.list();
  await chrome.storage.local.set({ [CONFIG_KEY]: { namespace, key } });
  active = null;
  return getStoreDir();
}

export async function createStore() {
  const namespace = `optpaper-${randomId(10)}`;
  const res = checked(await request("GET", `claim/${namespace}`), "claim");
  if (!res.json || !res.json.key) throw new Error("The online store did not return a key");
  const dir = await useStore(namespace, res.json.key);
  const local = new LocalDir();
  for (const name of await local.list()) await dir.write(name, await local.read(name));
  return { dir, namespace, key: res.json.key };
}

export const makeSyncCode = (namespace, key) => `${namespace}:${key}`;

export function parseSyncCode(code) {
  const text = code.trim();
  const split = text.indexOf(":");
  const namespace = text.slice(0, split).trim();
  const key = text.slice(split + 1).trim();
  if (split < 1 || !namespace || !key) throw new Error("That is not a valid sync code. It looks like name:key.");
  return { namespace, key };
}

export async function joinStore(code) {
  const { namespace, key } = parseSyncCode(code);
  return useStore(namespace, key);
}
