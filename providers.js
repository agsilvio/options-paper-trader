import { CboeProvider } from "./cboe.js";

const registry = {
  cboe: () => new CboeProvider(),
};

const ACTIVE = "cboe";

let instance = null;

export function activeProvider() {
  if (!instance) instance = registry[ACTIVE]();
  return instance;
}
