// Non-secret persisted settings (RPC overrides, etc.), stored as JSON at
// ~/.config/definitive-flash-mcp/config.json. Secrets live in the Keychain
// (see credentials.ts) — this file is safe to read, inspect, and hand-edit.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "definitive-flash-mcp");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface FlashConfig {
  /** Per-chain RPC URL overrides, keyed by Flash chain id (e.g. { base: "https://…" }). */
  rpc?: Record<string, string>;
  /** Definitive organization slug. Kept for reference; the MCP setup page uses the logged-in org. */
  organization?: string;
}

let cache: FlashConfig | null = null;

function load(): FlashConfig {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as FlashConfig;
  } catch {
    cache = {};
  }
  return cache;
}

export function getConfig(): FlashConfig {
  return load();
}

/** RPC override set via `flash_setup`, if any. Env var / per-call args take precedence. */
export function getRpcOverride(chainId: string): string | undefined {
  return load().rpc?.[chainId];
}

/** Persist one or more RPC overrides. Pass an empty string for a chain to clear it. */
export function setRpcOverrides(overrides: Record<string, string>): void {
  const cfg = load();
  const rpc = { ...(cfg.rpc ?? {}) };
  for (const [chain, url] of Object.entries(overrides)) {
    if (url && url.trim()) rpc[chain] = url.trim();
    else delete rpc[chain];
  }
  const next: FlashConfig = { ...cfg, rpc };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  cache = next;
}

export function getOrganization(): string | undefined {
  return load().organization;
}

export function setOrganization(slug: string): void {
  const cfg = load();
  const next: FlashConfig = { ...cfg, organization: slug.trim() };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  cache = next;
}

export const CONFIG_FILE_PATH = CONFIG_PATH;
