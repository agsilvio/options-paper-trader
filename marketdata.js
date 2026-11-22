import { activeProvider } from "./providers.js";
import { PROVIDER_METHODS } from "./provider.js";

export const MARKET_FUNCTIONS = PROVIDER_METHODS;

const inBackground = typeof document === "undefined";

function remote(fn) {
  return (...args) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "market", fn, args }, (res) => {
        if (!res) reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "No response from the extension"));
        else if (!res.ok) reject(new Error(res.error));
        else resolve(res.data);
      });
    });
}

const pick = (fn) => (inBackground ? (...args) => activeProvider()[fn](...args) : remote(fn));

export const resolveSymbol = pick("resolveSymbol");
export const findContract = pick("findContract");
export const dailyClose = pick("dailyClose");
export const stockPrices = pick("stockPrices");
export const midPrices = pick("midPrices");
export const optionChain = pick("optionChain");
export const optionQuotes = pick("optionQuotes");
